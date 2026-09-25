/**
 * 浏览器端数据引擎（静态部署用）
 *
 * 与 server.js 的编排层等价：建候选池 -> 批量取行情 -> 算龙分 -> 快照落盘（localStorage）。
 * 打分口径完全复用 lib/score.js，两条运行形态的结论一致。
 *
 * 依赖：window.DragonSources、window.DragonScore（由 lib/*.js 以普通 script 方式加载）。
 * 导出：window.DragonEngine
 */
(function (root) {
  'use strict';

  var S = root.DragonSources;
  var SC = root.DragonScore;
  // 账本（lib/ledger.js）缺失时引擎照常跑，只是没有回测；不让它成为整站的硬依赖。
  var L = root.DragonLedger || null;
  if (!S || !SC) throw new Error('DragonEngine 需要先加载 lib/sources.js 与 lib/score.js');

  var KEY = 'dr.static.v1';
  // 账本单独存一份：它比榜单快照大得多，混在同一个 key 里任何一次写入都会顶到配额。
  var LEDGER_KEY = 'dr.ledger.v1';
  var SCAN_INTERVAL_MS = 60000;
  var MAX_HISTORY = 90;
  var MAX_TOKENS = 260;
  var MAX_BACKFILL = 120;          // 单轮最多为多少个待结算信号补价

  var state = {
    tokens: [],
    history: {},
    snapshots: {},
    watchlist: [],
    lastScanAt: 0,
    lastScanMs: 0,
    scanCount: 0,
    scanning: false,
    error: null,
    meta: {},
    sources: {},
  };

  var keyOf = function (chainId, addr) { return chainId + ':' + String(addr).toLowerCase(); };

  // ------------------------------------------------------------- 变更通知
  // 扫描是异步的，页面第一次渲染时结果可能还没出来。这里让引擎在扫描开始与结束时
  // 主动通知订阅者，前端可以立刻重绘，不必干等下一个轮询周期。
  var listeners = [];
  function onChange(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }
  function emit() {
    listeners.slice().forEach(function (f) {
      try { f(state); } catch (e) { /* 单个订阅者出错不影响引擎 */ }
    });
  }

  // ------------------------------------------------------------- 持久化
  function save() {
    var payload = {
      v: 1,
      watchlist: state.watchlist,
      snapshots: state.snapshots,
      history: state.history,
      tokens: state.tokens.map(function (t) { var c = Object.assign({}, t); delete c.history; return c; }),
      lastScanAt: state.lastScanAt,
      lastScanMs: state.lastScanMs,
      scanCount: state.scanCount,
      meta: state.meta,
      sources: state.sources,
      checkupPrev: checkupPrev,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (e) {
      // 配额超限：退化为只保留自选与快照，下一轮仍可继续算区间增量
      try {
        localStorage.setItem(KEY, JSON.stringify({
          v: 1, watchlist: state.watchlist, snapshots: state.snapshots,
          history: {}, tokens: [], lastScanAt: state.lastScanAt, meta: state.meta, sources: state.sources,
        }));
      } catch (e2) { /* 浏览器禁用了 localStorage，静默降级为仅内存 */ }
    }
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try {
      var j = JSON.parse(raw);
      state.watchlist = Array.isArray(j.watchlist) ? j.watchlist : [];
      state.snapshots = j.snapshots && typeof j.snapshots === 'object' ? j.snapshots : {};
      state.history = j.history && typeof j.history === 'object' ? j.history : {};
      state.meta = j.meta || {};
      state.sources = j.sources || {};
      state.scanCount = j.scanCount || 0;
      state.lastScanAt = j.lastScanAt || 0;
      state.lastScanMs = j.lastScanMs || 0;
      checkupPrev = j.checkupPrev && typeof j.checkupPrev === 'object' ? j.checkupPrev : {};
      state.tokens = (Array.isArray(j.tokens) ? j.tokens : []).map(function (t) {
        t.history = state.history[t.key] || [];
        return t;
      });
    } catch (e) { /* 缓存损坏则忽略，重新扫描即可 */ }
  }

  // ------------------------------------------------------------- 信号账本
  /**
   * 前瞻记录 + 事后结算。要说清一个静态形态固有的局限：只有页面开着的时候才在采集，
   * 关闭的那段时间没有观测点。到期时补不到价格的信号会被记成「流失」，页面上如实显示，
   * 不会悄悄从分母里消失。想要连续采集请用 Node 形态（npm start）常驻运行。
   */
  var ledger = L ? L.create() : null;
  var lastLedgerSave = 0;

  function saveLedger() {
    if (!ledger || !L) return;
    var now = Date.now();
    // 账本比榜单快照大得多，不必每轮序列化一次
    if (now - lastLedgerSave < 60000) return;
    lastLedgerSave = now;
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    } catch (e) {
      // 配额超限：退化为只留信号与指数，丢掉观测序列。
      // 结算与胜率仍然可用，只失去「最大不利偏移」与「掉榜回补」两条路径。
      try {
        localStorage.setItem(LEDGER_KEY, JSON.stringify({
          v: ledger.v, startedAt: ledger.startedAt, lastTs: ledger.lastTs, seq: ledger.seq,
          signals: ledger.signals, index: ledger.index,
          indexLevel: ledger.indexLevel, marketLevel: ledger.marketLevel,
          prev: ledger.prev, counts: ledger.counts,
        }));
      } catch (e2) { /* 浏览器禁用或实在存不下，就只留在内存里 */ }
    }
  }

  function loadLedger() {
    if (!L) return;
    var raw = null;
    try { raw = localStorage.getItem(LEDGER_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    try { ledger = L.normalize(JSON.parse(raw)); } catch (e) { ledger = L.create(); }
  }

  // ------------------------------------------------------------- 扫描
  function buildMeta(tokens, universeSize) {
    var byChain = {}, byChainId = {}, byGrade = {};
    tokens.forEach(function (t) {
      byChain[t.chainLabel || t.chainId] = (byChain[t.chainLabel || t.chainId] || 0) + 1;
      byChainId[t.chainId] = (byChainId[t.chainId] || 0) + 1;
      byGrade[t.grade] = (byGrade[t.grade] || 0) + 1;
    });
    var liqSum = 0, volSum = 0, scoreSum = 0;
    tokens.forEach(function (t) {
      liqSum += t.liquidityUsd || 0;
      volSum += (t.volume && t.volume.h24) || 0;
      scoreSum += t.score || 0;
    });
    return {
      byChain: byChain, byChainId: byChainId, byGrade: byGrade,
      universeSize: universeSize, liqSum: liqSum, volSum: volSum,
      avgScore: tokens.length ? Math.round(scoreSum / tokens.length) : 0,
      chains: Object.keys(S.CHAIN_LABEL),
    };
  }

  var scanning = false;
  async function runScan(opts) {
    opts = opts || {};
    if (scanning) return { skipped: true };
    scanning = true;
    state.scanning = true;
    var t0 = Date.now();
    var log = opts.log || function () {};
    emit();
    try {
      state.error = null;

      var carry = state.tokens
        .filter(function (t) { return t.score >= 50 || t.grade === 'dragon' || t.grade === 'candidate'; })
        .slice(0, 80)
        .map(function (t) { return { chainId: t.chainId, tokenAddress: t.tokenAddress, source: 'carry' }; });

      var extra = state.watchlist.map(function (w) {
        return { chainId: w.chainId, tokenAddress: w.tokenAddress, source: 'watchlist' };
      }).concat(carry);

      var universe = await S.buildUniverse({ extra: extra, log: log });

      var known = {};
      Object.keys(S.CHAIN_LABEL).forEach(function (k) { known[k] = true; });
      var seen = {}, uniq = [];
      universe.forEach(function (c) {
        if (!known[c.chainId]) return;
        var k = keyOf(c.chainId, c.tokenAddress);
        if (seen[k]) return;
        seen[k] = true;
        uniq.push(c);
      });
      var sliced = uniq.slice(0, MAX_TOKENS);
      log('候选池 ' + uniq.length + ' 个，本轮处理 ' + sliced.length + ' 个');

      var pairs = await S.dexTokens(sliced.map(function (c) { return c.tokenAddress; }));
      log('行情返回 ' + pairs.length + ' 个交易对');

      var byKey = {};
      pairs.forEach(function (p) {
        var addr = p.baseToken && p.baseToken.address;
        if (!addr) return;
        var k = keyOf(p.chainId, addr);
        (byKey[k] || (byKey[k] = [])).push(p);
      });

      var metaByKey = {};
      sliced.forEach(function (c) { metaByKey[keyOf(c.chainId, c.tokenAddress)] = c.meta; });

      var now = Date.now();
      var out = [];
      var stableRe = /^(USDC|USDT|DAI|USDE|FUSD|PYUSD|USD1|SUSD|BUSDD?)$/;

      Object.keys(byKey).forEach(function (k) {
        var chainId = k.split(':')[0];
        var list = byKey[k].filter(function (p) { return p.chainId === chainId; });
        var pool = S.bestPair(list);
        if (!pool) return;
        var baseSym = ((pool.baseToken && pool.baseToken.symbol) || '').toUpperCase();
        if (stableRe.test(baseSym)) return;

        var cur = S.normalizePair(pool, metaByKey[k] || {});
        if (!cur) return;

        var isWatch = state.watchlist.some(function (w) { return keyOf(w.chainId, w.tokenAddress) === k; });
        var vol24 = (cur.volume && cur.volume.h24) || 0;
        if (!isWatch && (cur.liquidityUsd < 8000 || vol24 < 3000)) return;

        var prev = state.snapshots[k] || null;
        cur._dtSec = prev ? Math.max(0, (now - prev.ts) / 1000) : 0;
        cur.hasHistory = !!(prev && cur._dtSec > 30 && cur._dtSec <= 900);
        if (!cur.hasHistory) cur._dtSec = 0;

        var scored = SC.scoreToken(cur, prev, now);

        var hist = state.history[k] || (state.history[k] = []);
        hist.push([now, cur.priceUsd]);
        if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);

        state.snapshots[k] = {
          ts: now,
          priceUsd: cur.priceUsd,
          liqUsd: cur.liquidityUsd,
          volH24: (cur.volume && cur.volume.h24) || 0,
        };

        var tok = Object.assign({ key: k }, cur, scored);
        tok.history = hist.slice(-MAX_HISTORY);
        out.push(tok);
      });

      // 清理超过 24 小时未出现的历史
      Object.keys(state.history).forEach(function (k) {
        var h = state.history[k];
        if (!h.length || now - h[h.length - 1][0] > 864e5) { delete state.history[k]; delete state.snapshots[k]; }
      });

      out.sort(function (a, b) { return b.score - a.score; });

      // 信号账本：用本轮已经拿到的行情记录快照 / 结算到点的信号 / 推进榜单指数，
      // 常规路径零额外请求。needPrices 非空时才对外补一次价格。
      if (ledger && L) {
        var lo = L.observe(ledger, out, now);
        if (lo.needPrices.length) {
          var filled = await backfillPrices(lo.needPrices, Date.now());
          if (filled) log('账本补价：待补 ' + lo.needPrices.length + ' 个，补上并结算 ' + filled + ' 个视界');
        }
        saveLedger();
        log('账本：开仓 +' + lo.opened + '，结算 +' + lo.settled);
      }

      state.tokens = out;
      state.lastScanAt = now;
      state.lastScanMs = now - t0;
      state.scanCount++;
      state.meta = buildMeta(out, uniq.length);
      state.sources = {
        dexTokensFetched: pairs.length,
        universeSize: uniq.length,
        poolsScored: out.length,
        dexscreener: 'ok',
      };
      log('完成：' + out.length + ' 个标的，用时 ' + state.lastScanMs + 'ms');
      save();
      return { ok: true, count: out.length, ms: state.lastScanMs };
    } catch (e) {
      state.error = String((e && e.message) || e);
      return { ok: false, error: state.error };
    } finally {
      scanning = false;
      state.scanning = false;
      emit();
    }
  }

  /**
   * 为「已到点但不在本轮榜单里」的信号补一次价格。
   * 账本内部的 key 是小写化的地址，但查询必须用信号里存的原始 tokenAddress ——
   * Solana 的 base58 地址区分大小写，用小写 key 去查会查不到。
   */
  async function backfillPrices(keys, now) {
    if (!ledger) return 0;
    var byKey = {};
    Object.keys(ledger.signals).forEach(function (id) {
      var s = ledger.signals[id];
      if (s && s.k && s.tokenAddress && !byKey[s.k]) byKey[s.k] = s.tokenAddress;
    });
    var addrs = keys.slice(0, MAX_BACKFILL).map(function (k) { return byKey[k]; })
      .filter(function (a) { return !!a; });
    if (!addrs.length) return 0;

    var pairs = [];
    try { pairs = await S.dexTokens(addrs); } catch (e) { return 0; }

    // 同一代币多个池，与主流程同口径取最有代表性的那个
    var grouped = {};
    pairs.forEach(function (p) {
      var a = p.baseToken && p.baseToken.address;
      if (!a) return;
      var k = keyOf(p.chainId, a);
      (grouped[k] || (grouped[k] = [])).push(p);
    });
    var priceMap = {};
    Object.keys(grouped).forEach(function (k) {
      var chainId = k.split(':')[0];
      var pool = S.bestPair(grouped[k].filter(function (p) { return p.chainId === chainId; }));
      var price = pool ? (Number(pool.priceUsd) || 0) : 0;
      if (price > 0) priceMap[k] = price;
    });
    return L.settle(ledger, priceMap, now);
  }

  /** 回测视图的数据源：汇总 + 样本明细 + 指数曲线 */
  function backtest(opts) {
    opts = opts || {};
    if (!ledger || !L) {
      return {
        available: false,
        error: '未加载 lib/ledger.js，回测不可用',
        summary: null, samples: [], series: [], horizons: [], whyLabels: {}, gradeLabels: {},
      };
    }
    var o = { horizon: opts.horizon || '1h', why: opts.why || 'all', chain: opts.chain || '' };
    return {
      available: true,
      summary: L.summarize(ledger, o),
      // state=all：明细带上流失与待结算的行（页面有独立状态列），
      // 胜率分母只取已结算，由 summarize 保证。
      samples: L.samples(ledger, { horizon: o.horizon, why: o.why, chain: o.chain, state: 'all', limit: Math.min(200, Number(opts.limit || 60)) }),
      series: L.indexSeries(ledger, 160),
      horizons: L.HORIZONS,
      whyLabels: L.WHY_LABEL,
      gradeLabels: L.GRADE_LABEL,
    };
  }

  function resetBacktest() {
    if (!ledger || !L) return false;
    L.reset(ledger);
    lastLedgerSave = 0;
    saveLedger();
    emit();
    return true;
  }

  // ------------------------------------------------------------- 查询
  function filterTokens(q) {
    var chain = q.chain || 'all';
    var view = q.view || 'all';
    var sort = q.sort || 'score';
    var search = (q.q || '').trim().toLowerCase();
    var limit = Math.min(400, Number(q.limit || 240));
    var minLiq = Number(q.minLiq || 0);
    var maxMcap = Number(q.maxMcap || 0);
    var grade = q.grade || '';

    var list = state.tokens.slice();
    if (chain !== 'all') list = list.filter(function (t) { return t.chainId === chain; });
    if (grade) list = list.filter(function (t) { return t.grade === grade; });
    if (minLiq > 0) list = list.filter(function (t) { return (t.liquidityUsd || 0) >= minLiq; });
    if (maxMcap > 0) list = list.filter(function (t) { return (t.fdv || 0) > 0 && t.fdv <= maxMcap; });
    if (search) list = list.filter(function (t) {
      return (t.symbol + ' ' + t.name + ' ' + t.tokenAddress).toLowerCase().indexOf(search) >= 0;
    });

    if (view === 'burst') {
      list.sort(function (a, b) {
        return (b.factors.volBurst.raw * 100 + b.factors.accel.raw * 10) - (a.factors.volBurst.raw * 100 + a.factors.accel.raw * 10);
      });
    } else if (view === 'latent') {
      list = list.filter(function (t) {
        var h24 = Number(t.priceChange.h24) || 0;
        return h24 > -25 && h24 < 45 && t.factors.buyPressure.raw > 0.08 && t.factors.volBurst.raw > 0.8;
      });
      list.sort(function (a, b) {
        return (b.factors.buyPressure.score * 0.5 + b.factors.volBurst.score * 0.5) - (a.factors.buyPressure.score * 0.5 + a.factors.volBurst.score * 0.5);
      });
    } else if (view === 'hot') {
      list.sort(function (a, b) {
        return (b.factors.social.score * 1e3 + (b.volume.h24 || 0) / 1e3) - (a.factors.social.score * 1e3 + (a.volume.h24 || 0) / 1e3);
      });
    } else if (view === 'new') {
      list = list.filter(function (t) { return t.pairCreatedAt && Date.now() - t.pairCreatedAt < 864e5; });
      list.sort(function (a, b) { return b.pairCreatedAt - a.pairCreatedAt; });
    } else if (view === 'liq') {
      list.sort(function (a, b) { return (b.liquidityUsd || 0) - (a.liquidityUsd || 0); });
    } else {
      var sorts = {
        score: function (a, b) { return b.score - a.score; },
        h1: function (a, b) { return (b.priceChange.h1 || -999) - (a.priceChange.h1 || -999); },
        h6: function (a, b) { return (b.priceChange.h6 || -999) - (a.priceChange.h6 || -999); },
        h24: function (a, b) { return (b.priceChange.h24 || -999) - (a.priceChange.h24 || -999); },
        vol: function (a, b) { return (b.volume.h24 || 0) - (a.volume.h24 || 0); },
        conf: function (a, b) { return b.confidence - a.confidence; },
        risk: function (a, b) { return a.risk - b.risk; },
      };
      list.sort(sorts[sort] || sorts.score);
    }
    return list.slice(0, limit);
  }

  function radarResponse(q) {
    var list = filterTokens(q);
    return {
      updatedAt: state.lastScanAt,
      scanning: state.scanning,
      scanIntervalMs: SCAN_INTERVAL_MS,
      count: list.length,
      total: state.tokens.length,
      meta: state.meta,
      sources: state.sources,
      error: state.error,
      tokens: list,
    };
  }

  async function tokenDetail(chainId, addr) {
    var k = keyOf(chainId, addr);
    var t = state.tokens.find(function (x) { return x.key === k; });
    if (t) return { token: t };
    var pair = await S.dexToken(addr);
    if (!pair) return null;
    var cur = S.normalizePair(pair, {});
    var scored = SC.scoreToken(cur, null, Date.now());
    return { token: Object.assign({ key: k, history: [] }, cur, scored), offline: true };
  }

  var priceCache = {};
  async function price(addr) {
    var c = priceCache[addr];
    if (c && Date.now() - c.at < 30000) return c;
    var pair = await S.dexToken(addr);
    if (!pair) return null;
    var rec = {
      priceUsd: Number(pair.priceUsd) || 0,
      symbol: (pair.baseToken && pair.baseToken.symbol) || '',
      name: (pair.baseToken && pair.baseToken.name) || '',
      chainId: pair.chainId,
      at: Date.now(),
    };
    priceCache[addr] = rec;
    return rec;
  }

  async function addWatch(item) {
    var chainId = item.chainId, symbol = item.symbol || '';
    if (!chainId || !symbol) {
      var pair = await S.dexToken(item.tokenAddress);
      if (pair) {
        chainId = chainId || pair.chainId;
        symbol = symbol || ((pair.baseToken && pair.baseToken.symbol) || '');
      }
    }
    chainId = chainId || 'base';
    var k = keyOf(chainId, item.tokenAddress);
    var exists = state.watchlist.some(function (w) { return keyOf(w.chainId, w.tokenAddress) === k; });
    if (!exists) state.watchlist.push({ chainId: chainId, tokenAddress: item.tokenAddress, symbol: symbol });
    save();
    return state.watchlist;
  }

  function removeWatch(addr, chainId) {
    state.watchlist = state.watchlist.filter(function (w) {
      return !(w.tokenAddress === addr && (!chainId || w.chainId === chainId));
    });
    save();
    return state.watchlist;
  }

  function health() {
    return {
      ok: true,
      mode: 'static',
      scanning: state.scanning,
      lastScanAt: state.lastScanAt,
      lastScanMs: state.lastScanMs,
      scanCount: state.scanCount,
      tokens: state.tokens.length,
      watchlist: state.watchlist.length,
      sources: state.sources,
      error: state.error,
    };
  }

  // ------------------------------------------------------------- 四维体检
  // 体检要调外部风控接口，而 GoPlus 免费档一次只返回一个地址（实测不支持批量），
  // 对全池逐轮调用必然触发限流。因此走「按需触发 + 长缓存」：用户展开某个标的时
  // 才跑一次，结果在 lib/security.js 里缓存 6 小时，这里再加一层进程内记忆。
  var checkupCache = {};
  var checkupPrev = {};      // key -> { holderCount, at }，供叙事维度算持币地址增量
  var checking = {};

  async function runCheckupFor(chainId, addr, opts) {
    opts = opts || {};
    var k = keyOf(chainId, addr);
    if (checkupCache[k] && !opts.force) return checkupCache[k];
    if (checking[k]) return checking[k];
    if (!root.DragonSecurity || !root.DragonCheckup) {
      return { ok: false, error: '未加载安全数据层或体检模型（lib/security.js、lib/checkup.js）' };
    }
    var tok = state.tokens.filter(function (x) { return x.key === k; })[0] || null;
    var marketOffline = false;
    checking[k] = (async function () {
      try {
        // 标的可能不在本轮候选池里（用户直接给合约地址）。叙事与位置两个维度都依赖
        // 成交流水、市值与池子深度，缺了它们会退化成噪声，所以先补一次单币行情。
        if (!tok) {
          try {
            var pair = await S.dexToken(addr);
            if (pair) {
              var cur = S.normalizePair(pair, {});
              var scored = SC.scoreToken(cur, null, Date.now());
              tok = Object.assign({ key: k, history: [] }, cur, scored);
              marketOffline = true;
            }
          } catch (e) { /* 拉不到就退化为只有合约数据的体检，由模型自行降级 */ }
        }
        var sec = await root.DragonSecurity.fetchSecurity({
          chainId: chainId,
          tokenAddress: addr,
          symbol: tok && tok.symbol,
          fdv: tok && tok.fdv,
          pairAddress: tok && tok.pairAddress,
        }, { deep: true, log: opts.log });
        var report = root.DragonCheckup.runCheckup(
          tok || { chainId: chainId, tokenAddress: addr },
          sec, checkupPrev[k] || null, opts.profile
        );
        report.secSources = sec.sources;
        report.secGaps = sec.gaps;
        report.copycat = sec.copycat || null;
        report.rug = sec.rug || null;
        report.cached = !!sec.cached;
        report.marketOffline = marketOffline;
        report.marketMissing = !tok;
        checkupCache[k] = report;
        var hc = report.chips && report.chips.holderCount;
        if (hc > 0) checkupPrev[k] = { holderCount: hc, at: Date.now() };
        save();
        emit();
        return report;
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      } finally {
        delete checking[k];
      }
    })();
    return checking[k];
  }

  function clearCheckups() { checkupCache = {}; checkupPrev = {}; save(); }

  var timer = null;
  function start() {
    load();
    loadLedger();
    runScan({ log: function (m) { if (root.console) console.log('[scan] ' + m); } });
    timer = setInterval(function () { runScan(); }, SCAN_INTERVAL_MS);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  root.DragonEngine = {
    state: state,
    SCAN_INTERVAL_MS: SCAN_INTERVAL_MS,
    start: start,
    stop: stop,
    onChange: onChange,
    scan: runScan,
    radar: radarResponse,
    filterTokens: filterTokens,
    tokenDetail: tokenDetail,
    price: price,
    addWatch: addWatch,
    removeWatch: removeWatch,
    watchlist: function () { return state.watchlist; },
    health: health,
    checkup: runCheckupFor,
    clearCheckups: clearCheckups,
    checkupPrev: function () { return checkupPrev; },
    checkups: function () { return checkupCache; },
    backtest: backtest,
    resetBacktest: resetBacktest,
    ledger: function () { return ledger; },
  };
})(typeof self !== 'undefined' ? self : this);
