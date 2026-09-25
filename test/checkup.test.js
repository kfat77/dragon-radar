'use strict';
/**
 * 四维体检模型零依赖测试：node test/checkup.test.js
 *
 * 覆盖四件事，每一件都对着「会让人亏钱的误判」写：
 *   安全 —— 硬红线是否一票否决；所有权已放弃时 owner 类风险是否正确降级（否则会把
 *           PEPE 这种成熟标的判死）；仿盘与「自己就是龙头」是否分得清。
 *   叙事 —— 五个阶段（萌芽 / 传播 / 常态 / 高潮 / 退潮）的判定与方向性。
 *   筹码 —— 集中度是否剔除池子 / 销毁 / 锁仓地址；「集中度 × 退出通道」是否真的
 *           比单看集中度更准（大市值高集中不该判死，人少且池子是唯一出口才该判死）。
 *   位置 —— 仓位是否由风险预算倒推、是否取三者最小值、是否按阶段调整止损距离。
 *
 * 全部是纯函数，不联网、不读存储，可在 CI 里零依赖运行。
 */
const assert = require('assert');
const {
  runCheckup, safetyDimension, narrativeDimension, chipsDimension, positionDimension,
  DEFAULT_PROFILE, STAGE_STOP,
} = require('../lib/checkup');

const NOW = Date.parse('2026-09-25T12:00:00Z');
const BURN_DEAD = '0x000000000000000000000000000000000000dead';
const PAIR = '0xpair';

// ---------------------------------------------------------------- 夹具
function tok(over = {}) {
  return Object.assign({
    chainId: 'ethereum', tokenAddress: '0xtoken', pairAddress: PAIR,
    symbol: 'TEST', name: 'Test Token',
    priceUsd: 0.001,
    fdv: 1e6, marketCap: 1e6, liquidityUsd: 200000,
    priceChange: { m5: 0, h1: 5, h6: 20, h24: 40 },
    volume: { m5: 5000, h1: 60000, h6: 360000, h24: 1440000 },
    txns: {
      m5: { buys: 50, sells: 50 },
      h1: { buys: 600, sells: 600 },
      h6: { buys: 3600, sells: 3600 },
      h24: { buys: 14400, sells: 14400 },
    },
    pairCreatedAt: NOW - 86400000 * 3,
    socials: [{ type: 'twitter' }],
    websites: [{ url: 'https://test.io' }],
  }, over);
}

// 干净的合约：任何一项都不触发硬红线，用来做「只改一个变量」的对照底稿。
// ownerRenounced 与 normalizeGoplus 保持一致：由 owner_address 是否为黑洞地址推出，
// 不允许单独传参——否则测试可以造出「owner 打到黑洞但 ownerRenounced=false」这种
// 现实中不存在的组合，从而验不出真正的降级逻辑。
const BURN_SET = { '0x0000000000000000000000000000000000000000': 1, '0x000000000000000000000000000000000000dead': 1, '0x0000000000000000000000000000000000000001': 1 };
function cleanContract(over = {}) {
  const base = Object.assign({
    source: 'goplus',
    openSource: true, proxy: false, mintable: false, freezable: false, closable: false,
    metadataMutable: false, balanceMutableAuth: false, transferHook: false, nonTransferable: false,
    transferFeePct: 0, trusted: false,
    canTakeBackOwnership: false, ownerChangeBalance: false, hiddenOwner: false, selfDestruct: false,
    transferPausable: false, slippageModifiable: false, tradingCooldown: false,
    blacklistable: false, antiWhale: false,
    honeypot: false, buyTax: 0, sellTax: 0, cannotSellAll: false, cannotBuy: false,
    sameCreatorHoneypot: 0,
    creatorPct: 0, ownerPct: 0,
    ownerAddress: '0xowner', creatorAddress: '0xcreator',
    holderCount: 5000, top10Pct: 22, top1Pct: 5, lpLockedPct: 85, lpHolderCount: 3,
    isInCex: false, dexCount: 1,
    topHolders: [
      { address: '0xh1', pct: 6 }, { address: '0xh2', pct: 4 }, { address: '0xh3', pct: 3 },
      { address: '0xh4', pct: 2.5 }, { address: '0xh5', pct: 2 }, { address: '0xh6', pct: 1.8 },
      { address: '0xh7', pct: 1.5 }, { address: '0xh8', pct: 1.2 },
    ],
  }, over);
  base.ownerRenounced = !!BURN_SET[String(base.ownerAddress || '').toLowerCase()];
  return base;
}

function sec(over = {}) {
  const c = cleanContract(over.contract || {});
  c.holders = Object.assign({
    count: c.holderCount, top10Pct: c.top10Pct, top1Pct: c.top1Pct,
    lpLockedPct: c.lpLockedPct, lpHolderCount: c.lpHolderCount,
    creatorPct: c.creatorPct, ownerPct: c.ownerPct,
  }, over.holders || {});
  return Object.assign({
    ok: true, chainId: 'ethereum', tokenAddress: '0xtoken', pairAddress: PAIR,
    isSolana: false, at: NOW, sources: ['goplus'], contract: c,
    rug: null, rugFull: null, honeypot: null,
    copycat: { checked: true, isCopycat: false, selfIsLeader: false, crowded: false, ratio: 1, tokenCount: 1 },
    penalties: [], gaps: [],
  }, over, { contract: c });
}

const NO_DATA = { ok: false, chainId: 'ethereum', tokenAddress: '0xtoken', pairAddress: '', sources: [], contract: null, rug: null, copycat: null, gaps: ['GoPlus 未收录'], penalties: [] };

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  OK ' + name); }
  catch (e) { console.error('  FAIL ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

// ================================================================ 安全
console.log('四维体检 · 安全维度');

ok('蜜罐一票否决：分数清零、不等权加权、结论直接放弃', () => {
  const r = runCheckup(tok(), sec({ contract: { honeypot: true } }), null);
  assert.strictEqual(r.safety.level, 'block', 'level 应为 block');
  assert.strictEqual(r.safety.score, 0, '命中硬红线分数必须归零');
  assert.ok(r.safety.hard.length >= 1, '必须给出硬红线理由');
  assert.strictEqual(r.verdict.key, 'pass', '结论应为直接放弃');
});

ok('所有权已放弃时 owner 类风险降级，不再扣分（否则会把成熟标的判死）', () => {
  const r = runCheckup(tok(), sec({
    contract: {
      mintable: true, ownerChangeBalance: true, transferPausable: true,
      slippageModifiable: true, canTakeBackOwnership: true,
      ownerAddress: BURN_DEAD,
    },
  }), null);
  assert.strictEqual(r.safety.hard.length, 0, '所有权已放弃不该出现硬红线');
  assert.strictEqual(r.safety.score, 100, 'owner 类风险不可触发时不该扣分，实际 ' + r.safety.score);
  assert.ok(r.safety.notes.some((x) => /不可触发/.test(x)), '应在 notes 里标注风险实际不可触发');
  assert.strictEqual(r.safety.warn.length, 0, '不该有任何 owner 相关扣分项');
});

ok('同样的函数、所有权没放弃：改为逐条扣分且分数归零', () => {
  const r = runCheckup(tok(), sec({
    contract: {
      mintable: true, transferPausable: true, slippageModifiable: true,
      canTakeBackOwnership: true, hiddenOwner: true,
    },
  }), null);
  assert.strictEqual(r.safety.hard.length, 0, '这些是扣分项，不是硬红线');
  assert.ok(r.safety.score <= 5, 'owner 权限仍在时应重扣，实际 ' + r.safety.score);
  assert.ok(r.safety.warn.length >= 4, '应逐条给出扣分项，实际 ' + r.safety.warn.length);
  assert.strictEqual(r.verdict.key, 'pass', '安全分低于 50 必须直接放弃');
});

ok('owner 可任意修改持币余额且未放弃所有权：这是硬红线', () => {
  const r = runCheckup(tok(), sec({ contract: { ownerChangeBalance: true } }), null);
  assert.strictEqual(r.safety.level, 'block');
  assert.ok(r.safety.hard.some((x) => /修改持币余额/.test(x)));
});

ok('未开源且是代理合约：逻辑可随时被替换，属硬红线', () => {
  const r = runCheckup(tok(), sec({ contract: { openSource: false, proxy: true } }), null);
  assert.strictEqual(r.safety.level, 'block');
  assert.ok(r.safety.hard.some((x) => /未开源且是代理/.test(x)));
});

ok('只未开源（非代理）：扣分但不一票否决', () => {
  const r = runCheckup(tok(), sec({ contract: { openSource: false } }), null);
  assert.strictEqual(r.safety.hard.length, 0);
  assert.strictEqual(r.safety.score, 75, '−25 后应为 75，实际 ' + r.safety.score);
  assert.strictEqual(r.safety.level, 'low');
});

ok('只是代理合约但已开源：扣分但不一票否决', () => {
  const r = runCheckup(tok(), sec({ contract: { proxy: true } }), null);
  assert.strictEqual(r.safety.hard.length, 0);
  assert.strictEqual(r.safety.score, 80, '−20 后应为 80，实际 ' + r.safety.score);
});

ok('LP 只由少数地址持有且锁定不足、持币极少：可随时撤池，属硬红线', () => {
  const r = runCheckup(tok(), sec({
    contract: { lpHolderCount: 2, lpLockedPct: 10, holderCount: 800 },
  }), null);
  assert.strictEqual(r.safety.level, 'block');
  assert.ok(r.safety.hard.some((x) => /撤池/.test(x)));
});

ok('同样 LP 锁定不足但持币上万：不再构成硬红线，只扣分', () => {
  const r = runCheckup(tok(), sec({
    contract: { lpHolderCount: 2, lpLockedPct: 10, holderCount: 20000 },
  }), null);
  assert.strictEqual(r.safety.hard.length, 0, '持币上万时 LP 早已不是唯一出口');
  assert.ok(r.safety.score < 100);
});

ok('模拟判定为蜜罐的卖出税超 10% 属硬红线', () => {
  const r = runCheckup(tok(), sec({ contract: { sellTax: 18 } }), null);
  assert.strictEqual(r.safety.level, 'block');
  assert.ok(r.safety.hard.some((x) => /卖出税/.test(x)));
});

ok('创建者有蜜罐前科属硬红线', () => {
  const r = runCheckup(tok(), sec({ contract: { sameCreatorHoneypot: 2 } }), null);
  assert.strictEqual(r.safety.level, 'block');
});

ok('同符号仿盘属硬红线，且把倍数写清楚', () => {
  const r = runCheckup(tok(), sec({
    copycat: { checked: true, isCopycat: true, selfIsLeader: false, ratio: 15454.2, leader: { symbol: 'PEPE', fdv: 5e9 } },
  }), null);
  assert.strictEqual(r.safety.level, 'block');
  assert.ok(r.safety.hard.some((x) => /仿盘/.test(x)), '必须点名仿盘');
});

ok('自己就是同符号最大体量的那个：不算仿盘', () => {
  const r = runCheckup(tok(), sec({
    copycat: { checked: true, isCopycat: false, selfIsLeader: true, ratio: 1, crowded: false, tokenCount: 30 },
  }), null);
  assert.strictEqual(r.safety.hard.length, 0, '龙头自己不该被自己的符号判成仿盘');
  assert.strictEqual(r.safety.score, 100);
});

ok('符号被大量仿制：扣分但不判死', () => {
  const r = runCheckup(tok(), sec({
    copycat: { checked: true, isCopycat: false, selfIsLeader: false, crowded: true, ratio: 6.5, tokenCount: 42 },
  }), null);
  assert.strictEqual(r.safety.hard.length, 0);
  assert.strictEqual(r.safety.score, 82, '−6 −12 后应为 82，实际 ' + r.safety.score);
});

ok('拿不到任何合约数据：按最高风险对待，不给中性分，结论数据不足', () => {
  const r = runCheckup(tok(), NO_DATA, null);
  assert.strictEqual(r.safety.level, 'unknown');
  assert.strictEqual(r.safety.score, 0, '缺数据不能给中性分');
  assert.strictEqual(r.verdict.key, 'nodata');
  assert.strictEqual(r.position.sizeUsd, 0, '缺数据不给仓位');
  assert.ok(r.position.disqualified.some((x) => /安全数据缺失/.test(x)));
});

// ================================================================ 叙事
console.log('四维体检 · 叙事维度');

ok('萌芽期：池龄短、参与度猛放、市值还小', () => {
  const n = narrativeDimension(tok({
    pairCreatedAt: NOW - 2 * 3600000, fdv: 900000, marketCap: 900000,
    txns: { m5: { buys: 200, sells: 150 }, h1: { buys: 2800, sells: 2000 }, h6: { buys: 4000, sells: 3000 }, h24: { buys: 6000, sells: 5000 } },
  }), null, sec());
  assert.strictEqual(n.stage, 'seed', '实际 ' + n.stage);
  assert.strictEqual(n.stageLabel, '萌芽期');
});

ok('传播期：参与度在放大且价格尚未走完', () => {
  const n = narrativeDimension(tok({
    priceChange: { m5: 3, h1: 12, h6: 30, h24: 60 },
    txns: { m5: { buys: 200, sells: 120 }, h1: { buys: 1400, sells: 1000 }, h6: { buys: 3000, sells: 2000 }, h24: { buys: 15000, sells: 13500 } },
  }), null, sec());
  assert.strictEqual(n.stage, 'spread', '实际 ' + n.stage);
});

ok('高潮期：价格已走完大部分、参与度开始衰减', () => {
  const n = narrativeDimension(tok({
    priceChange: { m5: 1, h1: 5, h6: 60, h24: 180 },
    txns: { m5: { buys: 40, sells: 60 }, h1: { buys: 600, sells: 600 }, h6: { buys: 3000, sells: 2000 }, h24: { buys: 15000, sells: 13500 } },
  }), null, sec());
  assert.strictEqual(n.stage, 'peak', '实际 ' + n.stage);
});

ok('退潮期：价格与参与度同时退', () => {
  const n = narrativeDimension(tok({
    priceChange: { m5: -6, h1: -28, h6: -40, h24: -55 },
    txns: { m5: { buys: 5, sells: 10 }, h1: { buys: 120, sells: 180 }, h6: { buys: 3000, sells: 3000 }, h24: { buys: 15000, sells: 14000 } },
  }), null, sec());
  assert.strictEqual(n.stage, 'ebb', '实际 ' + n.stage);
  assert.ok(n.notes.some((x) => /在退|峰值/.test(x)), '应点明已在退潮：' + JSON.stringify(n.notes));
  const r = runCheckup(tok({
    priceChange: { m5: -6, h1: -28, h6: -40, h24: -55 },
    txns: { m5: { buys: 5, sells: 10 }, h1: { buys: 120, sells: 180 }, h6: { buys: 3000, sells: 3000 }, h24: { buys: 15000, sells: 14000 } },
  }), sec(), null);
  assert.strictEqual(r.verdict.key, 'pass', '退潮期即使合约干净也应直接放弃');
});

ok('持币地址增长必须被奖励：增长 30% 的得分高于减少 30%（方向性回归）', () => {
  const base = { txns: { m5: { buys: 50, sells: 50 }, h1: { buys: 600, sells: 600 }, h6: { buys: 3600, sells: 3600 }, h24: { buys: 14400, sells: 14400 } } };
  const grow = narrativeDimension(tok(base), { holderCount: 3846, at: NOW - 3600000 }, sec({ contract: { holderCount: 5000 } }));
  const shrink = narrativeDimension(tok(base), { holderCount: 7143, at: NOW - 3600000 }, sec({ contract: { holderCount: 5000 } }));
  assert.ok(grow.holderGrowthPct > 0, '增长场景的增量应为正，实际 ' + grow.holderGrowthPct);
  assert.ok(shrink.holderGrowthPct < 0, '减少场景的增量应为负，实际 ' + shrink.holderGrowthPct);
  assert.ok(grow.score > shrink.score,
    '持币地址增长必须比减少得分高：增长 ' + grow.score + ' vs 减少 ' + shrink.score);
});

ok('没有任何传播载体的标的会明显扣分并被点名', () => {
  const withAll = narrativeDimension(tok(), null, sec());
  const bare = narrativeDimension(tok({ socials: [], websites: [], boosted: false, hasProfile: false }), null, sec({ contract: { holderCount: 300 } }));
  assert.ok(withAll.score > bare.score, '无载体的分数必须更低');
  assert.ok(bare.notes.some((x) => /传不出去/.test(x)));
});

ok('量价背离会被识别并扣分', () => {
  const n = narrativeDimension(tok({
    priceChange: { m5: 1, h1: 8, h6: 40, h24: 120 },
    txns: { m5: { buys: 20, sells: 20 }, h1: { buys: 300, sells: 300 }, h6: { buys: 3000, sells: 3000 }, h24: { buys: 15000, sells: 13500 } },
  }), null, sec());
  assert.strictEqual(n.divergence, true, '应识别为背离');
});

// ================================================================ 筹码
console.log('四维体检 · 筹码维度');

ok('集中度重算：剔除池子储备与销毁地址，否则每个新池都会虚高', () => {
  const withNoise = {
    address: PAIR, pct: 42,
  };
  const c = chipsDimension(sec({
    contract: {
      topHolders: [
        withNoise,
        { address: BURN_DEAD, pct: 12 },
        { address: '0xa', pct: 4 }, { address: '0xb', pct: 3.5 }, { address: '0xc', pct: 3 },
        { address: '0xd', pct: 2.5 }, { address: '0xe', pct: 2 },
      ],
      top10Pct: 74, // GoPlus 原始值：把池子和销毁量都算进去了
    },
  }), tok());
  assert.strictEqual(c.concSource, '剔除池子/销毁/锁仓后重算');
  assert.strictEqual(c.top10Pct, 15, '剔除后应为 4+3.5+3+2.5+2 = 15，实际 ' + c.top10Pct);
  assert.strictEqual(c.excludedHolders.length, 2, '应记录被剔除的两个地址');
  assert.ok(c.excludedHolders.some((x) => x.why === '流动性池储备'));
  assert.ok(c.excludedHolders.some((x) => x.why === '已销毁'));
});

ok('已锁仓地址同样剔除', () => {
  const c = chipsDimension(sec({
    contract: {
      topHolders: [
        { address: '0xl1', pct: 30, isLocked: true },
        { address: '0xa', pct: 5 }, { address: '0xb', pct: 4 }, { address: '0xc', pct: 3 },
        { address: '0xd', pct: 2 }, { address: '0xe', pct: 1 },
      ],
    },
  }), tok());
  assert.strictEqual(c.top10Pct, 15, '锁仓的 30% 不该计入集中度，实际 ' + c.top10Pct);
  assert.ok(c.excludedHolders.some((x) => x.why === '已锁仓'));
});

ok('人少 + 池子是唯一出口 = 致命，且结论直接放弃', () => {
  const t = tok({ fdv: 1e6, marketCap: 1e6, liquidityUsd: 20000 });
  const s = sec({
    contract: {
      holderCount: 200, top10Pct: 55, lpLockedPct: 20,
      topHolders: [
        { address: '0xa', pct: 20 }, { address: '0xb', pct: 10 }, { address: '0xc', pct: 8 },
        { address: '0xd', pct: 7 }, { address: '0xe', pct: 5 }, { address: '0xf', pct: 5 },
      ],
    },
  });
  const c = chipsDimension(s, t);
  assert.strictEqual(c.level, 'critical', '实际 ' + c.level);
  assert.strictEqual(c.critical, true);
  assert.ok(c.hard.length >= 1);
  const r = runCheckup(t, s, null);
  assert.strictEqual(r.verdict.key, 'pass', '合约干净但筹码致命，结论仍应是直接放弃');
});

ok('大市值 + 高集中不判死：前排走的是 CEX 订单簿，池子深度对它没有约束力', () => {
  const t = tok({ fdv: 5e9, marketCap: 5e9, liquidityUsd: 1e7 });
  const s = sec({
    contract: {
      holderCount: 250000, top10Pct: 52, lpLockedPct: 85,
      topHolders: [
        { address: '0xa', pct: 22 }, { address: '0xb', pct: 8 }, { address: '0xc', pct: 6 },
        { address: '0xd', pct: 5 }, { address: '0xe', pct: 4 }, { address: '0xf', pct: 3 },
        { address: '0xg', pct: 2 }, { address: '0xh', pct: 2 },
      ],
    },
  });
  const c = chipsDimension(s, t);
  assert.strictEqual(c.channelLevel, 2, '持币 25 万应判定为宽通道');
  assert.strictEqual(c.hard.length, 0, '不该出现硬红线');
  assert.strictEqual(c.critical, false, '不该被判致命');
  assert.ok(c.score > 25, '仍应重扣但不归零，实际 ' + c.score);
  assert.ok(c.warn.some((x) => /前十大持有/.test(x.text)), '重扣理由要写清楚：' + JSON.stringify(c.warn));
  assert.ok(c.warn.every((x) => typeof x.text === 'string' && x.n > 0), '每条扣分都要带分数');
});

ok('DEV 自留超 10% 属致命项', () => {
  const c = chipsDimension(sec({ holders: { creatorPct: 12 } }), tok());
  assert.strictEqual(c.critical, true);
  assert.ok(c.hard.some((x) => /DEV 自留/.test(x)));
});

ok('捆绑地址网络（关联地址 ≥ 15%）属致命项', () => {
  const c = chipsDimension(sec({
    rugFull: { graphInsidersDetected: 7, insiderPct: 22, creatorTokens: 0, creatorBalance: 0, topHolders: [] },
  }), tok());
  assert.strictEqual(c.critical, true);
  assert.ok(c.hard.some((x) => /捆绑地址网络/.test(x)));
});

ok('持币地址未取得：不给通过分，也不谎称发现问题', () => {
  const s = sec({ contract: { holderCount: 0 } });
  s.contract.holders.count = 0;
  const c = chipsDimension(s, tok());
  assert.strictEqual(c.holdersUnknown, true);
  assert.strictEqual(c.level, 'unknown');
  assert.ok(c.score <= 55, '缺数据不给通过分，实际 ' + c.score);
  assert.strictEqual(c.hard.length, 0, '硬红线必须建立在证据上，不能建立在「没查到」上');
  assert.strictEqual(c.channelLabel, '未知（未取得持币地址数）');
});

// ================================================================ 位置
console.log('四维体检 · 位置维度');

ok('止损距离按阶段取值，且在输出里用百分数表示', () => {
  const dims = (stage) => ({ safety: { score: 100, level: 'low' }, chips: { score: 100, level: 'low' }, narrative: { score: 80, stage } });
  assert.strictEqual(positionDimension(tok(), dims('neutral'), {}).stopPct, Math.round(STAGE_STOP.neutral * 100));
  assert.strictEqual(positionDimension(tok(), dims('seed'), {}).stopPct, 50);
  assert.strictEqual(positionDimension(tok(), dims('spread'), {}).stopPct, 40);
  assert.strictEqual(positionDimension(tok(), dims('peak'), {}).stopPct, 30);
});

ok('仓位取「风险预算 / 流动性上限 / 单币上限」三者最小值，并标明受限于哪一项', () => {
  const dims = { safety: { score: 100, level: 'low' }, chips: { score: 100, level: 'low' }, narrative: { score: 80, stage: 'neutral' } };
  // 默认 profile：总资金 10000，单笔风险 2%（=200），单币上限 5%（=500），流动性上限 0.5%
  const a = positionDimension(tok({ liquidityUsd: 200000 }), dims, {});
  assert.strictEqual(a.riskBudgetUsd, 200);
  assert.strictEqual(a.riskSizeUsd, 444, '200 / 0.45 = 444.4');
  assert.strictEqual(a.singleCapUsd, 500);
  assert.strictEqual(a.liquidityCapUsd, 1000);
  assert.strictEqual(a.sizeCapBy, '风险预算', '实际 ' + a.sizeCapBy);

  const b = positionDimension(tok({ liquidityUsd: 2000 }), dims, {});
  assert.strictEqual(b.liquidityCapUsd, 10);
  assert.strictEqual(b.sizeCapBy, '流动性上限', '实际 ' + b.sizeCapBy);

  const c = positionDimension(tok({ liquidityUsd: 2e6 }), dims, { totalCapitalUsd: 100000, maxRiskPerTrade: 0.05 });
  assert.strictEqual(c.singleCapUsd, 5000);
  assert.strictEqual(c.sizeCapBy, '单币上限', '实际 ' + c.sizeCapBy);
});

ok('阶段系数：传播期下注最大，高潮期大幅收窄，退潮期归零', () => {
  const dims = (stage) => ({ safety: { score: 100, level: 'low' }, chips: { score: 100, level: 'low' }, narrative: { score: 80, stage } });
  const t = tok({ liquidityUsd: 1e6 });
  const neutral = positionDimension(t, dims('neutral'), {});
  const spread = positionDimension(t, dims('spread'), {});
  const seed = positionDimension(t, dims('seed'), {});
  const peak = positionDimension(t, dims('peak'), {});
  const ebb = positionDimension(t, dims('ebb'), {});
  assert.ok(spread.sizeUsd > neutral.sizeUsd, '传播期应大于常态');
  assert.ok(neutral.sizeUsd > seed.sizeUsd, '萌芽期赔率高但该下更小的注');
  assert.ok(seed.sizeUsd > peak.sizeUsd, '高潮期应大幅收窄');
  assert.strictEqual(peak.tierMult, 0.25);
  assert.strictEqual(ebb.sizeUsd, 0, '退潮期不给仓位');
  assert.strictEqual(ebb.tierMult, 0);
});

ok('四维有致命项时仓位为 0，而不是给一个「小仓位」', () => {
  const dims = { safety: { score: 100, level: 'low' }, chips: { score: 20, level: 'critical', critical: true }, narrative: { score: 90, stage: 'spread' } };
  const p = positionDimension(tok(), dims, {});
  assert.strictEqual(p.sizeUsd, 0);
  assert.ok(p.disqualified.some((x) => /筹码/.test(x)));
  assert.strictEqual(p.scales.length, 0, '不给仓位就不该给分批计划');
  assert.ok(p.exits.length >= 4, '离场条件始终要写清楚');
});

ok('仓位始终带风险口径：止损金额不超过单笔风险预算', () => {
  const dims = { safety: { score: 90, level: 'low' }, chips: { score: 80, level: 'low' }, narrative: { score: 70, stage: 'spread' } };
  const p = positionDimension(tok({ liquidityUsd: 5e5 }), dims, { totalCapitalUsd: 20000 });
  assert.ok(p.sizeUsd > 0);
  const stopLoss = (p.sizeUsd * p.stopPct) / 100;
  const budget = p.totalCapitalUsd * DEFAULT_PROFILE.maxRiskPerTrade;
  assert.ok(stopLoss <= budget * 1.05, `止损金额 ${stopLoss.toFixed(2)} 超出单笔风险预算 ${budget}`);
  assert.ok(p.sizePctOfCapital <= DEFAULT_PROFILE.maxSinglePct * 100);
});

ok('仓位随总资金线性变化：金额由服务端口径算出，不由前端猜', () => {
  const dims = { safety: { score: 100, level: 'low' }, chips: { score: 100, level: 'low' }, narrative: { score: 80, stage: 'spread' } };
  const t = tok({ liquidityUsd: 1e7 });
  const a = positionDimension(t, dims, { totalCapitalUsd: 10000 });
  const b = positionDimension(t, dims, { totalCapitalUsd: 20000 });
  assert.strictEqual(b.riskBudgetUsd, a.riskBudgetUsd * 2);
  assert.ok(Math.abs(b.sizeUsd - a.sizeUsd * 2) <= 2, `${a.sizeUsd} -> ${b.sizeUsd} 应接近两倍`);
});

// ================================================================ 编排
console.log('四维体检 · 编排与结论');

ok('综合分严格按 安全 0.40 / 筹码 0.30 / 叙事 0.30 加权', () => {
  const r = runCheckup(tok(), sec(), null);
  const expect = Math.round(r.safety.score * 0.40 + r.chips.score * 0.30 + r.narrative.score * 0.30);
  assert.strictEqual(r.composite, expect, `${r.safety.score}/${r.chips.score}/${r.narrative.score}`);
  assert.ok(r.composite >= 0 && r.composite <= 100);
});

ok('未取到市值：分档标为「未取到市值」，不能伪装成早期小盘', () => {
  const t = tok({ fdv: 0, marketCap: 0, liquidityUsd: 0 });
  const r = runCheckup(t, sec(), null);
  assert.strictEqual(r.position.mcapBand, 'unknown', '实际 ' + r.position.mcapBand);
  assert.strictEqual(r.position.marketComplete, false);
  assert.ok(r.position.disqualified.some((x) => /未取到市值与池子深度/.test(x)));
  assert.strictEqual(r.position.sizeUsd, 0, '缺行情不能倒推出仓位');
});

ok('未取到成交流水：叙事降级，不得假报「常态」', () => {
  const r = runCheckup(tok({ txns: {}, volume: {}, priceChange: {} }), sec(), null);
  assert.strictEqual(r.narrative.noMarket, true);
  assert.strictEqual(r.narrative.stageKnown, false);
  assert.strictEqual(r.narrative.stageLabel, '未知（未取到成交流水）');
  assert.ok(r.narrative.score <= 30, '缺流水不给中性分，实际 ' + r.narrative.score);
  assert.notStrictEqual(r.verdict.key, 'go');
  assert.ok(r.narrative.checks.some((x) => x.name === '成交流水数据' && x.pass === false));
});

ok('缺市值或池深时不说「砸不穿」', () => {
  const c = chipsDimension(sec(), tok({ fdv: 0, marketCap: 0, liquidityUsd: 0 }));
  assert.ok(c.notes.some((x) => /抛压比无法计算/.test(x)), JSON.stringify(c.notes));
  assert.ok(!c.notes.some((x) => /砸不穿/.test(x)), '缺数据时绝不能给「砸不穿」这种结论');
});

ok('四个维度都在，且结论句直接回答四问', () => {
  const r = runCheckup(tok(), sec(), null);
  for (const k of ['safety', 'narrative', 'chips', 'position']) {
    assert.ok(r[k], '缺少维度 ' + k);
  }
  assert.ok(Array.isArray(r.answers.safety));
  assert.ok(typeof r.answers.narrative.stage === 'string');
  assert.ok(typeof r.answers.chips.holderCount === 'number');
  assert.ok(typeof r.answers.position.sizeUsd === 'number');
  assert.ok(typeof r.summary === 'string' && r.summary.length > 10);
});

ok('四维都健康的标的给出可参与，并给出可执行仓位', () => {
  const t = tok({
    fdv: 1e6, liquidityUsd: 200000,
    priceChange: { m5: 2, h1: 10, h6: 25, h24: 40 },
    txns: {
      m5: { buys: 200, sells: 100 },
      h1: { buys: 1600, sells: 800 },
      h6: { buys: 4000, sells: 2500 },
      h24: { buys: 16000, sells: 12800 },
    },
    socials: [{ type: 'twitter' }, { type: 'telegram' }, { type: 'discord' }],
    websites: [{ url: 'https://test.io' }],
    boosted: true,
  });
  const s = sec();
  const r = runCheckup(t, s, { holderCount: 3846, at: NOW - 3600000 });
  assert.ok(r.safety.score >= 75, '安全 ' + r.safety.score);
  assert.ok(r.chips.score >= 65, '筹码 ' + r.chips.score);
  assert.ok(r.narrative.score >= 60, '叙事 ' + r.narrative.score);
  assert.strictEqual(r.verdict.key, 'go', '结论 ' + r.verdict.key + ' 综合 ' + r.composite);
  assert.strictEqual(r.verdict.label, '可参与');
  assert.ok(r.position.sizeUsd > 0, '应给出仓位');
  assert.ok(r.position.scales.length === 3, '分批计划应有三档');
});

ok('结论阶梯：高潮期最多给「不追」，不给通过', () => {
  const t = tok({
    priceChange: { m5: 1, h1: 5, h6: 60, h24: 180 },
    txns: { m5: { buys: 40, sells: 60 }, h1: { buys: 600, sells: 600 }, h6: { buys: 3000, sells: 2000 }, h24: { buys: 15000, sells: 13500 } },
  });
  const r = runCheckup(t, sec(), null);
  assert.strictEqual(r.narrative.stage, 'peak');
  assert.strictEqual(r.verdict.key, 'wait', '实际 ' + r.verdict.key);
});

ok('筹码缺数据时最高只给「小仓试错」，不给「可参与」', () => {
  const s = sec({ contract: { holderCount: 0 } });
  s.contract.holders.count = 0;
  const r = runCheckup(tok(), s, null);
  assert.strictEqual(r.chips.level, 'unknown');
  assert.ok(['probe', 'watch'].includes(r.verdict.key), '实际 ' + r.verdict.key);
  assert.notStrictEqual(r.verdict.key, 'go');
});

ok('任意夹具组合都不产生 NaN / 越界值', () => {
  const combos = [
    [tok(), sec(), null],
    [tok(), NO_DATA, null],
    [tok({ fdv: 0, liquidityUsd: 0, txns: {}, volume: {}, priceChange: {} }), sec(), null],
    [tok({ pairCreatedAt: 0 }), sec({ contract: { holderCount: 0 } }), null],
    [tok(), sec({ holders: { count: 0 } }), { holderCount: 0 }],
    [tok(), sec({ copycat: { checked: true, isCopycat: true, ratio: 999 } }), null],
  ];
  for (const [t, s, prev] of combos) {
    const r = runCheckup(t, s, prev, { totalCapitalUsd: 5000 });
    assert.ok(Number.isInteger(r.composite) && r.composite >= 0 && r.composite <= 100, '综合分越界 ' + r.composite);
    for (const k of ['safety', 'chips', 'narrative']) {
      assert.ok(Number.isFinite(r[k].score) && r[k].score >= 0 && r[k].score <= 100, k + ' 分数越界 ' + r[k].score);
    }
    assert.ok(Number.isFinite(r.position.sizeUsd) && r.position.sizeUsd >= 0, '仓位越界 ' + r.position.sizeUsd);
    assert.ok(r.position.sizePctOfCapital >= 0 && r.position.sizePctOfCapital <= 100, '仓位占比越界');
    assert.ok(typeof r.verdict.key === 'string' && r.verdict.label, '结论缺失');
  }
});

console.log(`\n通过 ${pass} 项`);
