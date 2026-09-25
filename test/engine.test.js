/**
 * 浏览器端引擎 + 静态适配层的集成测试（零依赖，仅用 Node 内置能力）
 *
 * 做法：在进程内伪造一个最小浏览器全局环境（self / localStorage / fetch），
 * 然后按 UMD 的方式加载 lib 与 src，跑完整的「建候选池 -> 取行情 -> 打分 -> 落盘」链路。
 * 这样不需要真实网络，也不需要无头浏览器。
 *
 * 用法： node test/engine.test.js
 */
'use strict';

const path = require('path');

let pass = 0;
const failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  OK ' + name); }
  else { failures.push(name); console.log('  FAIL ' + name); }
}
function eq(a, b, name) { ok(a === b, name + '（实际 ' + JSON.stringify(a) + '）'); }

// ------------------------------------------------------------- 时间可控
const realNow = Date.now;
let clockOffset = 0;
Date.now = function () { return realNow() + clockOffset; };

// ------------------------------------------------------------- 伪浏览器环境
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
    get length() { return m.size; },
  };
}

globalThis.self = globalThis;
globalThis.localStorage = fakeStorage();

// ------------------------------------------------------------- 假行情
const T = {
  dragon: { chain: 'solana', addr: 'So111DRAGONaddr1111111111111111111111111', sym: 'DRGN' },
  weak: { chain: 'solana', addr: 'So111WEAKaddr111111111111111111111111111', sym: 'WEAK' },
  junk: { chain: 'base', addr: '0xJUNK000000000000000000000000000000000001', sym: 'JUNK' },
  stable: { chain: 'base', addr: '0xUSDC000000000000000000000000000000000002', sym: 'USDC' },
  quiet: { chain: 'bsc', addr: '0xQUIET00000000000000000000000000000000003', sym: 'QUIET' },
};

const boostList = [
  { chainId: T.dragon.chain, tokenAddress: T.dragon.addr, totalAmount: 500 },
  { chainId: T.weak.chain, tokenAddress: T.weak.addr, totalAmount: 120 },
  { chainId: T.junk.chain, tokenAddress: T.junk.addr, totalAmount: 300 },
  { chainId: T.stable.chain, tokenAddress: T.stable.addr, totalAmount: 60 },
  { chainId: T.quiet.chain, tokenAddress: T.quiet.addr, totalAmount: 40 },
];

let volScale = 1;

function pair(t, over = {}) {
  const now = realNow();
  const vol = {
    h24: Math.round(180000 * volScale),
    h6: Math.round(90000 * volScale),
    h1: Math.round(30000 * volScale),
    m5: Math.round(4000 * volScale),
  };
  return Object.assign({
    chainId: t.chain,
    dexId: t.chain === 'solana' ? 'raydium' : 'uniswap',
    pairAddress: 'PAIR' + t.addr.slice(-6),
    url: 'https://dexscreener.com/' + t.chain + '/' + t.addr,
    baseToken: { address: t.addr, symbol: t.sym, name: t.sym + ' Token' },
    quoteToken: { address: 'QUOTE', symbol: t.chain === 'solana' ? 'USDC' : 'WETH' },
    priceUsd: '0.0123',
    priceNative: '0.0000045',
    txns: { m5: { buys: 40, sells: 12 }, h1: { buys: 300, sells: 120 }, h6: {}, h24: {} },
    volume: vol,
    priceChange: { m5: 4.2, h1: 12.5, h6: 30.1, h24: 80.4 },
    liquidity: { usd: 120000, base: 1e9, quote: 1e5 },
    fdv: 900000,
    marketCap: 900000,
    pairCreatedAt: now - 3 * 3600 * 1000,
    info: {
      imageUrl: 'https://example.invalid/logo.png',
      socials: [{ type: 'twitter', url: 'https://x.example.invalid/drgn' }],
      websites: [{ url: 'https://drgn.example.invalid' }],
    },
  }, over);
}

// 每条链上的池子
function pools() {
  return {
    [T.dragon.addr.toLowerCase()]: [pair(T.dragon)],
    [T.weak.addr.toLowerCase()]: [
      pair(T.weak, {
        volume: { h24: 90000, h6: 40000, h1: 9000, m5: 900 },
        txns: { m5: { buys: 14, sells: 13 }, h1: {}, h6: {}, h24: {} },
        priceChange: { m5: 0.3, h1: 1.1, h6: 2.0, h24: 5.0 },
        liquidity: { usd: 26000 },
        fdv: 6_000_000,
        info: {},
      }),
    ],
    // 质量地板以下：深度 1,200 / 24h 成交 800，不该进榜
    [T.junk.addr.toLowerCase()]: [
      pair(T.junk, { liquidity: { usd: 1200 }, volume: { h24: 800, h6: 400, h1: 90, m5: 8 }, fdv: 12000 }),
    ],
    [T.stable.addr.toLowerCase()]: [pair(T.stable)],
    [T.quiet.addr.toLowerCase()]: [
      pair(T.quiet, {
        volume: { h24: 60000, h6: 30000, h1: 9000, m5: 900 },
        txns: { m5: { buys: 10, sells: 10 }, h1: {}, h6: {}, h24: {} },
        priceChange: { m5: 0, h1: -1.2, h6: -3.5, h24: -12.0 },
        liquidity: { usd: 45000 },
        fdv: 2_500_000,
        info: {},
      }),
    ],
  };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

let fetchCount = 0;
const seenUrls = [];
globalThis.fetch = async function (url) {
  const u = String(url);
  fetchCount++;
  seenUrls.push(u);
  if (u.includes('/token-boosts/top/')) return response(200, boostList);
  if (u.includes('/token-boosts/latest/')) return response(200, []);
  if (u.includes('/token-profiles/latest')) return response(200, []);
  if (u.includes('/latest/dex/search')) return response(200, { pairs: [] });
  if (u.includes('/latest/dex/tokens/')) {
    const raw = decodeURIComponent(u.split('/latest/dex/tokens/')[1]);
    const table = pools();
    const out = [];
    for (const a of raw.split(',')) {
      const hit = table[a.toLowerCase()];
      if (hit) out.push(...hit);
    }
    return response(200, { pairs: out });
  }
  return response(404, { error: 'unexpected url ' + u });
};

// ------------------------------------------------------------- 加载被测模块
console.log('\n加载 lib 与 src（UMD / 全局挂载）');
const SRC = path.resolve(__dirname, '..');
globalThis.DragonSources = require(path.join(SRC, 'lib/sources.js'));
globalThis.DragonScore = require(path.join(SRC, 'lib/score.js'));
globalThis.DragonLedger = require(path.join(SRC, 'lib/ledger.js'));
require(path.join(SRC, 'src/engine.js'));
require(path.join(SRC, 'src/static-api.js'));

const E = globalThis.DragonEngine;
const api = globalThis.DragonApi;
const SC = globalThis.DragonScore;
ok(!!E, 'engine.js 挂载了 window.DragonEngine');
ok(!!api, 'static-api.js 挂载了 window.DragonApi');
eq(E.SCAN_INTERVAL_MS, 60000, '扫描周期为 60 秒');

// ------------------------------------------------------------- 第一轮扫描
(async function main() {
  console.log('\n第一轮扫描（无历史快照，走 m5 折算路径）');
  const r1 = await E.scan();
  eq(r1.ok, true, 'scan() 返回成功');
  ok(r1.count > 0, '扫出了标的（' + r1.count + ' 个）');

  const health = E.health();
  eq(health.mode, 'static', 'health() 标明 static 模式');
  ok(health.tokens === r1.count, 'health() 里的标的数与扫描结果一致');

  const tokens = E.state.tokens;
  ok(tokens.every((t) => Number.isInteger(t.score) && t.score >= 0 && t.score <= 100), '全部标的龙分为 0~100 的整数');
  ok(tokens.every((t, i) => i === 0 || tokens[i - 1].score >= t.score), '结果按龙分降序排列');

  const syms = tokens.map((t) => t.symbol);
  ok(!syms.includes('USDC'), '稳定币 USDC 被排除');
  ok(!syms.includes('JUNK'), '深度 $1.2K / 成交 $800 的池子被质量地板挡下');
  ok(syms.includes('DRGN'), '主线标的 DRGN 在榜');
  ok(syms.includes('QUIET'), '走弱标的 QUIET 仍在榜（只是分数低）');

  ok(tokens.every((t) => t.factors && Object.keys(t.factors).length === 8), '每个标的都有 8 个因子明细');
  ok(tokens.every((t) => Array.isArray(t.factorList) && t.factorList.length === 8), 'factorList 含 8 项（供前端明细展示）');
  ok(tokens.every((t) => Array.isArray(t.riskItems)), '每个标的都带 riskItems');
  ok(tokens.every((t) => Array.isArray(t.missing)), '每个标的都带 missing（数据缺口）');
  ok(tokens.every((t) => Array.isArray(t.tags) && t.tags.length > 0), '每个标的都生成了标签');
  ok(tokens.every((t) => ['dragon', 'candidate', 'latent', 'watch', 'trash'].includes(t.grade)), '分级取值在枚举内');
  ok(tokens.every((t) => Array.isArray(t.history) && t.history.length === 1), '首轮每个标的一条价格快照');

  const drag = tokens.find((t) => t.symbol === 'DRGN');
  eq(drag.factors.volBurst.src, 'm5ratio', '首轮没有历史快照，量能只能走 m5 折算');
  ok(drag.liquidityUsd >= 8000, '入榜标的深度都在质量地板之上');

  console.log('\n持久化');
  const raw = globalThis.localStorage.getItem('dr.static.v1');
  ok(!!raw, '结果写入了 localStorage 键 dr.static.v1');
  const saved = JSON.parse(raw);
  eq(saved.tokens.length, tokens.length, '落盘的标的数与内存一致');
  ok(!!saved.snapshots && Object.keys(saved.snapshots).length > 0, '快照已落盘（供下一轮算真实区间增量）');
  ok(saved.tokens.every((t) => t.history === undefined), '落盘时剥离了 history（避免撑爆配额）');

  console.log('\n第二轮扫描（隔 120 秒，成交翻倍）');
  clockOffset += 120000;
  volScale = 2;
  const r2 = await E.scan();
  eq(r2.ok, true, '第二次 scan() 仍成功');

  const tokens2 = E.state.tokens;
  const drag2 = tokens2.find((t) => t.symbol === 'DRGN');
  eq(drag2.factors.volBurst.src, 'delta', '有了相邻快照后，量能改用真实区间增量');
  ok(drag2.factors.volBurst.score >= 80, '成交翻倍时量能因子被显著点亮（' + drag2.factors.volBurst.score + '）');
  eq(drag2.history.length, 2, '价格序列累积到 2 个点');
  eq(E.state.scanCount, 2, '扫描计数累加');
  eq(fetchCount > 0, true, '确实发起了行情请求（' + fetchCount + ' 次）');
  ok(seenUrls.some((u) => u.includes('api.dexscreener.com')), '请求打向 DexScreener 公开接口');

  console.log('\n榜单筛选');
  const solOnly = E.radar({ chain: 'solana' });
  ok(solOnly.tokens.every((t) => t.chainId === 'solana'), '按链筛选只返回该链标的');
  const byScore = E.radar({ sort: 'score' });
  ok(byScore.tokens.every((t, i) => i === 0 || byScore.tokens[i - 1].score >= t.score), '按龙分排序生效');
  const byVol = E.radar({ sort: 'vol' });
  ok(byVol.tokens.every((t, i) => i === 0 || (byVol.tokens[i - 1].volume.h24 || 0) >= (t.volume.h24 || 0)), '按 24h 成交额排序生效');
  const byRisk = E.radar({ sort: 'risk' });
  ok(byRisk.tokens.every((t, i) => i === 0 || byRisk.tokens[i - 1].risk <= t.risk), '按风险升序排序生效');
  const searched = E.radar({ q: 'drgn' });
  ok(searched.tokens.length === 1 && searched.tokens[0].symbol === 'DRGN', '关键词搜索命中单个标的');
  const deep = E.radar({ minLiq: 100000 });
  ok(deep.tokens.every((t) => t.liquidityUsd >= 100000), '深度过滤生效');
  const newOnly = E.radar({ view: 'new' });
  ok(newOnly.tokens.every((t) => t.pairCreatedAt && Date.now() - t.pairCreatedAt < 864e5), '新池榜只留 24 小时内的池子');

  console.log('\n适配层 /api/*（静态形态）');
  const meta = await api('/api/meta');
  eq(meta.status, 200, '/api/meta 返回 200');
  eq(meta.body.weights, SC.WEIGHTS, '/api/meta 透出因子权重');
  ok(Array.isArray(meta.body.grades) && meta.body.grades.length === 5, '/api/meta 透出 5 档分级');
  ok(Object.keys(meta.body.chains).length >= 30, '/api/meta 透出链清单');
  eq(meta.body.scanIntervalMs, 60000, '/api/meta 透出扫描周期');

  const radar = await api('/api/radar?chain=all&view=all&sort=score&limit=260');
  eq(radar.status, 200, '/api/radar 返回 200');
  ok(Array.isArray(radar.body.tokens) && radar.body.tokens.length > 0, '/api/radar 返回标的数组');
  ok(typeof radar.body.updatedAt === 'number' && radar.body.updatedAt > 0, '/api/radar 带本轮取数时间');
  ok(!!radar.body.meta.byChainId, '/api/radar 带各链计数（前端链筛选依据）');
  ok(!!radar.body.sources.universeSize, '/api/radar 带数据源统计');
  eq(radar.body.scanning, false, '扫描结束后 scanning 为 false');

  const pr = await api('/api/price?address=' + T.dragon.addr);
  eq(pr.status, 200, '/api/price 返回 200');
  eq(pr.body.price.symbol, 'DRGN', '/api/price 带回符号与报价');

  const h = await api('/api/health');
  eq(h.status, 200, '/api/health 返回 200');
  eq(h.body.mode, 'static', '/api/health 标明 static 模式');

  const det = await api('/api/token/' + T.dragon.chain + '/' + T.dragon.addr);
  eq(det.status, 200, '/api/token/:chain/:addr 返回 200');
  eq(det.body.token.symbol, 'DRGN', '/api/token 命中本轮已算好的标的');
  ok(!det.body.offline, '/api/token 命中缓存时不必回源');
  const detNew = await api('/api/token/base/' + T.dragon.addr);
  eq(detNew.status, 200, '/api/token 换一条链查同一地址，走的是回源分支');
  eq(detNew.body.offline, true, '/api/token 回源结果标为 offline');
  const detMiss = await api('/api/token/base/0xdeadbeef00000000000000000000000000000099');
  eq(detMiss.status, 404, '/api/token 对取不到行情的地址如实返回 404');

  const wl0 = await api('/api/watchlist');
  eq(wl0.body.watchlist.length, 0, '自选初始为空');
  const wl1 = await api('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenAddress: T.junk.addr, chainId: T.junk.chain, symbol: 'JUNK' }),
  });
  eq(wl1.body.watchlist.length, 1, '加入自选成功');
  const wl2 = await api('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenAddress: T.junk.addr, chainId: T.junk.chain, symbol: 'JUNK' }),
  });
  eq(wl2.body.watchlist.length, 1, '重复加入自选不会产生重复项');
  const wl3 = await api('/api/watchlist?address=' + T.junk.addr + '&chainId=' + T.junk.chain, { method: 'DELETE' });
  eq(wl3.body.watchlist.length, 0, '移出自选成功');

  console.log('\n自选豁免质量地板');
  const wl4 = await api('/api/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokenAddress: T.junk.addr, chainId: T.junk.chain, symbol: 'JUNK' }),
  });
  eq(wl4.body.watchlist.length, 1, '把被地板挡下的 JUNK 加入自选');
  const r3 = await E.scan();
  eq(r3.ok, true, '加入自选后再扫一轮成功');
  ok(E.state.tokens.some((t) => t.symbol === 'JUNK'), '自选标的即使不过地板也常驻候选池');

  console.log('\n追踪接口（静态形态不做伪造）');
  const fomo = await api('/api/fomo/IcyNoisyWhale');
  eq(fomo.status, 200, '/api/fomo/:handle 返回 200');
  eq(fomo.body.user, null, '静态形态不返回用户数据');
  eq(fomo.body.needsAuth, true, '静态形态明确标注 needsAuth');
  ok(/image-renderer\.fomo\.cloud/.test(fomo.body.publicCard), '给出官方公开名片地址');
  ok(/^https:\/\/fomo\.family\/profile\//.test(fomo.body.profileUrl), '给出原站主页地址');

  const nf = await api('/api/nope');
  eq(nf.status, 404, '未知端点返回 404');

  console.log('\n扫描触发接口');
  const sc = await api('/api/scan', { method: 'POST' });
  eq(sc.status, 200, 'POST /api/scan 返回 200');
  eq(sc.body.ok, true, 'POST /api/scan 报告扫描成功');

  // ------------------------------------------------------------- 信号账本 / 回测
  console.log('\n信号账本（前瞻记录）');
  const led = E.ledger();
  ok(!!led, '引擎持有账本对象');
  const lraw = globalThis.localStorage.getItem('dr.ledger.v1');
  ok(!!lraw, '账本单独落在 localStorage 键 dr.ledger.v1（不挤占榜单快照）');

  const firsts = Object.keys(led.signals).filter((id) => id.indexOf('first|') === 0);
  ok(firsts.length > 0, '扫描过程中开出了首现信号（' + firsts.length + ' 个）');
  // 没有前视：开仓价必须等于那个标的当轮的真实报价，而不是后来的价格
  const dragSig = led.signals['first|' + T.dragon.chain + ':' + T.dragon.addr.toLowerCase()];
  ok(!!dragSig, 'DRGN 的首现信号已开仓');
  eq(dragSig.price0, 0.0123, '开仓价记录的是首次上榜那一刻的真实价格');
  eq(dragSig.score > 0, true, '开仓快照带上了当时的龙分');
  eq(Object.keys(dragSig.f).length, 8, '开仓快照记下八个因子分');
  eq(dragSig.r['1h'], undefined, '1 小时视界还没到点，不能有结算记录');

  const bt = await api('/api/backtest?horizon=1h&why=all');
  eq(bt.status, 200, '/api/backtest 返回 200');
  ok(!!bt.body.summary, '/api/backtest 带 summary');
  eq(bt.body.summary.horizon, '1h', '视界参数生效');
  eq(bt.body.summary.horizonLabel, '1 小时', '视界带上中文标签');
  eq(bt.body.summary.sampleEnough, false, '样本远不足 30 笔时明确标为不足');
  eq(bt.body.summary.n, 0, '尚无已结算样本');
  ok(bt.body.summary.waiting > 0, '未到点的信号计入「待结算」而不是流失（' + bt.body.summary.waiting + ' 个）');
  eq(bt.body.summary.dead, 0, '刚开的信号不会被误记流失');
  eq(bt.body.summary.winRate, null, '没有已结算样本时胜率为 null，不是 0');
  ok(bt.body.summary.benchmark && bt.body.summary.benchmark.medianExcess === null, '缺基准时中位超额为 null，不用 0 冒充持平');
  eq(bt.body.summary.benchmark.marketReturn, null, '缺基准时等权基准收益同样为 null');
  ok(bt.body.summary.index && bt.body.summary.index.marketLevel >= 1,
    '指数透出等权净值（基准本体）');
  ok('marketRoundRet' in bt.body.summary.index, '指数透出单轮等权波动，缺的时候是 null 而不是 undefined');
  ok(Array.isArray(bt.body.summary.byGrade) && bt.body.summary.byGrade.length === 0, '无样本时分层为空数组');
  ok(Array.isArray(bt.body.samples) && bt.body.samples.length > 0, '明细按 state=all 返回，能看到未到点的信号');
  ok(bt.body.samples.every((x) => x.state === 'waiting' || x.state === 'settled' || x.state === 'lost'), '明细每行都带明确状态');
  ok(Array.isArray(bt.body.horizons) && bt.body.horizons.length === 4, '透出四个视界定义');
  eq(bt.body.whyLabels.upgrade, '档位升级信号', '透出信号类型的标签');

  const btUp = await api('/api/backtest?horizon=24h&why=upgrade');
  eq(btUp.status, 200, '按信号类型过滤也返回 200');
  eq(btUp.body.summary.why, 'upgrade', 'why 参数生效');
  ok(btUp.body.samples.every((x) => x.why === 'upgrade'), '明细只含升级信号');
  eq(btUp.body.summary.n, 0, '24 小时视界尚无结算');

  const btBad = await api('/api/backtest?horizon=99x');
  eq(btBad.body.summary.horizon, '1h', '非法视界回落到默认 1 小时，不报错');

  console.log('\n回测清空');
  const breset = await api('/api/backtest/reset', { method: 'POST' });
  eq(breset.status, 200, 'POST /api/backtest/reset 返回 200');
  eq(breset.body.ok, true, '清空账本成功');
  eq(Object.keys(E.ledger().signals).length, 0, '清空后账本里没有残留信号');
  const bget = await api('/api/backtest/reset', { method: 'GET' });
  eq(bget.status, 405, '清空接口只接受 POST');

  // ------------------------------------------------------------- 汇总
  console.log('\n通过 ' + pass + ' 项');
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
