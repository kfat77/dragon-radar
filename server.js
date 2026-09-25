'use strict';
/**
 * 抓龙雷达 · 服务端
 * 零依赖：只用 Node 内置 http / fs / fetch。
 * 职责：建候选池 → 批量拉取真实行情 → 计算龙分 → 快照落盘 → 对外提供 JSON 接口 + 静态站点。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const S = require('./lib/sources');
const { scoreToken, WEIGHTS, GRADES } = require('./lib/score');
const Sec = require('./lib/security');            // 合约安全 / 筹码 / 仿盘
const Checkup = require('./lib/checkup');         // 四维体检模型（纯函数）
const Ledger = require('./lib/ledger');           // 信号账本与前瞻回测（纯函数）

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const RADAR_FILE = path.join(DATA_DIR, 'radar.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');

const PORT = Number(process.env.PORT || 8791);
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 60000);
const MAX_HISTORY = 720;          // 每代币保留快照点数
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 420);
const MAX_BACKFILL = 240;         // 单轮最多为多少个待结算信号补价（防跑飞）

// ------------------------------------------------------------------ 运行状态
const state = {
  scanning: false,
  lastScanAt: 0,
  lastScanMs: 0,
  scanCount: 0,
  lastError: null,
  sources: {},
  watchlist: [],            // [{chainId, tokenAddress, symbol}]
  history: {},              // key -> [{ts, priceUsd, liqUsd, volH24, score}]
  snapshots: {},            // key -> 上一轮归一化数据（用于算区间增量）
  tokens: [],               // 本轮评分结果
  meta: {},
  priceCache: {},           // tokenAddress -> {priceUsd, at, symbol, chainId}
  checkupPrev: {},          // key -> {holderCount, at}，供叙事维度算持币地址增量
  checkupCache: {},         // key -> 四维体检结果（外部风控接口很慢，必须长缓存）
  ledger: Ledger.create(),  // 信号账本：前瞻记录信号、事后按真实价格结算
};

const keyOf = (chainId, addr) => `${chainId}:${String(addr).toLowerCase()}`;

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      state.watchlist = Array.isArray(j.watchlist) ? j.watchlist : [];
      state.history = j.history && typeof j.history === 'object' ? j.history : {};
      state.snapshots = j.snapshots && typeof j.snapshots === 'object' ? j.snapshots : {};
      state.checkupPrev = j.checkupPrev && typeof j.checkupPrev === 'object' ? j.checkupPrev : {};
    }
  } catch (e) { console.warn('[state] 读取失败：', e.message); }
  try {
    if (fs.existsSync(RADAR_FILE)) {
      const j = JSON.parse(fs.readFileSync(RADAR_FILE, 'utf8'));
      if (j && Array.isArray(j.tokens)) { state.tokens = j.tokens; state.lastScanAt = j.updatedAt || 0; state.meta = j.meta || {}; }
    }
  } catch (e) { console.warn('[radar] 读取缓存失败：', e.message); }
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const j = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
      // 旧版本或损坏的账本由 Ledger.normalize 内部重置，不让半个结构污染统计
      state.ledger = Ledger.normalize(j);
    }
  } catch (e) { console.warn('[ledger] 读取失败，本轮从空账本开始：', e.message); }
}

let saveTimer = null;
function saveStateSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ watchlist: state.watchlist, history: state.history, snapshots: state.snapshots, checkupPrev: state.checkupPrev }));
    } catch (e) { console.warn('[state] 写入失败：', e.message); }
  }, 1500);
}

// 账本单独落盘：它比 state 大得多（含未结算信号的观测序列），跟 state 挤在同一个
// 定时器里会让每次快照都变慢。延迟也放长，输一盘棋不差这几秒。
let ledgerTimer = null;
function saveLedgerSoon() {
  if (ledgerTimer) return;
  ledgerTimer = setTimeout(() => {
    ledgerTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(LEDGER_FILE, JSON.stringify(state.ledger));
    } catch (e) { console.warn('[ledger] 写入失败：', e.message); }
  }, 4000);
}

// ------------------------------------------------------------------ 扫描主流程
async function scan() {
  if (state.scanning) return { skipped: true };
  state.scanning = true;
  const t0 = Date.now();
  const log = (m) => console.log(`[scan] ${m}`);
  try {
    state.lastError = null;

    // 候选池 = 本轮新发现（推广榜/新资料/关键词扩样）+ 常驻自选 + 上一轮的强势标的（保持连续性，不每轮重掷骰子）
    const carry = state.tokens
      .filter((t) => t.score >= 50 || t.grade === 'dragon' || t.grade === 'candidate')
      .slice(0, 80)
      .map((t) => ({ chainId: t.chainId, tokenAddress: t.tokenAddress }));

    const universe = await S.buildUniverse({
      extra: [
        ...state.watchlist.map((w) => ({ chainId: w.chainId, tokenAddress: w.tokenAddress, source: 'watchlist' })),
        ...carry.map((c) => ({ chainId: c.chainId, tokenAddress: c.tokenAddress, source: 'carry' })),
      ],
      log,
    });

    // 只保留 DexScreener 覆盖的链
    const known = new Set(Object.keys(S.CHAIN_LABEL));
    const uniq = [];
    const seen = new Set();
    for (const c of universe) {
      if (!known.has(c.chainId)) continue;
      const k = keyOf(c.chainId, c.tokenAddress);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }
    const sliced = uniq.slice(0, MAX_TOKENS);
    log(`候选池 ${uniq.length} 个，本轮处理 ${sliced.length} 个`);

    // 批量拉行情
    const pairs = await S.dexTokens(sliced.map((c) => c.tokenAddress));
    log(`行情返回 ${pairs.length} 个交易对`);

    // 按 链+代币 归组
    const byKey = new Map();
    for (const p of pairs) {
      const addr = p.baseToken && p.baseToken.address;
      if (!addr) continue;
      const k = keyOf(p.chainId, addr);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(p);
    }

    const metaByKey = new Map(sliced.map((c) => [keyOf(c.chainId, c.tokenAddress), c.meta]));
    const now = Date.now();
    const out = [];
    const seenKeys = new Set();

    for (const [k, list] of byKey) {
      const [chainId] = k.split(':');
      const pool = S.bestPair(list.filter((p) => p.chainId === chainId));
      if (!pool) continue;
      // 排除稳定币对稳定币这种无意义标的
      const baseSym = ((pool.baseToken && pool.baseToken.symbol) || '').toUpperCase();
      if (/^(USDC|USDT|DAI|USDE|FUSD|PYUSD|USD1|SUSD|BUSDD?)$/.test(baseSym)) continue;
      const meta = metaByKey.get(k) || {};
      const cur = S.normalizePair(pool, meta);
      if (!cur) continue;

      // 质量地板：深度/成交太低的池子没有可读性，直接不纳入雷达（自选标的不受限制）
      const isWatch = state.watchlist.some((w) => keyOf(w.chainId, w.tokenAddress) === k);
      const vol24 = (cur.volume && cur.volume.h24) || 0;
      if (!isWatch && (cur.liquidityUsd < 8000 || vol24 < 3000)) continue;

      const prev = state.snapshots[k] || null;
      cur._dtSec = prev ? Math.max(0, (now - prev.ts) / 1000) : 0;
      // 快照太旧（重启/长时间断档）时不拿它当区间基准，避免把跨越几小时的增量当成 5 分钟爆发
      cur.hasHistory = !!(prev && cur._dtSec > 30 && cur._dtSec <= 900);
      if (!cur.hasHistory) cur._dtSec = 0;

      const scored = scoreToken(cur, prev, now);

      // 快照历史（价格/深度/分数）
      const hist = state.history[k] || (state.history[k] = []);
      hist.push({
        ts: now,
        priceUsd: cur.priceUsd,
        liqUsd: cur.liquidityUsd,
        volH24: (cur.volume && cur.volume.h24) || 0,
        buyers: cur._m5buys,
        sellers: cur._m5sells,
        score: scored.score,
      });
      if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);

      state.snapshots[k] = {
        ts: now,
        priceUsd: cur.priceUsd,
        liqUsd: cur.liquidityUsd,
        volH24: (cur.volume && cur.volume.h24) || 0,
      };

      out.push({ key: k, ...cur, ...scored, history: sparkOf(hist) });
      seenKeys.add(k);
    }

    // 清理 24 小时未出现的历史，避免无限增长
    for (const k of Object.keys(state.history)) {
      if (seenKeys.has(k)) continue;
      const h = state.history[k];
      if (!h.length || now - h[h.length - 1].ts > 864e5) { delete state.history[k]; delete state.snapshots[k]; }
    }

    out.sort((a, b) => b.score - a.score);

    // 信号账本：把本轮榜单原样喂进去 —— 记录开仓快照、结算到点的信号、推进榜单指数。
    // 用的是本轮已经拉到的行情，所以常规路径上是零额外请求。
    const lo = Ledger.observe(state.ledger, out, now);
    // 已经到点、但本轮榜单里已经没有的标的（多半是掉出榜单或池子变淡），
    // 按 key 批量补一次价格再结算，否则这批会永远停在「待结算」。
    if (lo.needPrices.length) {
      const filled = await backfillPrices(lo.needPrices, Date.now());
      if (filled) log(`账本补价：待补 ${lo.needPrices.length} 个，补上并结算 ${filled} 个视界`);
    }
    saveLedgerSoon();

    state.tokens = out;
    state.lastScanAt = now;
    state.lastScanMs = now - t0;
    state.scanCount++;
    state.meta = buildMeta(out, sliced.length);
    state.sources = {
      dexTokensFetched: pairs.length,
      universeSize: uniq.length,
      poolsScored: out.length,
      dexscreener: 'ok',
    };
    log(`完成：${out.length} 个标的，用时 ${state.lastScanMs}ms ｜ 账本 开仓 +${lo.opened} 结算 +${lo.settled}`);

    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(RADAR_FILE, JSON.stringify({ updatedAt: now, tokens: state.tokens, meta: state.meta }));
    } catch (e) { console.warn('[radar] 写缓存失败：', e.message); }

    saveStateSoon();
    return { ok: true, count: out.length, ms: state.lastScanMs };
  } catch (e) {
    state.lastError = String((e && e.message) || e);
    console.error('[scan] 失败：', state.lastError);
    return { ok: false, error: state.lastError };
  } finally {
    state.scanning = false;
  }
}

/**
 * 为「已到点但不在本轮榜单里」的信号补一次价格。
 *
 * 传进来的是账本内部 key（chainId:小写地址），但真正拿去查询时必须用信号里
 * 存的原始 tokenAddress —— Solana 的 base58 地址区分大小写，用小写 key 去查会查不到。
 */
async function backfillPrices(keys, now) {
  const byKey = {};
  for (const id of Object.keys(state.ledger.signals)) {
    const s = state.ledger.signals[id];
    if (s && s.k && s.tokenAddress && !byKey[s.k]) byKey[s.k] = s.tokenAddress;
  }
  const addrs = keys.slice(0, MAX_BACKFILL).map((k) => byKey[k]).filter(Boolean);
  if (!addrs.length) return 0;

  let pairs = [];
  try { pairs = await S.dexTokens(addrs); } catch (e) { return 0; }

  // 同一个代币可能有多个池，与主流程同一口径取最有代表性的那个
  const grouped = new Map();
  for (const p of pairs) {
    const a = p.baseToken && p.baseToken.address;
    if (!a) continue;
    const k = keyOf(p.chainId, a);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(p);
  }
  const priceMap = {};
  for (const [k, list] of grouped) {
    const [chainId] = k.split(':');
    const pool = S.bestPair(list.filter((p) => p.chainId === chainId));
    const price = pool ? (Number(pool.priceUsd) || 0) : 0;
    if (price > 0) priceMap[k] = price;
  }
  return Ledger.settle(state.ledger, priceMap, now);
}

/** 迷你走势：把历史压成 [[ts,price],...] 供前端画 sparkline */function sparkOf(hist) {
  const n = hist.length;
  if (!n) return [];
  const maxPts = 60;
  const step = Math.max(1, Math.ceil(n / maxPts));
  const out = [];
  for (let i = 0; i < n; i += step) out.push([hist[i].ts, hist[i].priceUsd]);
  const last = hist[n - 1];
  if (out.length && out[out.length - 1][0] !== last.ts) out.push([last.ts, last.priceUsd]);
  return out;
}

function buildMeta(tokens, universeSize) {
  const byChain = {};
  const byChainId = {};
  const byGrade = {};
  for (const t of tokens) {
    byChain[t.chainLabel || t.chainId] = (byChain[t.chainLabel || t.chainId] || 0) + 1;
    byChainId[t.chainId] = (byChainId[t.chainId] || 0) + 1;
    byGrade[t.grade] = (byGrade[t.grade] || 0) + 1;
  }
  const liqSum = tokens.reduce((s, t) => s + (t.liquidityUsd || 0), 0);
  const volSum = tokens.reduce((s, t) => s + ((t.volume && t.volume.h24) || 0), 0);
  const avgScore = tokens.length ? Math.round(tokens.reduce((s, t) => s + t.score, 0) / tokens.length) : 0;
  return { byChain, byChainId, byGrade, universeSize, liqSum, volSum, avgScore, chains: Object.keys(S.CHAIN_LABEL) };
}

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function filterTokens(url) {
  const chain = url.searchParams.get('chain') || 'all';
  const view = url.searchParams.get('view') || 'all';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const sort = url.searchParams.get('sort') || 'score';
  const limit = Math.min(400, Number(url.searchParams.get('limit') || 240));
  const minLiq = Number(url.searchParams.get('minLiq') || 0);
  const maxMcap = Number(url.searchParams.get('maxMcap') || 0);
  const grade = url.searchParams.get('grade') || '';

  let list = state.tokens.slice();
  if (chain !== 'all') list = list.filter((t) => t.chainId === chain);
  if (grade) list = list.filter((t) => t.grade === grade);
  if (minLiq > 0) list = list.filter((t) => (t.liquidityUsd || 0) >= minLiq);
  if (maxMcap > 0) list = list.filter((t) => (t.fdv || 0) > 0 && t.fdv <= maxMcap);
  if (q) list = list.filter((t) => (t.symbol + ' ' + t.name + ' ' + t.tokenAddress).toLowerCase().includes(q));

  // 分榜视图
  if (view === 'burst') {
    list.sort((a, b) => (b.factors.volBurst.raw * 100 + b.factors.accel.raw * 10) - (a.factors.volBurst.raw * 100 + a.factors.accel.raw * 10));
  } else if (view === 'latent') {
    list = list.filter((t) => {
      const pc = t.priceChange || {};
      const h24 = Number(pc.h24) || 0;
      return h24 > -25 && h24 < 45 && t.factors.buyPressure.raw > 0.08 && t.factors.volBurst.raw > 0.8;
    });
    list.sort((a, b) => (b.factors.buyPressure.score * 0.5 + b.factors.volBurst.score * 0.5) - (a.factors.buyPressure.score * 0.5 + a.factors.volBurst.score * 0.5));
  } else if (view === 'hot') {
    list.sort((a, b) => (b.factors.social.score * 1e3 + (b.volume.h24 || 0) / 1e3) - (a.factors.social.score * 1e3 + (a.volume.h24 || 0) / 1e3));
  } else if (view === 'new') {
    list = list.filter((t) => t.pairCreatedAt && Date.now() - t.pairCreatedAt < 864e5);
    list.sort((a, b) => b.pairCreatedAt - a.pairCreatedAt);
  } else if (view === 'liq') {
    list.sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  } else {
    const sorts = {
      score: (a, b) => b.score - a.score,
      h1: (a, b) => (b.priceChange.h1 || -999) - (a.priceChange.h1 || -999),
      h6: (a, b) => (b.priceChange.h6 || -999) - (a.priceChange.h6 || -999),
      h24: (a, b) => (b.priceChange.h24 || -999) - (a.priceChange.h24 || -999),
      vol: (a, b) => (b.volume.h24 || 0) - (a.volume.h24 || 0),
      conf: (a, b) => b.confidence - a.confidence,
      risk: (a, b) => a.risk - b.risk,
    };
    list.sort(sorts[sort] || sorts.score);
  }
  return list.slice(0, limit);
}

// ------------------------------------------------------------------ 四维体检
// 与 src/engine.js 的 runCheckupFor 保持同一口径：同一批 lib/*.js，同样的按需触发
// 与缓存策略。差异只在于进程内记忆与会话内并发去重由 Node 侧独立维护。
const checking = {};

async function runCheckup(chainId, addr, opts = {}) {
  const k = keyOf(chainId, addr);
  if (state.checkupCache[k] && !opts.force) return state.checkupCache[k];
  if (checking[k]) return checking[k];
  checking[k] = (async () => {
    try {
      let tok = state.tokens.find((x) => x.key === k) || null;
      // 标的可能不在本轮候选池里（用户直接给合约地址）。叙事与位置两个维度都依赖
      // 成交流水、市值与池子深度，缺了它们会退化成噪声，所以先补一次单币行情。
      let marketOffline = false;
      if (!tok) {
        try {
          const pair = await S.dexToken(addr);
          if (pair) {
            const cur = S.normalizePair(pair, {});
            tok = { key: k, history: [], ...cur, ...scoreToken(cur, null, Date.now()) };
            marketOffline = true;
          }
        } catch (e) { /* 拉不到就退化为只有合约数据的体检，由模型自行降级 */ }
      }
      const sec = await Sec.fetchSecurity({
        chainId,
        tokenAddress: addr,
        symbol: tok && tok.symbol,
        fdv: tok && tok.fdv,
        pairAddress: tok && tok.pairAddress,
      }, { deep: true });
      const report = Checkup.runCheckup(
        tok || { chainId, tokenAddress: addr },
        sec, state.checkupPrev[k] || null, opts.profile
      );
      report.secSources = sec.sources;
      report.secGaps = sec.gaps;
      report.copycat = sec.copycat || null;
      report.rug = sec.rug || null;
      report.cached = !!sec.cached;
      report.marketOffline = marketOffline;
      report.marketMissing = !tok;
      state.checkupCache[k] = report;
      const hc = report.chips && report.chips.holderCount;
      if (hc > 0) { state.checkupPrev[k] = { holderCount: hc, at: Date.now() }; saveStateSoon(); }
      return report;
    } catch (e) {
      return { ok: false, error: '上游风控接口调用失败：' + String((e && e.message) || e) };
    } finally {
      delete checking[k];
    }
  })();
  return checking[k];
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/health') {
    return send(res, 200, {
      ok: true,
      scanning: state.scanning,
      lastScanAt: state.lastScanAt,
      lastScanMs: state.lastScanMs,
      scanCount: state.scanCount,
      tokens: state.tokens.length,
      watchlist: state.watchlist.length,
      sources: state.sources,
      error: state.lastError,
      ledger: {
        signals: Object.keys(state.ledger.signals).length,
        opened: state.ledger.counts.opened || 0,
        settled: state.ledger.counts.settled || 0,
        gaveUp: state.ledger.counts.gaveUp || 0,
        rounds: state.ledger.counts.rounds || 0,
        indexPoints: state.ledger.index.length,
        startedAt: state.ledger.startedAt || 0,
        lastTs: state.ledger.lastTs || 0,
      },
    });
  }

  if (p === '/api/meta') {
    return send(res, 200, {
      chains: S.CHAIN_LABEL,
      defaultChains: S.DEFAULT_CHAINS,
      weights: WEIGHTS,
      grades: GRADES,
      scanIntervalMs: SCAN_INTERVAL_MS,
      meta: state.meta,
    });
  }

  if (p === '/api/radar') {
    const list = filterTokens(url);
    return send(res, 200, {
      updatedAt: state.lastScanAt,
      scanning: state.scanning,
      scanIntervalMs: SCAN_INTERVAL_MS,
      count: list.length,
      total: state.tokens.length,
      meta: state.meta,
      sources: state.sources,
      error: state.lastError,
      tokens: list,
    });
  }

  // 抓龙胜率：信号账本的前瞻回测结果。
  // 不做历史回放（八个因子里有四个在公开历史数据里根本不存在），只报「先记录、后结算」
  // 的真实样本。胜率、榜单指数基准、样本流失率三个数必须同时给出，缺一个都会误导。
  if (p === '/api/backtest') {
    const opts = {
      horizon: url.searchParams.get('horizon') || '1h',
      // 默认口径是策略本身：只买真龙。其余两条腿（升级 / 首现）保留作对照。
      why: url.searchParams.get('why') || 'dragon',
      chain: url.searchParams.get('chain') || '',
    };
    return send(res, 200, {
      summary: Ledger.summarize(state.ledger, opts),
      // state=all：明细要能看到流失与待结算的标的（页面上有独立的状态列），
      // 但胜率的分母只取已结算，这一点由 summarize 统一保证。
      samples: Ledger.samples(state.ledger, { ...opts, state: 'all', limit: Math.min(200, Number(url.searchParams.get('limit') || 60)) }),
      series: Ledger.indexSeries(state.ledger, 160),
      horizons: Ledger.HORIZONS,
      whyLabels: Ledger.WHY_LABEL,
      reasonLabels: Ledger.REASON_LABEL,
      gradeLabels: Ledger.GRADE_LABEL,
    });
  }

  // 清空账本重新开始积累：只是把账本重置，不影响榜单与自选
  if (p === '/api/backtest/reset') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    Ledger.reset(state.ledger);
    saveLedgerSoon();
    return send(res, 200, { ok: true, ledger: Ledger.summarize(state.ledger, {}) });
  }

  if (p.startsWith('/api/token/')) {
    const parts = p.replace('/api/token/', '').split('/');
    const chainId = parts[0];
    const addr = parts[1];
    if (!chainId || !addr) return send(res, 400, { error: '缺少 chainId 或代币地址' });
    const k = keyOf(chainId, addr);
    const t = state.tokens.find((x) => x.key === k);
    if (!t) {
      // 不在当前候选池里也能查（用户手动输入合约）
      try {
        const pair = await S.dexToken(addr);
        if (!pair) return send(res, 404, { error: '未找到该代币的交易对' });
        const cur = S.normalizePair(pair, {});
        const scored = scoreToken(cur, null, Date.now());
        return send(res, 200, { token: { key: k, ...cur, ...scored, history: [] }, offline: true });
      } catch (e) {
        return send(res, 502, { error: '上游查询失败：' + e.message });
      }
    }
    const hist = (state.history[k] || []).slice(-120);
    return send(res, 200, { token: { ...t, historyFull: hist } });
  }

  // 四维体检（安全 / 叙事 / 筹码 / 位置）
  // 外部风控接口（GoPlus 免费档一次只受理一个地址、RugCheck 全量报告可达数 MB）
  // 不能逐轮全池调用：这里按需触发 + 6 小时缓存，与静态形态的引擎行为一致。
  if (p.startsWith('/api/checkup/')) {
    const parts = p.replace('/api/checkup/', '').split('/');
    const chainId = decodeURIComponent(parts[0] || '');
    const addr = decodeURIComponent(parts[1] || '');
    if (!chainId || !addr) return send(res, 400, { error: '缺少 chainId 或代币地址' });
    try {
      const r = await runCheckup(chainId, addr, {
        force: url.searchParams.get('force') === '1',
        profile: url.searchParams.get('capital')
          ? { totalCapitalUsd: Number(url.searchParams.get('capital')) }
          : undefined,
      });
      return send(res, r.ok === false ? 502 : 200, r);
    } catch (e) {
      return send(res, 502, { ok: false, error: '体检失败：' + e.message });
    }
  }

  if (p === '/api/price') {
    const addr = url.searchParams.get('address');
    if (!addr) return send(res, 400, { error: '缺少 address' });
    const c = state.priceCache[addr];
    if (c && Date.now() - c.at < 30000) return send(res, 200, { price: c });
    const pair = await S.dexToken(addr);
    if (!pair) return send(res, 404, { error: '无报价' });
    const rec = {
      priceUsd: Number(pair.priceUsd) || 0,
      symbol: (pair.baseToken && pair.baseToken.symbol) || '',
      name: (pair.baseToken && pair.baseToken.name) || '',
      chainId: pair.chainId,
      at: Date.now(),
    };
    state.priceCache[addr] = rec;
    return send(res, 200, { price: rec });
  }

  if (p === '/api/watchlist') {
    if (req.method === 'GET') return send(res, 200, { watchlist: state.watchlist });
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (!body || !body.tokenAddress) return send(res, 400, { error: '缺少 tokenAddress' });
      let chainId = body.chainId;
      let symbol = body.symbol || '';
      if (!chainId || !symbol) {
        const pair = await S.dexToken(body.tokenAddress);
        if (pair) {
          chainId = chainId || pair.chainId;
          symbol = symbol || ((pair.baseToken && pair.baseToken.symbol) || '');
        }
      }
      chainId = chainId || 'base';
      const k = keyOf(chainId, body.tokenAddress);
      if (!state.watchlist.some((w) => keyOf(w.chainId, w.tokenAddress) === k)) {
        state.watchlist.push({ chainId, tokenAddress: body.tokenAddress, symbol });
        saveStateSoon();
      }
      return send(res, 200, { ok: true, watchlist: state.watchlist });
    }
    if (req.method === 'DELETE') {
      const addr = url.searchParams.get('address');
      const chainId = url.searchParams.get('chainId');
      state.watchlist = state.watchlist.filter((w) => !(w.tokenAddress === addr && (!chainId || w.chainId === chainId)));
      saveStateSoon();
      return send(res, 200, { ok: true, watchlist: state.watchlist });
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  if (p === '/api/scan') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (state.scanning) return send(res, 200, { ok: true, alreadyRunning: true });
    scan();
    return send(res, 202, { ok: true, started: true });
  }

  if (p.startsWith('/api/fomo/')) {
    const handle = decodeURIComponent(p.replace('/api/fomo/', '').trim());
    if (!handle) return send(res, 400, { error: '缺少 handle' });
    const token = req.headers['x-fomo-token'] || '';
    const r = await S.fomoUser(handle, token);
    return send(res, r.needsAuth ? 401 : r.ok ? 200 : 502, r);
  }

  return send(res, 404, { error: 'unknown api' });
}

function readJson(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, url); }
    catch (e) { send(res, 500, { error: String((e && e.message) || e) }); }
    return;
  }
  serveStatic(req, res, url.pathname);
});

// 退出时同步落盘。saveStateSoon / saveLedgerSoon 都是 setTimeout，进程一 exit 就再也不会执行，
// 光调它们等于什么都没写 —— 账本攒了几小时的数据不能就这么丢。
function flushSync() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (ledgerTimer) { clearTimeout(ledgerTimer); ledgerTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ watchlist: state.watchlist, history: state.history, snapshots: state.snapshots, checkupPrev: state.checkupPrev }));
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(state.ledger));
    console.log('[state] 已同步落盘（state.json、ledger.json）');
  } catch (e) { console.warn('[state] 退出落盘失败：', e.message); }
}

// ------------------------------------------------------------------ 启动
function main() {
  loadState();
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 被占用，请换端口：PORT=8792 node server.js`);
    console.error('[server] 错误：', e.message);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`抓龙雷达已启动： http://127.0.0.1:${PORT}`);
    console.log(`扫描间隔 ${SCAN_INTERVAL_MS / 1000}s ｜ 自选 ${state.watchlist.length} 个`);
    console.log(`信号账本：已有 ${Object.keys(state.ledger.signals).length} 个信号，${state.ledger.index.length} 个指数点`);
    scan().then((r) => console.log('[scan] 首轮结果', r));
    setInterval(() => { scan(); }, SCAN_INTERVAL_MS);
  });
  process.on('SIGINT', () => { flushSync(); process.exit(0); });
  process.on('SIGTERM', () => { flushSync(); process.exit(0); });
}

if (require.main === module) main();

module.exports = { scan, filterTokens, state, server, main, flushSync, Ledger };
