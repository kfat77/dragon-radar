'use strict';
/**
 * 止盈 / 止损阈值标定器（离线、只读、不联网）
 *
 *   node tools/tp-explore.js [--file=path] [--horizon=1h] [--why=all|dragon|upgrade|first]
 *
 * 目的：给「止盈线定在哪里」找一个量出来的答案，而不是拍一个。
 *
 * ================================================================
 * 主口径：封顶法（capping）—— 只用账本已结算的收益，不依赖观测序列
 * ================================================================
 * 对每个已结算样本，把收益按各条候选止盈线封顶：r' = min(r, tp)。
 *
 * 为什么这不是糊弄：
 *   任何一个**结算在止盈线之上**的样本，价格既然收在线之上，途中必然穿过这条线，
 *   止盈就按线附近成交 —— 所以对这半边样本，封顶是**精确**的重演，不是近似。
 *   只有结算在线下的样本才可能被低估（途中冲高又回落、收盘却低于线的那些）。
 *   于是：**这条线的成本被精确量到，收益只会被低估**。
 *   拿一个只能量到成本、量不到收益的规则去削掉大部分上行，结论就已经够清楚了。
 *   附带好处：样本 = 全部已结算样本，没有「必须有观测序列」这个筛选条件，
 *   也就不带那个致命的幸存者偏倚（见下）。
 *
 * ================================================================
 * 辅助口径：观测序列法（walk）—— 只在标的还留在候选池里时才看得到路径
 * ================================================================
 * 沿观测序列按时间顺序走，判断「到点之前先碰到止盈还是止损」。
 * **这个口径有一个严重的结构性盲区，读它的数之前必须先看这一段：**
 *   观测点只在标的还留在候选池里时才产生，而候选池取自「最新推广 / 最新资料」。
 *   一个标的涨上去之后往往就不再被这些源返回，于是**涨得最猛的那批最快离开候选池**。
 *   实测同一份账本：留在池里（有观测序列）的那批 1 小时收益中位 -0.1%，
 *   离开池里被回补结算的那批中位 +13.6% —— 差 13 个百分点。
 *   结论：这条口径看不到赢家，它给出的触发率与收益都偏向「留下来的输家」。
 *   所以它只用来回答「止损值不值得设」这类**在同一批样本内部比较**的问题，
 *   不用来定止盈线的高度。
 *
 * 另有一条历史上的坑，改这里之前请先记住：本文件第一版的 walk() 在没触线时返回了
 * 窗口内的**第一个**观测点，于是号称「持满视界基线」的那一行其实是「持 5 分钟」，
 * 胜率 22.9% / 均值 -7.4%，而账本里真实的 1 小时结算均值是 +6.2%。
 * 差了 13 个百分点，整张表全废。现在 walk() 只回答「有没有触线」，没触线一律交回
 * 账本的真实结算值，不自行推算。
 *
 * 已知口径限制（不藏）：止盈判定用价格比（p >= p0*(1+tp)）而不是先算收益率再比，
 * 否则 1.15 / 1 - 1 = 0.1499999999999999，恰好卡线的价格会被判成没到线。
 */
const fs = require('fs');
const path = require('path');
const L = require('../lib/ledger');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
}

const FILE = arg('file', path.join(__dirname, '..', 'data', 'ledger.json'));
const HK = L.HKEYS.indexOf(arg('horizon', '1h')) >= 0 ? arg('horizon', '1h') : '1h';
const WHY = arg('why', 'all');
const H = L.HORIZONS.find((h) => h.key === HK);

const led = L.normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
const obs = led.__obs || {};

const pct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
const rate = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const num = (v, w) => String(v).padStart(w);
const pad = (s, n) => String(s).padEnd(n);

const med = (a) => (a.length ? L.median(a) : null);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** 全部已结算样本（止盈封顶法用这套；不做「必须有观测序列」的筛选） */
const all = Object.keys(led.signals).map((id) => led.signals[id])
  .filter((s) => s.r[HK] && (WHY === 'all' || s.why === WHY));

/** 有观测序列的子集（观测序列法用这套；自带幸存者偏倚，见文件头） */
const withObs = all.filter((s) => obs[s.id] && obs[s.id].length);

const noSeries = all.filter((s) => !obs[s.id] || !obs[s.id].length).length;

console.log('止盈 / 止损阈值标定  ·  账本 ' + FILE);
console.log('视界 ' + HK + ' ｜ 信号类型 ' + WHY);
console.log('已结算样本 ' + all.length + ' 笔，其中留有观测序列的 ' + withObs.length
  + ' 笔（无观测序列、由外部回补结算的 ' + noSeries + ' 笔）');
console.log('');

if (!all.length) {
  console.log('该口径下还没有已结算样本，先让服务跑一段时间。');
  process.exit(0);
}

// ================================================================ 主口径
/**
 * 封顶法。tp 为 null 表示不止盈。
 * 超额按「信号的实际出场时刻」对齐：止盈出场的基准窗口短，持满视界的窗口长，
 * 用同一个窗口比会把「早出场」错记成「跑赢」。
 */
function capRun(rows, tp) {
  const rets = [], exs = [];
  let touched = 0;
  for (const s of rows) {
    const r = tp == null ? s.r[HK].r : Math.min(s.r[HK].r, tp);
    if (tp != null && s.r[HK].r >= tp) touched++;
    rets.push(r);
    const idx = L.indexReturn(led, s.t0, s.r[HK].at, s.chainId, 'mean');
    if (idx != null) exs.push(r - idx);
  }
  return {
    n: rets.length,
    winRate: rets.filter((x) => x > 0).length / rets.length,
    median: med(rets), mean: mean(rets), trimMean: L.trimmedMean(rets, 0.1),
    medianExcess: med(exs),
    beatRate: exs.length ? exs.filter((x) => x > 0).length / exs.length : null,
    touchShare: tp == null ? null : touched / rets.length,
  };
}

const base = capRun(all, null);
console.log('主口径 · 封顶法（样本 = 全部已结算，' + base.n + ' 笔；不依赖观测序列）');
console.log('  不止盈：胜率 ' + rate(base.winRate) + ' ｜ 中位 ' + pct(base.median)
  + ' ｜ 均值 ' + pct(base.mean) + ' ｜ 截尾均值 ' + pct(base.trimMean)
  + ' ｜ 中位超额 ' + pct(base.medianExcess) + ' ｜ 跑赢基准 ' + rate(base.beatRate));
console.log('  注：均值被个位数的大赢家主导（单笔最高 '
  + pct(Math.max.apply(null, all.map((s) => s.r[HK].r))) + '），'
  + '所以判据以 10% 截尾均值为准 —— 两个均值方向不一致时，信截尾的那个。');
console.log('');
console.log(pad('止盈线', 10) + num('胜率', 9) + num('中位收益', 11) + num('均值收益', 11)
  + num('截尾均值', 11) + num('中位超额', 11) + num('跑赢基准', 10) + num('触线占比', 10) + num('样本', 7));
for (const tp of [0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.8, 1.0, 2.0]) {
  const r = capRun(all, tp);
  console.log(pad('+' + Math.round(tp * 100) + '%', 10) + num(rate(r.winRate), 9)
    + num(pct(r.median), 11) + num(pct(r.mean), 11) + num(pct(r.trimMean), 11)
    + num(pct(r.medianExcess), 11) + num(rate(r.beatRate), 10)
    + num(rate(r.touchShare), 10) + num(r.n, 7));
}
console.log('');
console.log('读法：胜率这一列对封顶法**不敏感**（封顶不会把亏损变成盈利），所以别拿它挑线。');
console.log('要看的是截尾均值 —— 它才是「削掉上行」这件事的真实代价。'
  + '哪条线的截尾均值开始不低于「不止盈」，那条线才是无害的起点。');
console.log('');

// ================================================================ 辅助口径
console.log('=========================================================');
console.log('辅助口径 · 观测序列法（只覆盖留在候选池里的那批，' + withObs.length + ' 笔）');
console.log('警告：这批标的系统性偏向「留下来的输家」，涨得猛的早已离开候选池。'
  + '这里只看**同批样本内部**的止损比较，不用它的触发率去定止盈线高度。');
console.log('');

/** 沿观测序列找第一个触线点；没触线返回 null，交回账本真实结算 */
function walk(series, t0, due, price0, tp, sl) {
  if (!series) return null;
  for (const pt of series) {
    const ts = pt[0], p = pt[1];
    if (!(p > 0) || ts <= t0 || ts > due) continue;
    const r = p / price0 - 1;
    if (tp != null && p >= price0 * (1 + tp)) return { reason: 'tp', at: ts, r: r };
    if (sl != null && p <= price0 * (1 + sl)) return { reason: 'sl', at: ts, r: r };
  }
  return null;
}

function walkRun(tp, sl) {
  const rets = [], exs = [], reasons = { tp: 0, sl: 0, time: 0 };
  for (const s of withObs) {
    const due = s.t0 + H.ms;
    const hit = (tp == null && sl == null) ? null : walk(obs[s.id], s.t0, due, s.price0, tp, sl);
    let r, at;
    if (hit) { r = hit.r; at = hit.at; reasons[hit.reason]++; }
    else { r = s.r[HK].r; at = s.r[HK].at; reasons.time++; }
    rets.push(r);
    const idx = L.indexReturn(led, s.t0, at, s.chainId, 'mean');
    if (idx != null) exs.push(r - idx);
  }
  return {
    n: rets.length,
    winRate: rets.filter((x) => x > 0).length / rets.length,
    median: med(rets), mean: mean(rets), trimMean: L.trimmedMean(rets, 0.1),
    medianExcess: med(exs), reasons: reasons,
  };
}

const samePool = walkRun(null, null);
console.log('  同批样本基线（不设止盈止损）：胜率 ' + rate(samePool.winRate)
  + ' ｜ 中位 ' + pct(samePool.median) + ' ｜ 均值 ' + pct(samePool.mean)
  + ' ｜ 截尾均值 ' + pct(samePool.trimMean) + ' ｜ 中位超额 ' + pct(samePool.medianExcess));
console.log('');
console.log('  止盈 + 止损组合（回答「止损到底有没有用」）：');
console.log('  ' + pad('组合', 14) + num('胜率', 9) + num('中位收益', 11)
  + num('均值收益', 11) + num('截尾均值', 11) + num('中位超额', 11) + num('触发', 8));
const runs = {};
for (const [tp, sl] of [[null, null], [1.0, null], [0.3, null], [null, -0.2], [null, -0.35], [1.0, -0.2], [1.0, -0.35]]) {
  const r = walkRun(tp, sl);
  const label = (tp == null ? '不止盈' : '+' + Math.round(tp * 100) + '%') + ' / '
    + (sl == null ? '不止损' : Math.round(sl * 100) + '%');
  runs[label] = r;
  console.log('  ' + pad(label, 14) + num(rate(r.winRate), 9) + num(pct(r.median), 11)
    + num(pct(r.mean), 11) + num(pct(r.trimMean), 11) + num(pct(r.medianExcess), 11)
    + num((r.reasons.tp + r.reasons.sl) + '笔', 8));
}
console.log('');
// 结论文字里的数字必须从上面这张表里取，不能写死：样本每长大一轮就会漂，
// 写死的数字会变成一段「看起来像实测、其实是旧值」的说明。
const slBase = runs['不止盈 / 不止损'];
let stopped = null, stoppedLabel = '';
// 只看「不止盈 / 加止损」这一组，才是干净的止损对照；带上止盈的组合混了两个变量。
for (const k of Object.keys(runs)) {
  if (!k.startsWith('不止盈 / -')) continue;
  const r = runs[k];
  if (!stopped || Math.abs(r.mean) < Math.abs(stopped.mean)) { stopped = r; stoppedLabel = k; }
}
if (slBase && stopped) {
  const dB = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  console.log('  止损的实测结论是**混合的**，不要一句话概括（下表读 ' + stoppedLabel + '）：');
  console.log('  止损确实削掉了左侧尾部（均值 ' + dB(slBase.mean) + ' → ' + dB(stopped.mean)
    + '，截尾均值 ' + dB(slBase.trimMean) + ' → ' + dB(stopped.trimMean) + '），');
  console.log('  但胜率 ' + rate(slBase.winRate) + ' → ' + rate(stopped.winRate)
    + '、中位收益 ' + dB(slBase.median) + ' → ' + dB(stopped.median)
    + '、中位超额 ' + dB(slBase.medianExcess) + ' → ' + dB(stopped.medianExcess) + '。');
  console.log('  也就是说它改善的是「能亏多少」，没有改善「赚不赚得到」。');
}
console.log('  而且这一批样本自带幸存者偏倚，所以这里的数不能当结论用；');
console.log('  结构性理由才是决定性的：止损只能落在「有观测点」的时刻上，');
console.log('  而真正该止损的那批（池子被撤、标的归零）往往先掉出候选池、不再产生观测点，');
console.log('  止损根本不会响；它响的是「还在、只是波动大」的那批。');
console.log('  所以本模块不设止损。');
console.log('');

// ================================================================ 分腿 / 分档
if (WHY === 'all') {
  console.log('=========================================================');
  console.log('分腿比较（封顶法，止盈线 ' + Math.round(L.DRAGON_TP * 100) + '%）');
  console.log('  ' + pad('信号腿', 12) + num('样本', 7) + num('胜率', 9) + num('中位收益', 11)
    + num('均值收益', 11) + num('截尾均值', 11) + num('中位超额', 11));
  for (const w of ['dragon', 'upgrade', 'first']) {
    const rows = all.filter((s) => s.why === w);
    if (!rows.length) {
      console.log('  ' + pad(L.WHY_LABEL[w] || w, 12) + num(0, 7) + '    尚无已结算样本');
      continue;
    }
    const r = capRun(rows, L.DRAGON_TP);
    console.log('  ' + pad(L.WHY_LABEL[w] || w, 12) + num(r.n, 7) + num(rate(r.winRate), 9)
      + num(pct(r.median), 11) + num(pct(r.mean), 11) + num(pct(r.trimMean), 11)
      + num(pct(r.medianExcess), 11));
  }
  console.log('');
}

// 真龙明细
const dragons = all.filter((s) => s.grade === 'dragon');
console.log('真龙档明细（n=' + dragons.length + '，封顶法 ' + Math.round(L.DRAGON_TP * 100) + '%）：');
if (!dragons.length) {
  console.log('  还没有真龙档的已结算样本。真龙档本身很稀有，这条腿的样本积得最慢。');
} else {
  for (const s of dragons) {
    console.log('  ' + pad(s.why, 8) + pad(s.symbol, 12)
      + ' 持满 ' + num(pct(s.r[HK].r), 9)
      + ' 封顶后 ' + num(pct(Math.min(s.r[HK].r, L.DRAGON_TP)), 9)
      + ' 出场 ' + (s.r[HK].reason === 'tp' ? '止盈' : '持满视界'));
  }
}
console.log('');
console.log('已知偏差：本工具读的是同一份账本，因此继承账本的全部已知偏差 —— 候选池不是全市场、'
  + '榜单指数偏向留下来的标的、结算价是公开报价而非可成交价。'
  + '榜单指数偏低会让超额收益偏乐观，这一条在 README「已知偏差」里有说明。');
