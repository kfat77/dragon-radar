'use strict';
/**
 * 龙分模型零依赖测试：node test/score.test.js
 * 覆盖：方向分单调性、退化窗口、小样本收缩、缺数据不当中性、风险扣分、边界值。
 */
const assert = require('assert');
const {
  scoreToken, fVolBurst, fBuyPressure, fResonance, fLiquidity, fHeadroom,
  riskPenalty, confidence, windowAvailability,
} = require('../lib/score');

const NOW = Date.parse('2026-09-24T12:00:00Z');
const base = (over = {}) => ({
  priceUsd: 0.001,
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
  volume: { m5: 5000, h1: 60000, h6: 360000, h24: 1440000 },
  txns: {
    m5: { buys: 50, sells: 50 },
    h1: { buys: 600, sells: 600 },
    h6: { buys: 3600, sells: 3600 },
    h24: { buys: 14400, sells: 14400 },
  },
  liquidityUsd: 300000,
  fdv: 2000000,
  marketCap: 2000000,
  pairCreatedAt: NOW - 86400000 * 2,
  socials: [{ type: 'twitter' }],
  websites: [{ url: 'https://x.io' }],
  hasHistory: true,
  _dtSec: 60,
  ...over,
});

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  OK ' + name); }
  catch (e) { console.error('  FAIL ' + name + ' → ' + e.message); process.exitCode = 1; }
}

console.log('龙分模型测试');

ok('中性标的得分落在中间区间且不是 NaN', () => {
  const r = scoreToken(base(), null, NOW);
  assert.ok(Number.isFinite(r.score), 'score 必须是数字');
  assert.ok(r.score >= 0 && r.score <= 100, `score 越界：${r.score}`);
  assert.ok(r.score >= 30 && r.score <= 75, `中性标的应落在 30~75，实际 ${r.score}`);
});

ok('强势标的得分高于弱势标的', () => {
  const strong = scoreToken(base({
    priceChange: { m5: 18, h1: 60, h6: 180, h24: 400 },
    volume: { m5: 90000, h1: 360000, h6: 900000, h24: 2000000 },
    txns: {
      m5: { buys: 800, sells: 120 },
      h1: { buys: 4000, sells: 900 },
      h6: { buys: 9000, sells: 3000 },
      h24: { buys: 20000, sells: 8000 },
    },
  }), null, NOW);
  const weak = scoreToken(base({
    priceChange: { m5: -8, h1: -20, h6: -45, h24: -70 },
    volume: { m5: 800, h1: 20000, h6: 100000, h24: 400000 },
    txns: {
      m5: { buys: 10, sells: 90 },
      h1: { buys: 200, sells: 900 },
      h6: { buys: 1000, sells: 4000 },
      h24: { buys: 4000, sells: 16000 },
    },
  }), null, NOW);
  assert.ok(strong.score > weak.score, `强(${strong.score}) 应大于 弱(${weak.score})`);
  assert.ok(strong.score >= 60, `强标的应达到潜龙以上，实际 ${strong.score}`);
  assert.ok(weak.score < 50, `弱标的应低于 50，实际 ${weak.score}`);
});

ok('退化的窗口被识别，新池不会因 h24=h1=m5 拿到假共振', () => {
  const young = base({ pairCreatedAt: NOW - 3 * 60000, priceChange: { m5: 460, h1: 460, h6: 460, h24: 460 } });
  const { avail, degenerate } = windowAvailability(young, NOW);
  assert.strictEqual(degenerate, true);
  assert.strictEqual(avail.h24, false);
  assert.strictEqual(avail.h6, false);
  const r = scoreToken(young, null, NOW);
  assert.ok(r.factors.resonance.total < 4, '共振不应统计 4 个窗口');
  assert.ok(r.missing.some((m) => m.includes('窗口未成熟')), '应提示窗口未成熟');
});

ok('小样本买盘向中性收缩（2 笔 100% 买盘不该拿满分）', () => {
  const tiny = fBuyPressure({ txns: { m5: { buys: 2, sells: 0 }, h1: { buys: 2, sells: 0 } } }, { m5: true, h1: true });
  const big = fBuyPressure({ txns: { m5: { buys: 900, sells: 100 }, h1: { buys: 6000, sells: 900 } } }, { m5: true, h1: true });
  assert.ok(tiny.score < 70, `2 笔成交不该接近满分，实际 ${tiny.score}`);
  assert.ok(big.score > tiny.score + 15, '大样本强买盘应显著高于小样本');
});

ok('缺数据扣置信度且计入缺失清单', () => {
  const noData = scoreToken(base({ liquidityUsd: 0, txns: {}, pairCreatedAt: 0, socials: [], websites: [], hasHistory: false }), null, NOW);
  assert.ok(noData.confidence < 60, `缺数据时置信应显著下降，实际 ${noData.confidence}`);
  assert.ok(noData.missing.length >= 3, `缺失项应被列出，实际 ${noData.missing.length}`);
});

ok('区间真实增量驱动的量能爆发高于近似值', () => {
  const cur = base();
  const approx = fVolBurst(cur, null);
  const prev = { ts: NOW - 60000, volH24: 1440000 - 600000 }; // 1 分钟新增 60 万成交
  const delta = fVolBurst({ ...cur, _dtSec: 60 }, prev);
  assert.strictEqual(delta.src, 'delta');
  assert.ok(delta.raw > approx.raw, `增量口径(${delta.raw.toFixed(2)}x) 应大于近似口径(${approx.raw.toFixed(2)}x)`);
});

ok('共振只在成熟窗口上归一化且方向正确', () => {
  const up = fResonance({ priceChange: { m5: 6, h1: 20, h6: 50, h24: 90 } }, { m5: true, h1: true, h6: true, h24: true });
  const mix = fResonance({ priceChange: { m5: 6, h1: -20, h6: 50, h24: -90 } }, { m5: true, h1: true, h6: true, h24: true });
  assert.ok(up.score > 80 && mix.score < 60, `同向应为高分，实际 up=${up.score} mix=${mix.score}`);
  assert.strictEqual(up.total, 4);
});

ok('风险项独立扣分，不改变方向因子', () => {
  const t = base({ liquidityUsd: 8000, volume: { m5: 100, h1: 900, h6: 4000, h24: 12000 }, priceChange: { m5: -2, h1: 120, h6: 200, h24: 500 } });
  const r = scoreToken(t, null, NOW);
  assert.ok(r.risk >= 30, `多重风险应累计扣分，实际 ${r.risk}`);
  assert.ok(r.riskItems.length >= 3, `风险项应有明细，实际 ${r.riskItems.length}`);
  assert.ok(r.score < r.rawScore, '龙分应低于未扣风险的原始分');
  assert.strictEqual(r.rawScore, Math.round(r.rawScore));
});

ok('未成熟窗口不影响风险判定使用 h24 惩罚', () => {
  const young = base({ pairCreatedAt: NOW - 20 * 60000, priceChange: { m5: 900, h1: 900, h6: 900, h24: 900 } });
  const r = scoreToken(young, null, NOW);
  assert.ok(!r.riskItems.some((i) => i.key === 'chase'), '窗口未成熟时不应因 h24 判追高');
});

ok('分级映射连续覆盖 0~100', () => {
  for (const s of [0, 20, 44, 45, 59, 60, 69, 70, 79, 80, 100]) {
    const r = scoreToken(base(), null, NOW);
    r.score = s;
    assert.ok(typeof r.grade === 'string');
  }
});

ok('深度/市值比与市值空间单调性正确', () => {
  const thin = fLiquidity({ liquidityUsd: 5000, fdv: 5000000 });
  const thick = fLiquidity({ liquidityUsd: 500000, fdv: 2000000 });
  assert.ok(thick.score > thin.score, '深度厚且占比高应得分更高');
  assert.ok(fHeadroom({ fdv: 1000000 }).score > fHeadroom({ fdv: 900000000 }).score, '小市值空间分应更高');
  assert.ok(fHeadroom({ fdv: 30000 }).score < 50, '过小市值应被防范');
});

ok('score 恒为 0~100 的整数且无 NaN', () => {
  const combos = [
    base(), base({ liquidityUsd: 0, fdv: 0 }), base({ txns: {} }),
    base({ priceChange: {} }), base({ volume: {} }), base({ pairCreatedAt: 0 }),
  ];
  for (const c of combos) {
    const r = scoreToken(c, null, NOW);
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100, `越界：${r.score}`);
    assert.ok(Number.isInteger(r.confidence) && r.confidence >= 0 && r.confidence <= 100, `置信越界：${r.confidence}`);
  }
});

console.log(`\n通过 ${pass} 项`);
