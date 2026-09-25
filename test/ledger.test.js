'use strict';
/**
 * 信号账本零依赖测试：node test/ledger.test.js
 *
 * 覆盖八件事，每一件都对着「会让胜率数字说谎」的缺陷写：
 *   入场 —— 三条腿（首现 / 升级 / 只买真龙）各自的开仓门槛与去重。
 *   出场 —— 止盈是否优先于持满视界、成交时点是不是触线那一刻、视界窗口有没有生效。
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

// 止盈线统一引用导出值，别把 0.15 抄进断言 —— 否则哪天改了阈值，测试还是绿的
const TP = L.DRAGON_TP;
// 一个幅度明显不到止盈线的价格，用来单独验「持满视界」这条路径
const BELOW_TP = 1.05;

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

ok('真龙档首轮同时开三条腿：首现对照 + 升级对照 + 只买真龙的策略腿', () => {
  const led = L.create();
  const r = L.observe(led, board(tok({ grade: 'dragon', score: 85 })), T0);
  assert.strictEqual(r.opened, 3, '真龙档应开首现、升级、真龙三条腿，实际 ' + r.opened);
  assert.ok(led.signals['first|solana:AAA']);
  assert.ok(led.signals['upgrade|solana:AAA']);
  assert.ok(led.signals['dragon|solana:AAA'], '策略腿必须在真龙档开出');
  assert.strictEqual(led.signals['upgrade|solana:AAA'].score, 85);
  assert.strictEqual(led.signals['dragon|solana:AAA'].why, 'dragon');
});

ok('只买真龙：非真龙档一律不开策略腿，哪怕已经到龙头候选', () => {
  const led = L.create();
  const r1 = L.observe(led, board(tok({ grade: 'candidate', score: 72 })), T0);
  assert.ok(led.signals['upgrade|solana:AAA'], '龙头候选应开升级腿');
  assert.ok(!led.signals['dragon|solana:AAA'], '龙头候选不是真龙，不能开策略腿');
  assert.strictEqual(r1.opened, 2, '候选档只开首现 + 升级，实际 ' + r1.opened);

  // 之后升到真龙，策略腿才补开 —— 并且只补开这一条，已有的一条不重复
  const r2 = L.observe(led, board(tok({ grade: 'dragon', score: 88 })), T0 + 60e3);
  assert.strictEqual(r2.opened, 1, '升到真龙只应补开策略腿，实际 ' + r2.opened);
  assert.ok(led.signals['dragon|solana:AAA']);
  assert.strictEqual(Object.keys(led.signals).length, 3);
});

ok('档位升级信号：只有达到「龙头候选」及以上才开', () => {
  const led = L.create();
  const low = L.observe(led, board(tok({ grade: 'watch', score: 50 })), T0);
  assert.strictEqual(low.opened, 1, '低档位只开首现信号');
  assert.ok(led.signals['first|solana:AAA']);
  assert.ok(!led.signals['upgrade|solana:AAA'], '观察档不该开升级信号');

  const high = L.observe(led, board(tok({ grade: 'dragon', score: 85 })), T0 + 60e3);
  assert.strictEqual(high.opened, 2, '升到真龙后应补开升级腿与真龙腿');
  assert.ok(led.signals['upgrade|solana:AAA']);
  assert.ok(led.signals['dragon|solana:AAA']);
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

// ================================================================ 出场规则
console.log('信号账本 · 出场规则（止盈优先于持满视界）');

ok('止盈优先于视界：还没到 15 分钟，只要触线就以那一笔成交', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  // 第 5 分钟冲到远超止盈线，远早于 15 分钟视界
  L.observe(led, board(tok({ priceUsd: 1 + TP + 0.05 })), T0 + 5 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '触线就应成交，不必等视界到点');
  assert.strictEqual(rec.reason, 'tp', '出场原因必须是止盈，实际 ' + rec.reason);
  assert.strictEqual(rec.src, 'tp');
  assert.strictEqual(rec.at, T0 + 5 * 60e3, '成交时点必须是触线那一刻，而不是本轮扫描时刻');
  assert.strictEqual(rec.r, TP, '收益应为止盈线本身，实际 ' + rec.r);
});

ok('止盈按止盈线价成交，不按跳空后那口价：挂在线上的单子就是线价', () => {
  const led = L.create();
  L.observe(led, board(tok({ priceUsd: 1 })), T0);
  // 5 分钟窗口里直接收在 +150%（远超 +100% 的线）
  L.observe(led, board(tok({ priceUsd: 2.5 })), T0 + 5 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.strictEqual(rec.r, TP, '报出来的收益必须是止盈线，实际 ' + rec.r);
  assert.strictEqual(rec.p, 1 * (1 + TP), '成交价应为入场价 ×(1+止盈线)，实际 ' + rec.p);
  // 与离线标定用的封顶法完全等价：min(持满收益, 止盈线)
  assert.strictEqual(rec.r, Math.min(1.5, TP), '止盈结果应等于封顶法结果');
});

ok('止盈成交时点用触线时刻：超额收益不能拿没持有的那段时间去比', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 1 + TP })), T0 + 6 * 60e3);
  const s1h = led.signals['first|solana:AAA'].r['1h'];
  const s24h = led.signals['first|solana:AAA'].r['24h'];
  assert.ok(s1h && s24h, '一次冲高应把还没到点的长视界也一起终结');
  assert.strictEqual(s1h.at, T0 + 6 * 60e3, '1 小时腿的成交时点也应是触线那一刻');
  assert.strictEqual(s24h.at, T0 + 6 * 60e3, '24 小时腿同理');
  assert.strictEqual(s24h.r, s1h.r, '同一笔成交，收益必须一致');
});

ok('止盈只在各自视界的窗口内生效：15 分钟腿不吃 20 分钟的冲高', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  // 第 16 分钟：15 分钟腿的窗口刚过，按持满视界以当时的价成交
  L.observe(led, board(tok({ priceUsd: BELOW_TP })), T0 + 16 * 60e3);
  const s = led.signals['first|solana:AAA'];
  assert.strictEqual(s.r['15m'].reason, 'time', '15 分钟腿应走持满视界，实际 ' + s.r['15m'].reason);
  assert.ok(!s.r['1h'], '1 小时腿既没触线也没到点，不该提前结算');
  // 第 20 分钟冲到远超止盈线：这次在 1 小时腿的窗口内，触线即成交
  L.observe(led, board(tok({ priceUsd: 1 + TP + 0.4 })), T0 + 20 * 60e3);
  assert.strictEqual(s.r['1h'].reason, 'tp', '1 小时腿应被这次冲高止盈，实际 ' + s.r['1h'].reason);
  assert.strictEqual(s.r['1h'].at, T0 + 20 * 60e3);
  // 同一根价格、两条腿两种出场原因 —— 窗口不同，结论本来就该不同
  assert.strictEqual(s.r['15m'].r, 0.05, '15 分钟腿按窗口外那一刻的价成交，实际 ' + s.r['15m'].r);
  assert.strictEqual(s.r['1h'].r, TP, '1 小时腿按止盈线成交，实际 ' + s.r['1h'].r);
});

ok('未触线且未到点：两条路径都不成立，就不结算', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: BELOW_TP })), T0 + 14 * 60e3);
  assert.ok(!led.signals['first|solana:AAA'].r['15m'], '幅度不到止盈线、时间不到点，不能结算');
});

ok('止盈线是导出常量：前端与文档引用同一个值，不各写一份', () => {
  assert.strictEqual(typeof L.DRAGON_TP, 'number');
  // 止盈线必须为正；上不设限 —— 标定出来的结论是「止盈线要么不设，要么设得足够高」
  assert.ok(L.DRAGON_TP > 0, '止盈线应为正数，实际 ' + L.DRAGON_TP);
  assert.strictEqual(L.REASON_LABEL.tp, '止盈');
  assert.strictEqual(L.REASON_LABEL.time, '持满视界');
  assert.strictEqual(L.DRAGON_GRADE, 'dragon');
});

// ================================================================ 结算
console.log('信号账本 · 前瞻结算');

ok('未到点不结算：14 分钟时 15 分钟视界仍为空', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: BELOW_TP })), T0 + 14 * 60e3);
  const s = led.signals['first|solana:AAA'];
  assert.ok(!s.r['15m'], '未到点不能结算');
});

ok('到点按本轮真实价格结算，收益算对，出场原因记为持满视界', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: BELOW_TP })), T0 + 15 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '15 分钟视界应已结算');
  assert.strictEqual(rec.r, 0.05, '1.0 → 1.05 应为 +5%，实际 ' + rec.r);
  assert.strictEqual(rec.src, 'board');
  assert.strictEqual(rec.reason, 'time', '没触线又到点，出场原因应是持满视界');
});

ok('四个视界各自独立结算，互不影响', () => {
  const led = L.create();
  // 涨幅全压在止盈线以下，四条腿才能各自走到自己的到点时刻
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 1.1 })), T0 + 15 * 60e3);
  L.observe(led, board(tok({ priceUsd: 1.12 })), T0 + 1 * H);
  L.observe(led, board(tok({ priceUsd: 0.9 })), T0 + 6 * H);
  L.observe(led, board(tok({ priceUsd: 0.8 })), T0 + 24 * H);
  const s = led.signals['first|solana:AAA'];
  assert.strictEqual(s.r['15m'].r, 0.1, '15m: 1→1.1 应 +10%');
  assert.strictEqual(s.r['1h'].r, 0.12, '1h: 1→1.12 应 +12%');
  assert.strictEqual(s.r['6h'].r, -0.1, '6h: 1→0.9 应 -10%');
  assert.strictEqual(s.r['24h'].r, -0.2, '24h: 1→0.8 应 -20%');
});

ok('触线会让长视界提前收敛：这是止盈的必然结果，不是统计漏样本', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  // 半小时时已远超止盈线，四条腿的窗口都还开着，于是一次冲高把四条腿一起终结
  L.observe(led, board(tok({ priceUsd: 1 + TP + 0.2 })), T0 + 30 * 60e3);
  const s = led.signals['first|solana:AAA'];
  L.HKEYS.forEach((h) => {
    assert.ok(s.r[h], h + ' 触线后不该还在等，实际未结算');
    assert.strictEqual(s.r[h].reason, 'tp', h + ' 出场原因应为止盈');
    assert.strictEqual(s.r[h].at, T0 + 30 * 60e3, h + ' 四条腿的成交时点应是同一刻');
  });
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
  // 中途一直在榜，攒下观测点（幅度压在止盈线以下，单验回补路径）
  L.observe(led, board(tok({ priceUsd: 1.02 })), T0 + 5 * 60e3);
  L.observe(led, board(tok({ priceUsd: 1.04 })), T0 + 10 * 60e3);
  // 到点时这一轮恰好没进榜，只能靠观测序列补
  L.observe(led, board(tok({ key: 'solana:OTHER', symbol: 'OTH', grade: 'watch' })), T0 + 16 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '应能用观测序列补齐');
  assert.strictEqual(rec.src, 'obs', '来源应标为观测序列，实际 ' + rec.src);
  assert.strictEqual(rec.r, 0.04, '应取最接近到点的观测价 1.04，实际 ' + rec.r);
  assert.strictEqual(rec.reason, 'time');
});

ok('本轮榜单里没有的解不开，进入待补价清单，由外部 settle 补上', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:AAA' })), T0);
  L.observe(led, board(tok({ key: 'solana:BBB' })), T0 + 15 * 60e3);
  const r = L.observe(led, board(tok({ key: 'solana:CCC' })), T0 + 16 * 60e3);
  assert.ok(r.needPrices.indexOf('solana:AAA') >= 0, '缺价的标的应在待补清单里：' + JSON.stringify(r.needPrices));
  // 补价已经晚于 15 分钟到点，止盈窗口已关，应走持满视界
  L.settle(led, { 'solana:AAA': 1.4 }, T0 + 16 * 60e3 + 1000);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '外部补价后应结算');
  assert.strictEqual(rec.src, 'board', 'settle 走的是外部价格，来源记为 board 口径');
  assert.strictEqual(rec.r, 0.4, '1 → 1.4 应 +40%，实际 ' + rec.r);
  assert.strictEqual(rec.reason, 'time', '补价时点已过窗口，不能倒算成止盈');
});

ok('补价落在止盈窗口内时照样按止盈算：窗口内触线就该止盈', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:AAA' })), T0);
  // 第 10 分钟外部补到远超止盈线的价，仍在 15 分钟窗口内
  L.settle(led, { 'solana:AAA': 1 + TP + 0.3 }, T0 + 10 * 60e3);
  const rec = led.signals['first|solana:AAA'].r['15m'];
  assert.ok(rec, '窗口内触线应立即结算');
  assert.strictEqual(rec.reason, 'tp');
  assert.strictEqual(rec.at, T0 + 10 * 60e3, '成交时点是补价那一轮，实际 ' + rec.at);
  assert.strictEqual(rec.r, TP, '按止盈线价成交，实际 ' + rec.r);
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

ok('指数净值两个口径同时记录：等权（基准本体）+ 中位（参照）', () => {
  const led = L.create();
  const mk = (p) => [
    tok({ key: 'solana:A', priceUsd: p[0] }), tok({ key: 'solana:B', priceUsd: p[1] }),
    tok({ key: 'solana:C', priceUsd: p[2] }), tok({ key: 'solana:D', priceUsd: p[3] }),
  ];
  L.observe(led, mk([1, 1, 1, 1]), T0);
  L.observe(led, mk([2, 1, 0.5, 3]), T0 + 60e3);
  assert.strictEqual(led.index.length, 1, '应有 1 个指数点');
  // 收益为 +100% / 0% / -50% / +200%；中位 = (0 + 1) / 2 = 0.5
  assert.strictEqual(led.index[0].med, 0.5, '中位口径实际 ' + led.index[0].med);
  assert.strictEqual(led.index[0].level, 1.5, '中位口径净值实际 ' + led.index[0].level);
  // 只有 4 个标的，低于截尾门槛，等权口径就是算术平均：(1 + 0 - 0.5 + 2) / 4 = 0.625
  assert.strictEqual(led.index[0].mean, 0.625, '等权口径实际 ' + led.index[0].mean);
  assert.strictEqual(led.index[0].mlevel, 1.625, '等权口径净值实际 ' + led.index[0].mlevel);
  // 默认口径必须是等权 —— 中位口径在这个市场里恒为 0，拿它当基准等于没有基准
  assert.strictEqual(L.indexReturn(led, T0, T0 + 60e3), 0.625);
  assert.strictEqual(L.indexReturn(led, T0, T0 + 60e3, '', 'med'), 0.5);
});

ok('等权基准不与胜率同义：中位为 0 但等权为正时，「跑赢基准」要真的低于胜率', () => {
  const led = L.create();
  // 榜单上的四个标的用「观察」档，避免它们也开出升级信号，只留下被检验的那一笔
  const w = { grade: 'watch', score: 50 };
  const four = (p) => [
    tok({ key: 'solana:A', priceUsd: p, ...w }), tok({ key: 'solana:B', priceUsd: p, ...w }),
    tok({ key: 'solana:C', priceUsd: p, ...w }), tok({ key: 'solana:D', priceUsd: p, ...w }),
  ];
  const fourUp = (p, u) => [
    tok({ key: 'solana:A', priceUsd: p, ...w }), tok({ key: 'solana:B', priceUsd: p, ...w }),
    tok({ key: 'solana:C', priceUsd: p, ...w }), tok({ key: 'solana:D', priceUsd: p * u, ...w }),
  ];
  L.observe(led, four(1), T0);
  L.observe(led, four(1), T0 + 30 * 60e3);          // 全不动：中位 0，等权 0
  L.observe(led, fourUp(1, 1.5), T0 + 60 * 60e3);   // 只有一个动：中位仍然 0，等权 = 0.5/4 = 0.125
  assert.strictEqual(led.index[1].med, 0, '中位口径应精确为 0，实际 ' + led.index[1].med);
  assert.strictEqual(led.index[1].mean, 0.125, '等权口径实际 ' + led.index[1].mean);

  L.observe(led, board(tok({ key: 'solana:HIT', symbol: 'HIT', priceUsd: 1 })), T0);
  // 标的涨 5%：收益为正（算胜），但没跑赢等权基准
  L.settle(led, { 'solana:HIT': 1.05 }, T0 + 60 * 60e3 + 1);
  const st = L.summarize(led, { horizon: '1h', why: 'upgrade' });
  assert.strictEqual(st.n, 1, '升级信号应只有 1 笔，实际 ' + st.n);
  assert.strictEqual(st.winRate, 1, '正收益占比应为 1');
  assert.ok(st.benchmark.marketReturn > 0.1, '等权基准必须显著为正，实际 ' + st.benchmark.marketReturn);
  assert.notStrictEqual(st.benchmark.beatRate, st.winRate,
    '跑赢基准的比例不能等于胜率 —— 相等就说明基准退化成了 0');
  assert.strictEqual(st.benchmark.beatRate, 0, '实际 ' + st.benchmark.beatRate);
  assert.ok(st.benchmark.medianExcess < 0, '超额必须为负，实际 ' + st.benchmark.medianExcess);
  // 中位口径依旧贴 0，它只是参照，已经不再承担基准职责
  assert.strictEqual(st.benchmark.medianReturn, 0, '中位口径参照值实际 ' + st.benchmark.medianReturn);
});

ok('标的够多时单轮做 10% 截尾：个别脏点抬不动整条基准线', () => {
  const led = L.create();
  const n = 22;
  const flat = [];
  for (let i = 0; i < n; i++) flat.push(tok({ key: 'solana:F' + i, symbol: 'F' + i, priceUsd: 1 }));
  L.observe(led, flat, T0);
  // 20 个不动 + 1 个 +1000%（刚好卡在脏点阈值内）+ 1 个 -5%
  const noisy = flat.map((t, i) => tok({ key: t.key, symbol: t.symbol, priceUsd: i === 0 ? 11 : (i === 1 ? 0.95 : 1) }));
  L.observe(led, noisy, T0 + 60e3);
  const e = led.index[0];
  assert.ok(e, '应记下指数点');
  // 未截尾的算术平均会被 +1000% 拉起来，截尾后首尾各去掉 2 个，只剩不动的标的
  assert.strictEqual(e.mean, 0, '截尾后应为 0，实际 ' + e.mean);
  const raw = (10 + -0.05) / 22;
  assert.ok(raw > 0.4, '作为对照：未截尾均值会被脏点拉到 ' + raw);
});

ok('等权口径也保留亚 0.01% 的轮间收益，且净值与区间收益回算一致', () => {
  const led = L.create();
  const three = (p) => board(
    tok({ key: 'solana:A', priceUsd: p }),
    tok({ key: 'solana:B', priceUsd: p }),
    tok({ key: 'solana:C', priceUsd: p })
  );
  L.observe(led, three(1), T0);
  // 每轮只涨 0.001%：线上真实榜单的轮间波动就是这个量级
  L.observe(led, three(1 + 1e-5), T0 + 60e3);
  assert.strictEqual(led.index.length, 1, '应记下 1 个指数点');
  assert.strictEqual(led.index[0].med, 1e-5, '轮间中位收益必须保留 1e-5，实际 ' + led.index[0].med);
  assert.strictEqual(led.index[0].mean, 1e-5, '轮间等权收益必须保留 1e-5，实际 ' + led.index[0].mean);
  assert.ok(led.index[0].mlevel > 1, '等权净值必须真的动了，而不是停在 1');
  const r = L.indexReturn(led, T0, T0 + 120e3);
  assert.ok(r != null && r > 0, '区间收益必须为正，实际 ' + r);
  // 净值用未舍入值累乘、区间收益用已存值回算，两个精度必须对得上
  assert.ok(Math.abs(led.index[0].mlevel - (1 + r)) < 1e-12,
    '已存净值与区间收益回算必须一致：' + led.index[0].mlevel + ' vs ' + (1 + r));
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
  assert.strictEqual(led.index[0].mean, 0, '脏点应剔除后等权均值也为 0，实际 ' + led.index[0].mean);
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

ok('signal 类型过滤：首现、升级、只买真龙三条腿分开统计', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:X', grade: 'dragon', score: 88 })), T0);
  L.settle(led, { 'solana:X': 1.05 }, T0 + 1 * H + 1);
  const all = L.summarize(led, { horizon: '1h', why: 'all' });
  const first = L.summarize(led, { horizon: '1h', why: 'first' });
  const up = L.summarize(led, { horizon: '1h', why: 'upgrade' });
  const dr = L.summarize(led, { horizon: '1h', why: 'dragon' });
  assert.strictEqual(all.n, 3, '首现 + 升级 + 真龙 = 3 笔');
  assert.strictEqual(first.n, 1);
  assert.strictEqual(up.n, 1);
  assert.strictEqual(dr.n, 1, '策略腿应能单独取出来统计');
  assert.strictEqual(up.whyLabel, '档位升级信号');
  assert.strictEqual(dr.whyLabel, '真龙信号');
});

ok('止盈在汇总里可量化：触发率、触发笔数、未触发笔数的中位收益一起给出', () => {
  const led = L.create();
  // 8 笔触线止盈 + 4 笔持满视界
  for (let i = 0; i < 8; i++) {
    const k = 'solana:TP' + i;
    L.observe(led, board(tok({ key: k, symbol: 'TP' + i })), T0 + i);
    L.observe(led, board(tok({ key: k, symbol: 'TP' + i, priceUsd: 1 + TP + 0.5 })), T0 + i + 3 * 60e3);
  }
  for (let i = 0; i < 4; i++) {
    const k = 'solana:HL' + i;
    L.observe(led, board(tok({ key: k, symbol: 'HL' + i })), T0 + 100 + i);
    L.settle(led, { [k]: 0.9 }, T0 + 100 + i + 1 * H + 1);
  }
  const st = L.summarize(led, { horizon: '1h', why: 'first' });
  assert.strictEqual(st.n, 12, '实际 ' + st.n);
  assert.strictEqual(st.tp.count, 8, '实际 ' + st.tp.count);
  assert.strictEqual(st.tp.rate, 0.6667, '触发率实际 ' + st.tp.rate);
  assert.strictEqual(st.tp.threshold, L.DRAGON_TP);
  assert.strictEqual(st.tp.median, TP, '止盈笔的收益必须精确落在止盈线上，实际 ' + st.tp.median);
  assert.strictEqual(st.tp.holdCount, 4);
  assert.strictEqual(st.tp.holdMedian, -0.1, '未触发笔的中位实际 ' + st.tp.holdMedian);
  // 止盈按线成交，所以「最好」不会超过止盈线。这是止盈的代价本身，必须报出来而不是藏起来。
  assert.strictEqual(st.best, TP, '实际 ' + st.best);
  // 止盈线就在 +100% 上，所以「翻倍以上」这一档与「止盈触发」是同一批样本 —— 不是巧合，是构造
  assert.strictEqual(st.doubleRate, st.tp.rate, '止盈线定在 +100% 时两者必然相等');
  const rows = L.samples(led, { horizon: '1h', why: 'first', limit: 50 });
  assert.strictEqual(rows.filter((x) => x.reason === 'tp').length, 8);
  assert.strictEqual(rows.filter((x) => x.reason === 'time').length, 4);
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
  assert.strictEqual(led.marketLevel, 1);
});

ok('旧版本账本直接重置：指数口径换过一次，一条线上不能混两种口径', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  L.observe(led, board(tok({ priceUsd: 2 })), T0 + 30 * 60e3);
  led.v = 1;
  const back = L.normalize(led);
  assert.strictEqual(back.index.length, 0, '旧账本必须重置，不能带着旧口径继续累');
  assert.strictEqual(Object.keys(back.signals).length, 0);
  assert.strictEqual(back.v, L.VERSION);
});

ok('止盈后收益不会超过止盈线：线上规则不能跑赢自己设的上限', () => {
  const led = L.create();
  L.observe(led, board(tok()), T0);
  // 一路狂涨，四条腿都会撞线
  for (let i = 1; i <= 12; i++) L.observe(led, board(tok({ priceUsd: 1 + i * 0.5 })), T0 + i * 15 * 60e3);
  const s = led.signals['first|solana:AAA'];
  let checked = 0;
  L.HKEYS.forEach((h) => {
    if (!s.r[h]) return;
    checked++;
    assert.ok(s.r[h].r <= L.DRAGON_TP,
      h + ' 的收益 ' + s.r[h].r + ' 超过了止盈线 ' + L.DRAGON_TP + '（出场原因 ' + s.r[h].reason + '）');
  });
  assert.ok(checked >= 2, '至少应结算两条腿，实际 ' + checked);
  const tpRec = s.r['1h'];
  assert.strictEqual(tpRec.reason, 'tp', '1 小时腿应撞线止盈，实际 ' + tpRec.reason);
  assert.strictEqual(tpRec.r, L.DRAGON_TP, '1 小时腿应精确按止盈线成交，实际 ' + tpRec.r);
  // 15 分钟腿的窗口在 +50% 时到点，那时还没到线，所以按持满视界成交 —— 这条路不触线
  assert.strictEqual(s.r['15m'].reason, 'time');
  assert.ok(s.r['15m'].r < L.DRAGON_TP, '未触线的腿收益自然低于止盈线，实际 ' + s.r['15m'].r);
});

ok('只加字段的那一版就地升版：v2 的样本不能白丢', () => {
  const led = L.create();
  L.observe(led, board(tok({ key: 'solana:V2', symbol: 'V2' })), T0);
  L.observe(led, board(tok({ key: 'solana:V2', symbol: 'V2', priceUsd: BELOW_TP })), T0 + 30 * 60e3);
  const before = Object.keys(led.signals).length;
  assert.ok(before > 0, '先得有数据');
  // 造一个 v2 账本：去掉新字段（reason / tp / dragon 腿），版本号退回 2
  const v2 = JSON.parse(JSON.stringify(led));
  v2.v = 2;
  delete v2.signals['first|solana:V2'].r['15m'].reason;
  const back = L.normalize(v2);
  assert.strictEqual(back.v, L.VERSION, '应就地升到当前版本，实际 ' + back.v);
  assert.strictEqual(Object.keys(back.signals).length, before, 'v2 的信号必须保留，不能因为加字段就重置');
  // 缺 reason 的旧记录按「持满视界」解释 —— 那时只有这一种出场方式
  const st = L.summarize(back, { horizon: '15m', why: 'first' });
  assert.strictEqual(st.n, 1);
  assert.strictEqual(st.tp.count, 0, '旧记录不该被误判成止盈，实际 ' + st.tp.count);
  assert.strictEqual(L.samples(back, { horizon: '15m', why: 'first' })[0].reason, 'time');
});

ok('观测序列按 5 分钟窗口累积：连续运行时不能被就地覆盖成 1 个点', () => {
  const led = L.create();
  // 涨幅压在止盈线以下：一旦触线信号就结束，观测序列会被清掉，验不到累积
  const mk = (p) => board(tok({ key: 'solana:OBS', symbol: 'OBS', priceUsd: p }));
  // 每 60 秒一轮，连跑 30 分钟
  for (let i = 0; i <= 30; i++) L.observe(led, mk(1 + i * 0.002), T0 + i * 60e3);
  const series = led.__obs['first|solana:OBS'];
  assert.ok(series && series.length >= 5,
    '30 分钟至少应留下 5 个观测点，实际 ' + (series ? series.length : 0));
  // 同一个 5 分钟窗口内只保留最新价，不能一轮一个点把序列撑爆
  assert.ok(series.length <= 8, '同一窗口内不应每个点都留下，实际 ' + series.length);
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i][0] > series[i - 1][0], '观测点时间必须严格递增');
  }
});

ok('观测序列撑得起来：最大不利偏移才有多点可算', () => {
  const led = L.create();
  const mk = (p) => board(tok({ key: 'solana:MAE', symbol: 'MAE', priceUsd: p }));
  L.observe(led, mk(1), T0);
  // 中途一路跌到 0.6，再涨回来
  for (let i = 1; i <= 12; i++) L.observe(led, mk(i <= 8 ? 1 - i * 0.05 : 0.6 + (i - 8) * 0.1), T0 + i * 5 * 60e3);
  L.settle(led, { 'solana:MAE': 1.0 }, T0 + 60 * 60e3 + 1);
  const sig = led.signals['first|solana:MAE'];
  const rec = sig.r['1h'];
  assert.ok(rec, '应已结算');
  assert.ok(rec.mae != null && rec.mae < -0.3,
    '中途跌到 0.6 就必须记下约 -40% 的最大浮亏，实际 ' + rec.mae);
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
    for (const why of ['all', 'first', 'upgrade', 'dragon']) {
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
