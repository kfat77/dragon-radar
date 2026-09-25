'use strict';
/**
 * 信号账本零依赖测试：node test/ledger.test.js
 *
 * 覆盖六件事，每一件都对着「会让胜率数字说谎」的缺陷写：
 *   结算 —— 视界是否到点才结算、价格非法时是否拒绝结算、观测序列能否补齐。
 *   流失 —— 补不到价格的信号是否单独统计，而不是从分母里悄悄消失。
 *   基准 —— 榜单指数是否只在样本足够时记录、区间收益取不到时是否显式给 null。
 *   超额 —— 基准缺失时必须为 null，绝不能拿 0 顶替成「和市场持平」。
 *   门槛 —— 样本不足时是否拒绝给结论。
 *   分层 —— 按档位与分数区间分组后的计数与胜率是否正确。
 *
 * 全部是纯函数，不联网、不读存储，可在 CI 里零依赖运行。
 */
const assert = require('assert');
const L = require('../lib/ledger');

const H = 3600e3;
const T0 = Date.parse('2026-09-25T00:00:00Z');

function tok(over = {}) {
  const key = over.key || 'solana:AAA';
  return Object.assign({
    key,
    chainId: key.split(':')[0],
    tokenAddress: key.split(':')[1],
    symbol: 'AAA',
    priceUsd: 1,
    score: 72,
    grade: 'candidate',
    gradeLabel: '龙头候选',
    confidence: 80,
    risk: 5,
    fdv: 1e6,
    liquidityUsd: 50000,
    ageMin: 120,
    factors: {
      volBurst: { score: 70 }, buyPressure: { score: 60 }, accel: { score: 55 },
      resonance: { score: 80 }, liquidity: { score: 90 }, headroom: { score: 100 },
      freshness: { score: 100 }, social: { score: 25 },
    },
  }, over);
}

const board = (...toks) => toks;

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  OK ' + name); }
  catch (e) { console.error('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ================================================================ 开仓
console.log('信号账本 · 开仓');

ok('首现信号只开一次：第二轮同标的不会重复开仓', () => {
  const led = L.create();
  // 用「观察」档，避开升级信号，单独验首现信号的去重
  const r1 = L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0);
  assert.strictEqual(r1.opened, 1, '首轮应开 1 个信号，实际 ' + r1.opened);
  assert.ok(led.signals['first|solana:AAA']);
  const r2 = L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0 + 60e3);
  assert.strictEqual(r2.opened, 0, '第二轮不应再开，实际 ' + r2.opened);
  assert.strictEqual(Object.keys(led.signals).length, 1);
});

ok('高分标的首轮同时开两个信号：首现用于对照，升级才是会动手的那一档', () => {
  const led = L.create();
  const r = L.observe(led, board(tok({ grade: 'dragon', score: 85 })), T0);
  assert.strictEqual(r.opened, 2, '真龙档应同时开首现与升级，实际 ' + r.opened);
  assert.ok(led.signals['first|solana:AAA']);
  assert.ok(led.signals['upgrade|solana:AAA']);
  assert.strictEqual(led.signals['upgrade|solana:AAA'].score, 85);
});

ok('档位升级信号：只有达到「龙头候选」及以上才开', () => {
  const led = L.create();
  const low = L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0);
  assert.strictEqual(low.opened, 1, '低档位只开首现信号');
  assert.ok(led.signals['first|solana:AAA']);
  assert.ok(!led.signals['upgrade|solana:AAA'], '观察档不该开升级信号');

  const high = L.observe(led, board(tok({ grade: 'dragon', score: 85 })), T0 + 60e3);
  assert.strictEqual(high.opened, 1, '升到真龙后应补开升级信号');
  assert.ok(led.signals['upgrade|solana:AAA']);
});

ok('开仓快照记下当时真实状态：分数、八因子、市值、深度、池龄', () => {
  const led = L.create();
  L.observe(led, board(tok({ priceUsd: 0.00042, score: 77, fdv: 350000, liquidityUsd: 41000, ageMin: 35 })), T0);
  const s = led.signals['first|solana:AAA'];
  assert.strictEqual(s.price0, 0.00042);
  assert.strictEqual(s.score, 77);
  assert.strictEqual(s.fdv0, 350000);
  assert.strictEqual(s.liq0, 41000);
  assert.strictEqual(s.ageMin0, 35);
  assert.strictEqual(s.f.volBurst, 70);
  assert.strictEqual(s.t0, T0);
});

ok('价格缺失或非正数不开仓：没有入场价就没有收益可算', () => {
  const led = L.create();
  const r = L.observe(led, board(tok({ priceUsd: 0 })), T0);
  assert.strictEqual(r.opened, 0);
  assert.strictEqual(Object.keys(led.signals).length, 0);
});

// ================================================================ 结算
console.log('信号账本 · 前瞻结算');

ok('未到点不结算：14 分钟时 15 分钟视界仍为空', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 1.5 })), T0 + 14 * 60e3);
  const s = led.signals['first|solana:AAA'];
  assert.ok(!s.r['15m'], '未到点不能结算');
});

ok('到点按本轮真实价格结算，收益算对', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 1.5 })), T0 + 15 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '15 分钟视界应已结算');
  assert.strictEqual(rec.r, 0.5, '1.0 → 1.5 应为 +50%，实际 ' + rec.r);
  assert.strictEqual(rec.src, 'board');
});

ok('四个视界各自独立结算，互不影响', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 2 })), T0 + 15 * 60e3);
  L.observe(led, board(tok({ priceUsd: 3 })), T0 + 1 * H);
  L.observe(led, board(tok({ priceUsd: 0.5 })), T0 + 6 * H);
  L.observe(led, board(tok({ priceUsd: 0.25 })), T0 + 24 * H);
  const s = led.signals['first|solana:AAA'];
  assert.strictEqual(s.r['15m'].r, 1, '15m: 1→2 应 +100%');
  assert.strictEqual(s.r['1h'].r, 2, '1h: 1→3 应 +200%');
  assert.strictEqual(s.r['6h'].r, -0.5, '6h: 1→0.5 应 -50%');
  assert.strictEqual(s.r['24h'].r, -0.75, '24h: 1→0.25 应 -75%');
});

ok('价格 ≤ 0 拒绝结算：池子没了不能记成 0 收益', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 0 })), T0 + 15 * 60e3);
  const s = led.signals['first|solana:AAA'];
  assert.ok(!s.r['15m'], '价格 0 时必须拒绝结算，而不是记成不亏不赚');
});

ok('标的不在榜时用本地观测序列回补结算', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  // 中途一直在榜，攒下观测点
  L.observe(led, board(tok({ priceUsd: 1.2 })), T0 + 5 * 60e3);
  L.observe(led, board(tok({ priceUsd: 1.4 })), T0 + 10 * 60e3);
  // 到点时这一轮恰好没进榜，只能靠观测序列补
  L.observe(led, board(tok({ key: 'solana:OTHER', symbol: 'OTH', grade: 'watch' })), T0 + 16 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '应能用观测序列补齐');
  assert.strictEqual(rec.src, 'obs', '来源应标为观测序列，实际 ' + rec.src);
  assert.strictEqual(rec.r, 0.4, '应取最接近到点的观测价 1.4，实际 ' + rec.r);
});

ok('本轮榜单里没有的解不开，进入待补价清单，由外部 settle 补上', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:AAA' })), T0);
  L.observe(led, board(tok({ key: 'solana:BBB' })), T0 + 15 * 60e3);
  const r = L.observe(led, board(tok({ key: 'solana:CCC' })), T0 + 16 * 60e3);
  assert.ok(r.needPrices.indexOf('solana:AAA') >= 0, '缺价的标的应在待补清单里：' + JSON.stringify(r.needPrices));
  L.settle(led, { 'solana:AAA': 3 }, T0 + 16 * 60e3 + 1000);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '外部补价后应结算');
  assert.strictEqual(rec.src, 'board', 'settle 走的是外部价格，来源记为 board 口径');
  assert.strictEqual(rec.r, 2, '1 → 3 应 +200%，实际 ' + rec.r);
});

ok('记录最大不利偏移：中途跌过再回来，回撤要如实记下', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 0.4 })), T0 + 5 * 60e3);
  L.observe(led, board(tok({ priceUsd: 0.3 })), T0 + 10 * 60e3);
  L.observe(led, board(tok({ priceUsd: 2 })), T0 + 15 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.strictEqual(rec.r, 1, '终值 1 → 2');
  assert.ok(rec.mae != null, '应记录最大不利偏移');
  assert.ok(rec.mae <= -0.69 && rec.mae >= -0.71, '中途最低 0.3 应记 -70%，实际 ' + rec.mae);
});

// ================================================================ 流失
console.log('信号账本 · 样本流失');

ok('超过 48 小时补不到价格：记为流失，单独计数，不混进胜率', () => {
  const led = L.create();
  L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0);
  // 之后这个标的彻底消失，只在别的标的轮次里推进时间
  for (let i = 1; i <= 3; i++) {
    L.observe(led, board(tok({ key: 'solana:OTHER', symbol: 'OTH', grade: 'watch', score: 50 })), T0 + i * 24 * H);
  }
  const s = led.signals['first|solana:AAA'];
  assert.ok(s.dead.indexOf('15m') >= 0 && s.dead.indexOf('24h') >= 0,
    '四个视界都应记为流失：' + JSON.stringify(s.dead));
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  assert.strictEqual(st.dead, 1, '流失样本应单独计数，实际 ' + st.dead);
  const rows = L.samples(led, { horizon: '1h', why: 'first' });
  assert.ok(!rows.some((x) => x.symbol === 'AAA'), '流失的标的不能出现在已结算样本里');
  assert.ok(rows.some((x) => x.symbol === 'OTH' && x.state === 'settled'), '一直在榜的标的应正常结算');
  // 想看流失的是哪些标的时必须显式要，否则查不到病因
  const all = L.samples(led, { horizon: '1h', why: 'first', state: 'all' });
  const aaa = all.find((x) => x.symbol === 'AAA');
  assert.ok(aaa && aaa.state === 'lost', '显式要 all 时应能看到流失标的及其状态');
});

ok('待结算与流失分开显示：等待中的不算流失', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ key: 'solana:OTHER' })), T0 + 2 * H);
  const st = L.summarize(led, { horizon: '24h', why: 'first' });
  assert.strictEqual(st.waiting >= 2, true, '24 小时视界应仍处于等待，实际 waiting=' + st.waiting);
  assert.strictEqual(st.dead, 0);
  // 默认的样本明细只含已结算行：待结算的同样不能混进胜率分母
  assert.strictEqual(L.samples(led, { horizon: '24h', why: 'first' }).length, 0, '未结算时样本明细应为空');
});

// ================================================================ 榜单指数
console.log('信号账本 · 榜单指数基准');

ok('指数单轮标的不足 3 个时不记点：样本太少的「大盘」没有参考意义', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:A' }), tok({ key: 'solana:B' })), T0);
  const r = L.observe(led, board(tok({ key: 'solana:A', priceUsd: 2 }), tok({ key: 'solana:B', priceUsd: 0.5 })), T0 + 60e3);
  assert.strictEqual(r.index, null);
  assert.strictEqual(led.index.length, 0);
});

ok('指数取轮间收益的中位数，并连乘成净值', () => {
  const led = L.create();
  const mk = (p) => [
    tok({ key: 'solana:A', priceUsd: p[0] }), tok({ key: 'solana:B', priceUsd: p[1] }),
    tok({ key: 'solana:C', priceUsd: p[2] }), tok({ key: 'solana:D', priceUsd: p[3] }),
  ];
  L.observe(led, mk([1, 1, 1, 1]), T0);
  L.observe(led, mk([2, 1, 0.5, 3]), T0 + 60e3);
  assert.strictEqual(led.index.length, 1, '应有 1 个指数点');
  // 收益为 +100% / 0% / -50% / +200%，中位数 = (0 + 1) / 2 = 0.5
  assert.strictEqual(led.index[0].med, 0.5, '实际 ' + led.index[0].med);
  assert.strictEqual(led.index[0].level, 1.5);
  assert.strictEqual(L.indexReturn(led, T0, T0 + 60e3), 0.5);
});

ok('指数剔掉单轮 10 倍以上的脏点：价格单位错乱不能把整条线拉飞', () => {
  const led = L.create();
  const mk = (p) => [
    tok({ key: 'solana:A', priceUsd: p[0] }), tok({ key: 'solana:B', priceUsd: p[1] }),
    tok({ key: 'solana:C', priceUsd: p[2] }), tok({ key: 'solana:D', priceUsd: p[3] }),
  ];
  L.observe(led, mk([1, 1, 1, 1]), T0);
  L.observe(led, mk([1e6, 1, 1, 1]), T0 + 60e3);
  assert.strictEqual(led.index[0].med, 0, '脏点应剔除后中位数为 0，实际 ' + led.index[0].med);
  assert.strictEqual(led.index[0].n, 3, '有效样本应为 3，实际 ' + led.index[0].n);
});

ok('区间内没有指数点时必须给 null，不能拿 0 冒充「与市场持平」', () => {
  const led = L.create();
  assert.strictEqual(L.indexReturn(led, T0, T0 + H), null);
  const mk = (p) => [tok({ key: 'solana:A', priceUsd: p }), tok({ key: 'solana:B', priceUsd: p }), tok({ key: 'solana:C', priceUsd: p })];
  L.observe(led, mk(1), T0);
  L.observe(led, mk(1.1), T0 + 60e3);
  // 区间完全落在指数点之前
  assert.strictEqual(L.indexReturn(led, T0 - 5 * H, T0 - 4 * H), null);
});

// ================================================================ 汇总结论
console.log('信号账本 · 统计与结论');

function seed(led, n, ret, opts = {}) {
  for (let i = 0; i < n; i++) {
    const k = 'solana:T' + i;
    const t = tok(Object.assign({ key: k, symbol: 'T' + i }, opts.tok || {}));
    L.observe(led, board(t), T0 + i);
    L.settle(led, { [k]: 1 * (1 + ret) }, T0 + i + 1 * H + 1);
  }
  return led;
}

ok('样本不足门槛：少于 30 笔时拒绝给结论', () => {
  const led = L.create();
  seed(led, 5, 0.2);
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  assert.strictEqual(st.n, 5);
  assert.strictEqual(st.sampleEnough, false, '5 笔不能算够');
  assert.strictEqual(st.minSample, L.MIN_SAMPLE);
  const led2 = L.create();
  seed(led2, L.MIN_SAMPLE, 0.2);
  assert.strictEqual(L.summarize(led2, { horizon: '1h', why: 'first' }).sampleEnough, true);
});

ok('胜率与分位：构造 7 涨 3 跌，胜率必须是 0.7', () => {
  const led = L.create();
  for (let i = 0; i < 10; i++) {
    const k = 'solana:W' + i;
    L.observe(led, board(tok({ key: k, symbol: 'W' + i })), T0 + i);
    const p = i < 7 ? 2 : 0.5;
    L.settle(led, { [k]: p }, T0 + i + 1 * H + 1);
  }
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  assert.strictEqual(st.n, 10);
  assert.strictEqual(st.winRate, 0.7, '实际 ' + st.winRate);
  assert.strictEqual(st.median, 1, '7 个 +100%、3 个 -50%，中位数应为 +100%，实际 ' + st.median);
  assert.strictEqual(st.worst, -0.5);
  assert.strictEqual(st.best, 1);
  assert.strictEqual(st.halfRate, 0.3, '腰斩比例应为 30%，实际 ' + st.halfRate);
});

ok('按档位分层：不同档位分别统计，且样本数对得上', () => {
  const led = L.create();
  for (let i = 0; i < 4; i++) {
    const k = 'solana:D' + i;
    L.observe(led, board(tok({ key: k, symbol: 'D' + i, grade: 'dragon', score: 85 })), T0 + i);
    L.settle(led, { [k]: 3 }, T0 + i + 1 * H + 1);
  }
  for (let i = 0; i < 4; i++) {
    const k = 'solana:Z' + i;
    L.observe(led, board(tok({ key: k, symbol: 'Z' + i, grade: 'trash', score: 20 })), T0 + 10 + i);
    L.settle(led, { [k]: 0.5 }, T0 + 10 + i + 1 * H + 1);
  }
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  const dragon = st.byGrade.find((x) => x.key === 'dragon');
  const trash = st.byGrade.find((x) => x.key === 'trash');
  assert.strictEqual(dragon.n, 4);
  assert.strictEqual(dragon.winRate, 1);
  assert.strictEqual(trash.n, 4);
  assert.strictEqual(trash.winRate, 0);
  const b80 = st.byBand.find((x) => x.key === 'd80');
  const b0 = st.byBand.find((x) => x.key === 'd0');
  assert.strictEqual(b80.n, 4, '85 分应落在 80-100 区间');
  assert.strictEqual(b0.n, 4, '20 分应落在 0-44 区间');
});

ok('signal 类型过滤：首现与升级分开统计', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:X', grade: 'dragon', score: 88 })), T0);
  L.settle(led, { 'solana:X': 2 }, T0 + 1 * H + 1);
  const all = L.summarize(led, { horizon: '1h', why: 'all' });
  const first = L.summarize(led, { horizon: '1h', why: 'first' });
  const up = L.summarize(led, { horizon: '1h', why: 'upgrade' });
  assert.strictEqual(all.n, 2, '首现 + 升级 = 2 笔');
  assert.strictEqual(first.n, 1);
  assert.strictEqual(up.n, 1);
  assert.strictEqual(up.whyLabel, '档位升级信号');
});

ok('超额收益：基准缺失时为 null，绝不用 0 顶替', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:EX' })), T0);
  L.settle(led, { 'solana:EX': 2 }, T0 + 1 * H + 1);
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  assert.strictEqual(st.n, 1);
  assert.strictEqual(st.benchmark.missing, 1, '没有指数点时基准必须显式缺失');
  assert.strictEqual(st.benchmark.medianExcess, null, '基准缺失时超额必须是 null，实际 ' + st.benchmark.medianExcess);
  assert.strictEqual(st.benchmark.beatRate, null);
  assert.strictEqual(L.samples(led, { horizon: '1h', why: 'first' })[0].ex, null);
});

ok('超额收益：有基准时按 信号收益 − 同期指数收益 计算', () => {
  const led = L.create();
  // 先铺出指数：A/B/C 三个标的每轮同涨 10%
  const mk = (p, k) => [tok({ key: 'solana:A' + (k || ''), priceUsd: p }), tok({ key: 'solana:B' + (k || ''), priceUsd: p }), tok({ key: 'solana:C' + (k || ''), priceUsd: p })];
  L.observe(led, mk(1), T0);
  L.observe(led, mk(1.1), T0 + 30 * 60e3);
  L.observe(led, mk(1.21), T0 + 60 * 60e3);
  // 信号开在 T0，1 小时后结算：市场 +21%，标的 +50%
  L.observe(led, board(tok({ key: 'solana:HIT', symbol: 'HIT' })), T0);
  L.settle(led, { 'solana:HIT': 1.5 }, T0 + 60 * 60e3 + 1);
  const st = L.summarize(led, { horizon: '1h', why: 'all' });
  const hit = st.byChain.find((x) => x.key === 'solana');
  assert.ok(hit, '应有 solana 分组');
  const bench = L.indexReturn(led, T0, T0 + 60 * 60e3 + 1, 'solana');
  assert.ok(bench > 0.19 && bench < 0.23, '基准应约 +21%，实际 ' + bench);
  const s = L.samples(led, { horizon: '1h', why: 'first' }).find((x) => x.symbol === 'HIT');
  assert.ok(s, '应能取到 HIT 的样本明细');
  assert.ok(s.ex > 0.26 && s.ex < 0.30, '超额应约 +29%，实际 ' + s.ex);
});

ok('指数曲线抽稀后首尾时间正确，且不产生 NaN', () => {
  const led = L.create();
  const mk = (p) => [tok({ key: 'solana:A', priceUsd: p }), tok({ key: 'solana:B', priceUsd: p }), tok({ key: 'solana:C', priceUsd: p })];
  L.observe(led, mk(1), T0);
  for (let i = 1; i <= 50; i++) L.observe(led, mk(1 + i * 0.01), T0 + i * 60e3);
  const ser = L.indexSeries(led, 20);
  assert.ok(ser.length >= 2 && ser.length <= 22, '抽稀后点数应在上限内，实际 ' + ser.length);
  assert.strictEqual(ser[0][0], led.index[0].ts);
  assert.strictEqual(ser[ser.length - 1][0], led.index[led.index.length - 1].ts);
  ser.forEach(([t, v]) => { assert.ok(isFinite(t) && isFinite(v)); });
});

ok('损坏或空账本：重置而不是崩溃', () => {
  assert.deepStrictEqual(L.summarize(null, {}).n, 0);
  assert.deepStrictEqual(L.summarize({}, {}).n, 0);
  const bad = { signals: 'nope', index: 3 };
  const led = L.normalize(bad);
  assert.ok(led.signals && led.index);
  const r = L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0);
  assert.strictEqual(r.opened, 1);
  assert.ok(led.signals['first|solana:AAA']);
  const st = L.summarize(led, { horizon: '1h' });
  assert.strictEqual(st.n, 0);
  assert.strictEqual(st.sampleEnough, false);
});

ok('reset 后账本归零', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.reset(led);
  assert.strictEqual(Object.keys(led.signals).length, 0);
  assert.strictEqual(led.index.length, 0);
  assert.strictEqual(led.indexLevel, 1);
});

ok('任意组合下统计结果不出现 NaN 或 undefined', () => {
  const led = L.create();
  // 混入各种边界：无流动性、零市值、极老、无 factors、乱序时间
  L.observe(led, board(
    tok({ key: 'solana:P1', liquidityUsd: 0, fdv: 0, ageMin: null }),
    tok({ key: 'solana:P2', factors: {} }),
    tok({ key: 'solana:P3', score: 0, grade: 'trash' }),
    tok({ key: 'solana:P4', priceUsd: 1e-12 })
  ), T0);
  L.observe(led, board(tok({ key: 'solana:P1', priceUsd: 2 })), T0 + 30 * 60e3);
  L.settle(led, { 'solana:P2': 2, 'solana:P3': 0.1, 'solana:P4': 5 }, T0 + 60 * 60e3 + 1);
  for (const h of L.HKEYS) {
    for (const why of ['all', 'first', 'upgrade']) {
      const st = L.summarize(led, { horizon: h, why });
      const s = JSON.stringify(st, (k, v) => (typeof v === 'number' && !isFinite(v) ? 'BAD(' + k + ')' : v));
      assert.ok(!/Bad|BAD|NaN|Infinity|undefined/.test(s), h + '/' + why + ' 出现非法数值：' + s.slice(0, 300));
    }
  }
  L.samples(led, { horizon: '24h' }).forEach((x) => {
    assert.ok(x.r === null || isFinite(x.r));
    assert.ok(x.ex === null || isFinite(x.ex));
  });
});

console.log(pass ? '\n通过 ' + pass + ' 项' : '\n没有用例通过');
