/**
 * 龙分（Dragon Score）模型
 * 纯函数模块，不依赖网络，可单独测试与回测。
 *
 * 设计原则：
 *  1. 方向（龙分） / 置信度（置信） / 风险（风险扣分）三者分离，不用一个数通吃。
 *  2. 每个因子都有可解释的中文说明，前端直接展示。
 *  3. 缺数据 ≠ 中性：缺什么就扣置信度，不假装它是 0。
 *  4. 无 look-ahead：只使用当前快照与更早的快照。
 *
 * 同构模块：Node 端 require('./lib/score')，浏览器端 <script> 加载后使用 window.DragonScore。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DragonScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const c01 = (x) => clamp(x, 0, 1);
const num = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : d);
const lg = (x) => Math.log10(Math.max(x, 1e-9));

// ---------------------------------------------------------------- 因子权重
const WEIGHTS = {
  volBurst: 0.18,      // 量能爆发（区间成交量相对基准的放大倍数）
  buyPressure: 0.16,   // 买盘压强（主动买占比 / 买卖家数）
  accel: 0.14,         // 起动加速度（短周期相对长周期的超额涨幅）
  resonance: 0.13,     // 多周期共振（m5/h1/h6/h24 方向一致性）
  liquidity: 0.12,     // 流动性安全（深度 + 深度/市值比）
  headroom: 0.11,      // 市值空间（还有多少倍空间）
  freshness: 0.08,     // 池子新鲜度
  social: 0.08,        // 社交/推广热度
};

// ------------------------------------------------- 统计窗口可用性（关键防坑）
/**
 * DexScreener 对“池龄不足某窗口”的代币，会把所有窗口填成同一个值（h24==h6==h1==m5）。
 * 直接拿来算多周期共振会得到假信号，所以先判定每个窗口是否真的成立。
 */
const WIN_MIN = { m5: 5, h1: 60, h6: 360, h24: 1440 };
function windowAvailability(cur, now) {
  const ageMin = cur.pairCreatedAt ? (now - cur.pairCreatedAt) / 60000 : 1e9;
  const pc = cur.priceChange || {};
  const vals = ['m5', 'h1', 'h6', 'h24'].map((k) => num(pc[k], NaN));
  const allEqual = vals.every((v) => Number.isFinite(v)) && vals.every((v) => v === vals[0]);
  const avail = {};
  for (const k of Object.keys(WIN_MIN)) {
    let ok = ageMin >= WIN_MIN[k];
    // 全等说明是退化填充：只信最短窗口
    if (allEqual && k !== 'm5') ok = false;
    avail[k] = ok;
  }
  if (!Object.values(avail).some(Boolean)) avail.m5 = true;
  return { avail, ageMin, degenerate: allEqual };
}

// ---------------------------------------------------------------- 基础因子
function fVolBurst(cur, prev) {
  const v = cur.volume || {};
  const ageSec = cur.pairCreatedAt ? Math.max(300, (Date.now() - cur.pairCreatedAt) / 1000) : 86400;
  const effAge = Math.min(86400, ageSec);
  // 当前速率：有历史快照就用区间真实增量（能修掉新池 h24==h1==m5 的退化统计），否则用 5 分钟均值。
  // 快照字段名以服务端为准（volH24），并兼容旧字段；增量异常（为负/超过总量，通常是数据源重置）时退回 5 分钟均值。
  const prevVol = prev ? num(prev.volH24, num(prev.volumeH24)) : NaN;
  const rawDelta = num(v.h24) - prevVol;
  const dVolOk = isFinite(rawDelta) && rawDelta >= 0 && rawDelta <= num(v.h24);
  const hasDelta = !!(prev && cur._dtSec > 30 && dVolOk);
  const dVol = hasDelta ? rawDelta : 0;
  const rateNow = hasDelta ? dVol / cur._dtSec : num(v.m5) / 300;

  // 基准速率：新池用生命周期均速，成熟池用 24 小时均速
  const rateBase = ageSec >= 3600 ? Math.max(num(v.h24) / 86400, 0.02) : Math.max(num(v.h24) / effAge, 0.02);

  // 饱和点：成熟池 15x、新池 40x（新池余量更大）；区间实测成交太小则按“每 $100 最多算 1x”限幅，防止几笔小单刷出天量倍数
  const sat = ageSec >= 3600 ? 15 : 40;
  const absVol = hasDelta ? dVol : num(v.m5);
  const ceiling = Math.max(3, absVol / 100);
  const ratio = clamp(rateNow / rateBase, 0, ceiling);

  const score = 100 * c01(lg(1 + ratio) / lg(1 + sat));
  return { key: 'volBurst', score, raw: ratio, src: hasDelta ? 'delta' : 'm5ratio', sat, text: `${ratio.toFixed(2)}x 量能` };
}

function fBuyPressure(cur, avail) {
  const t = cur.txns || {};
  const m5 = t.m5 || {}, h1 = t.h1 || {};
  const SHRINK = 25; // 小样本向中性收缩，避免“2 笔成交 100% 买盘”这类噪声
  const acc = (a, b, w) => {
    const n = num(a) + num(b);
    if (n <= 0) return null;
    const raw = (num(a) - num(b)) / n;
    const shrunk = raw * (n / (n + SHRINK));
    return { v: shrunk, raw, n, w };
  };
  const A = avail || { m5: true, h1: true, h6: true, h24: true };
  const parts = [A.m5 ? acc(m5.buys, m5.sells, 0.55) : null, A.h1 ? acc(h1.buys, h1.sells, 0.45) : null].filter(Boolean);
  if (!parts.length) return { key: 'buyPressure', score: 50, raw: 0, missing: true, text: '无成交数据' };
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  const bp = parts.reduce((s, p) => s + p.v * p.w, 0) / wsum;
  const rawBp = parts.reduce((s, p) => s + p.raw * p.w, 0) / wsum;
  const n = parts.reduce((s, p) => Math.max(s, p.n), 0);
  const score = 100 * c01(0.5 + bp * 1.6); // 净买盘 +31% 即满分
  return {
    key: 'buyPressure',
    score,
    raw: rawBp,
    n,
    text: `净买盘 ${(rawBp * 100).toFixed(0)}%（样本 ${n} 笔）`,
  };
}

function fAccel(cur, avail, prev) {
  const pc = cur.priceChange || {};
  const A = avail || { m5: true, h1: true };
  const m5 = num(pc.m5);
  let excess;
  let src;
  if (A.h1) {
    excess = m5 - num(pc.h1) / 12;
    src = 'h1';
  } else if (prev && prev.priceUsd > 0 && cur._dtSec > 30 && cur.priceUsd > 0) {
    // 长窗口不可用（新池）：用快照真实价差换算成 5 分钟速率
    const pct = ((cur.priceUsd - prev.priceUsd) / prev.priceUsd) * 100;
    excess = (pct / cur._dtSec) * 300;
    src = 'delta';
  } else {
    return { key: 'accel', score: 50, raw: 0, src: 'na', text: '加速待观察（需下一轮快照）' };
  }
  let score = 100 * c01(0.5 + excess / 8);
  if (m5 < 0) score = Math.min(score, 45);
  return { key: 'accel', score, raw: excess, src, text: `超额动能 ${excess >= 0 ? '+' : ''}${excess.toFixed(2)}%` };
}

function fResonance(cur, avail) {
  const pc = cur.priceChange || {};
  const A = avail || { m5: true, h1: true, h6: true, h24: true };
  const spec = [
    ['m5', 0.35, 5],
    ['h1', 0.3, 12],
    ['h6', 0.2, 30],
    ['h24', 0.15, 60],
  ].filter(([k]) => A[k]);
  const wsum = spec.reduce((s, [, w]) => s + w, 0) || 1;
  const r = spec.reduce((s, [k, w, scale]) => s + (w / wsum) * Math.tanh(num(pc[k]) / scale), 0);
  const up = spec.filter(([k]) => num(pc[k]) > 0).length;
  const score = 100 * c01(0.5 + r * 0.5);
  return {
    key: 'resonance',
    score,
    raw: r,
    up,
    total: spec.length,
    text: `${up}/${spec.length} 周期同向${spec.length < 4 ? '（部分窗口未成熟）' : ''}`,
  };
}

function fLiquidity(cur) {
  const L = num(cur.liquidityUsd);
  const mcap = num(cur.fdv);
  const base = c01(lg(Math.max(L, 1000) / 1000) / lg(600)); // 60 万美金深度 ≈ 满分
  const ratio = mcap > 0 ? L / mcap : 0;
  const ratioAdj = ratio >= 0.15 ? 0.1 : ratio >= 0.06 ? 0.02 : ratio >= 0.03 ? -0.06 : -0.16;
  const score = clamp(100 * c01(base + ratioAdj), 0, 100);
  return { key: 'liquidity', score, raw: L, ratio, text: `深度/市值 ${(ratio * 100).toFixed(1)}%` };
}

function fHeadroom(cur) {
  const m = num(cur.fdv) || num(cur.marketCap);
  let score;
  if (m < 50e3) score = 25;
  else if (m < 200e3) score = 45;
  else if (m < 2e6) score = 100;
  else if (m < 20e6) score = 85;
  else if (m < 100e6) score = 55;
  else if (m < 500e6) score = 30;
  else score = 15;
  return { key: 'headroom', score, raw: m, text: `市值 ${fmtUsd(m)}` };
}

function fFreshness(cur, now) {
  const t = cur.pairCreatedAt;
  if (!t) return { key: 'freshness', score: 55, raw: null, missing: true, text: '池子时间未知' };
  const min = (now - t) / 60000;
  let score;
  if (min < 5) score = 40;
  else if (min < 60) score = 75;
  else if (min < 1440) score = 100;
  else if (min < 10080) score = 85;
  else if (min < 43200) score = 65;
  else score = 45;
  return { key: 'freshness', score, raw: min, text: `池龄 ${fmtAge(min)}` };
}

function fSocial(cur) {
  let s = 0;
  const soc = (cur.socials || []).length;
  if (soc > 0) s += 25;
  if (soc > 1) s += 10;
  if ((cur.websites || []).length) s += 15;
  if (cur.boosted) s += 20;
  if (cur.hasProfile) s += 15;
  if (cur.headerImage) s += 15;
  const score = clamp(s, 0, 100);
  return { key: 'social', score, raw: s, text: `社交热度 ${score}` };
}

// ---------------------------------------------------------------- 风险扣分
function riskPenalty(cur, factors, now, avail) {
  const L = num(cur.liquidityUsd);
  const pc = cur.priceChange || {};
  const v24 = num((cur.volume || {}).h24);
  const bp = (factors.buyPressure && factors.buyPressure.raw) || 0;
  const A = avail || { h24: true };
  const items = [];
  const add = (n, key, text) => items.push({ n, key, text });

  if (L < 15e3) add(22, 'thinLiq', '深度 < $15K，随时抽池');
  else if (L < 50e3) add(9, 'lowLiq', '深度偏薄');

  if (v24 < 20e3) add(15, 'dead', '24h 成交 < $20K，无人接盘');

  const h24 = A.h24 ? num(pc.h24) : 0;
  if (h24 > 300) add(12, 'chase', `已拉升 +${h24.toFixed(0)}%，追高风险`);
  else if (h24 > 120) add(7, 'chase', `24h 已 +${h24.toFixed(0)}%，注意回撤`);
  if (h24 > 60 && num(pc.m5) < 0) add(5, 'rollover', '高位掉头');

  if (bp < -0.25) add(8, 'sellwall', '卖盘压制');

  const min = cur.pairCreatedAt ? (now - cur.pairCreatedAt) / 60000 : 1e9;
  if (min < 10 && L < 25e3) add(12, 'rugRisk', '新池 < 10 分钟且深度低');
  if (num(cur.fdv) && num(cur.fdv) < 50e3) add(6, 'microCap', '市值过小');
  const n = (factors.buyPressure && factors.buyPressure.n) || 0;
  if (n > 0 && n < 12) add(6, 'thinSample', `成交样本过少（${n} 笔）`);

  const total = clamp(items.reduce((s, i) => s + i.n, 0), 0, 60);
  return { total, items };
}

// ---------------------------------------------------------------- 置信度
function confidence(cur, factors, now, avail) {
  const missing = [];
  const A = avail || {};
  let c = 100;
  if (!cur.hasHistory) { c -= 25; missing.push('首次扫描（无历史快照，量能因子用近似值）'); }
  if (!cur.pairCreatedAt) { c -= 10; missing.push('池子创建时间未知'); }
  if (factors.buyPressure.missing) { c -= 15; missing.push('无成交笔数数据'); }
  if (!num(cur.liquidityUsd)) { c -= 20; missing.push('无流动性数据'); }
  const min = cur.pairCreatedAt ? (now - cur.pairCreatedAt) / 60000 : 1e9;
  if (min < 15) { c -= 20; missing.push('池龄 < 15 分钟，统计窗口退化'); }
  const naWin = ['h1', 'h6', 'h24'].filter((k) => A[k] === false);
  if (naWin.length) { c -= 6 * naWin.length; missing.push(`窗口未成熟：${naWin.join('/')}`); }
  if (!(cur.socials || []).length && !cur.websites) { c -= 8; missing.push('无社交/官网信息'); }
  if (cur.stale) { c -= 25; missing.push('行情数据陈旧'); }
  return { value: clamp(c, 0, 100), missing };
}

// ---------------------------------------------------------------- 主入口
const GRADES = [
  { min: 80, key: 'dragon', label: '真龙' },
  { min: 70, key: 'candidate', label: '龙头候选' },
  { min: 60, key: 'latent', label: '潜龙' },
  { min: 45, key: 'watch', label: '观察' },
  { min: -999, key: 'trash', label: '假龙' },
];

function scoreToken(cur, prev, now = Date.now()) {
  cur = cur || {};
  const { avail, ageMin, degenerate } = windowAvailability(cur, now);
  const f = {
    volBurst: fVolBurst(cur, prev),
    buyPressure: fBuyPressure(cur, avail),
    accel: fAccel(cur, avail, prev),
    resonance: fResonance(cur, avail),
    liquidity: fLiquidity(cur),
    headroom: fHeadroom(cur),
    freshness: fFreshness(cur, now),
    social: fSocial(cur),
  };

  let raw = 0;
  for (const k of Object.keys(WEIGHTS)) raw += f[k].score * WEIGHTS[k];

  const risk = riskPenalty(cur, f, now, avail);
  const conf = confidence(cur, f, now, avail);

  // 风险只在方向分上打折，不直接改写方向
  const riskAdj = 1 - risk.total / 100;
  const score = clamp(Math.round(raw * riskAdj), 0, 100);

  const grade = GRADES.find((g) => score >= g.min);

  const tags = [];
  const vb = f.volBurst, bp = f.buyPressure, ac = f.accel, rs = f.resonance;
  if (vb.raw >= 3) tags.push(`量能爆发 ${vb.raw.toFixed(1)}x`);
  else if (vb.raw >= 1.5) tags.push(`量能放大 ${vb.raw.toFixed(1)}x`);
  if (bp.raw >= 0.3 && (bp.n || 0) >= 12) tags.push(`买盘强势 ${(bp.raw * 100).toFixed(0)}%`);
  if (ac.raw >= 2) tags.push('正在加速');
  if (ac.raw <= -2) tags.push('动能转弱');
  if (rs.up === rs.total && rs.total >= 3) tags.push(`${rs.total}周期共振`);
  if (rs.total >= 3 && rs.up <= 1) tags.push('周期背离');
  if (f.liquidity.ratio >= 0.15) tags.push('深度厚实');
  else if (num(cur.liquidityUsd) < 50e3) tags.push('深度偏薄');
  if (f.headroom.score >= 85 && num(cur.fdv) < 20e6) tags.push('空间充足');
  if (f.headroom.score <= 30) tags.push('市值已高');
  if (ageMin != null && ageMin < 1440) tags.push(`新池 ${fmtAge(ageMin)}`);
  if (degenerate) tags.push('统计窗口未成熟');
  if (cur.boosted) tags.push('官方推广');
  for (const r of risk.items.slice(0, 2)) tags.push(r.text);

  return {
    score,
    rawScore: Math.round(raw),
    grade: grade.key,
    gradeLabel: grade.label,
    confidence: Math.round(conf.value),
    risk: risk.total,
    riskItems: risk.items,
    missing: conf.missing,
    windowAvail: avail,
    ageMin: ageMin == null ? null : Math.round(ageMin),
    tags,
    factors: f,
    factorList: Object.keys(WEIGHTS).map((k) => ({
      key: k,
      weight: WEIGHTS[k],
      score: Math.round(f[k].score),
      text: f[k].text,
    })),
  };
}

function fmtUsd(v) {
  v = num(v);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtAge(min) {
  if (min < 60) return `${Math.max(0, Math.round(min))}分钟`;
  if (min < 1440) return `${Math.round(min / 60)}小时`;
  return `${(min / 1440).toFixed(1)}天`;
}

  return {
    scoreToken,
    WEIGHTS,
    GRADES,
    fmtUsd,
    fmtAge,
    windowAvailability,
    // 导出的因子函数便于单测与回测
    fVolBurst,
    fBuyPressure,
    fAccel,
    fResonance,
    fLiquidity,
    fHeadroom,
    fFreshness,
    fSocial,
    riskPenalty,
    confidence,
  };
});
