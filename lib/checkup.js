/**
 * 四维体检模型（安全 / 叙事 / 筹码 / 位置）
 *
 * 龙分（lib/score.js）只回答「量价结构健不健康」，回答不了这四件事：
 *   1. 合约能不能碰（蜜罐、后门、撤池、仿盘）
 *   2. 这个故事还有没有人在传（传播载体与强度）
 *   3. 筹码在谁手里（DEV、捆绑、前排地址）
 *   4. 现在这个位置该不该进、该进多少（入场时机与仓位）
 * 本文件补上这四块，输出可直接执行的结论，不是形容词。
 *
 * 三条设计原则，与龙分一致：
 *   a) 一票否决与扣分分开。安全维度命中硬红线直接 PASS，不参与加权，避免
 *      「合约能随时跑路但量价很漂亮所以总分 82」这种荒唐结论。
 *   b) 缺数据 ≠ 安全。拿不到合约数据的标的按最高风险对待，不给中性分。
 *   c) 「有后门函数」≠「后门能被调用」。owner 已放弃所有权的合约，owner 类
 *      风险实际不可触发，必须据此降级，否则会把 PEPE 这种成熟标的判死。
 *
 * 本文件是纯函数模块，不联网、不读存储，可单独测试与回测。
 *
 * 同构模块：Node 端 require('./lib/checkup')，浏览器端 window.DragonCheckup。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DragonCheckup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r2 = (v) => Math.round(v * 100) / 100;
  const usd = (v) => {
    v = num(v, 0);
    const a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(a >= 1 ? 2 : 6);
  };
  /** 分段打分：bands 为 [上界, 分数] 升序数组，取第一个命中的上界 */
  const band = (v, bands) => {
    for (let i = 0; i < bands.length; i++) if (v <= bands[i][0]) return bands[i][1];
    return bands[bands.length - 1][1];
  };

  // 黑洞 / 已销毁地址：这部分代币永久不可流通，算集中度时必须剔除
  const BURN = {
    '0x0000000000000000000000000000000000000000': 1,
    '0x000000000000000000000000000000000000dead': 1,
    '0x0000000000000000000000000000000000000001': 1,
  };

  // ---------------------------------------------------------------- 默认资金档案
  const DEFAULT_PROFILE = {
    totalCapitalUsd: 10000,   // 用于计算的资金池规模
    maxRiskPerTrade: 0.02,    // 单笔最大亏损占资金池比例
    maxSinglePct: 0.05,       // 单币市值上限占资金池比例
    liquidityCapPct: 0.005,   // 建仓规模不超过池子深度的比例
  };

  // 阶段 → 止损距离。越早期波动越大，止损给得越宽；越晚期越不给容错空间。
  const STAGE_STOP = { seed: 0.50, spread: 0.40, neutral: 0.45, peak: 0.30, ebb: 0.30 };

  const STAGE_LABEL = {
    seed: '萌芽期', spread: '传播期', neutral: '常态', peak: '高潮期', ebb: '退潮期',
  };

  const VERDICT_META = {
    go: { label: '可参与', cls: 'pass' },
    probe: { label: '小仓试错', cls: 'review' },
    wait: { label: '不追', cls: 'veto' },
    watch: { label: '观察', cls: 'unknown' },
    pass: { label: '直接放弃', cls: 'veto' },
    nodata: { label: '数据不足', cls: 'unknown' },
  };

  // ================================================================ 维度一：安全
  /**
   * 一票否决 + 扣分。返回 score 0-100、level（block/high/mid/low）、
   * 以及 hard（硬红线）与 warn（扣分项）两组可读理由。
   */
  function safetyDimension(sec) {
    const out = {
      key: 'safety', label: '安全', score: 0, level: 'unknown',
      hard: [], warn: [], notes: [], checks: [], gaps: [],
    };
    if (!sec || !sec.ok) {
      out.notes.push('未取得任何合约安全数据。缺数据不等于安全，本项按最高风险对待。');
      out.gaps = (sec && sec.gaps) || ['安全数据源全部不可用'];
      out.checks.push({ name: '合约安全数据', pass: false, detail: '未取得' });
      return out;
    }
    out.gaps = (sec.gaps || []).slice();
    const c = sec.contract;
    if (!c) {
      out.notes.push('安全数据源均未收录该合约，无法判定。');
      out.checks.push({ name: '合约安全数据', pass: false, detail: '未收录' });
      return out;
    }

    const renounced = c.ownerRenounced === true;
    let score = 100;

    // ---- 硬红线：与所有权无关，或即使放弃所有权也仍然致命
    if (c.honeypot) out.hard.push('蜜罐：买入后无法卖出');
    if (c.cannotBuy) out.hard.push('合约禁止买入');
    if (c.cannotSellAll) out.hard.push('不能全额卖出，只能卖一部分');
    if (num(c.sellTax) > 10) out.hard.push('卖出税 ' + r2(c.sellTax) + '%，超过 10% 已无法正常交易');
    if (num(c.buyTax) > 10) out.hard.push('买入税 ' + r2(c.buyTax) + '%，超过 10% 已无法正常交易');
    if (c.nonTransferable) out.hard.push('代币被设为不可转让');
    if (num(c.sameCreatorHoneypot) > 0) {
      out.hard.push('同一创建者此前已发过 ' + num(c.sameCreatorHoneypot) + ' 个蜜罐合约，属惯犯');
    }
    if (c.freezable) out.hard.push('发行方仍持有冻结权限，可冻结任意持币账户');
    if (c.closable) out.hard.push('账户可被关闭，持仓可被清零');
    if (num(c.transferFeePct) > 10) {
      out.hard.push('转账税 ' + r2(c.transferFeePct) + '%，超过 10% 已无法正常交易');
    }
    // 以下几条依赖 owner 是否仍在：未放弃所有权才构成否决
    if (c.selfDestruct && !renounced) out.hard.push('合约可自毁，且所有权未放弃');
    if (c.ownerChangeBalance && !renounced) out.hard.push('owner 可任意修改持币余额，且未放弃所有权');
    if (!c.openSource && c.proxy && !renounced) {
      out.hard.push('合约未开源且是代理合约，逻辑可随时被替换');
    }
    // LP 可撤：锁定率低 + 持币地址极少 + 持币人数少到池子是唯一出口
    if (num(c.lpHolderCount) > 0 && num(c.lpHolderCount) <= 3
        && num(c.lpLockedPct) < 30 && num(c.holderCount) < 2000) {
      out.hard.push('LP 只由 ' + num(c.lpHolderCount) + ' 个地址持有、锁定率仅 '
        + r2(c.lpLockedPct) + '%，且持币地址只有 ' + num(c.holderCount) + ' 个，可随时撤池');
    }
    // 仿盘：同符号存在体量大 50 倍以上的标的
    if (sec.copycat && sec.copycat.checked && sec.copycat.isCopycat) {
      const l = sec.copycat.leader || {};
      out.hard.push('仿盘嫌疑：同名标的体量是它的 ' + sec.copycat.ratio + ' 倍（'
        + (l.chainId || '?') + ' 上那个 ' + usd(l.fdv) + '），本标的 ' + usd(sec.copycat.selfFdv));
    }

    // ---- 扣分项
    const deduct = (text, n, cond) => { if (cond) { out.warn.push({ text, n }); score -= n; } };
    // owner 相关：已放弃所有权则只记录不扣分
    const ownerDeduct = (text, n, cond) => {
      if (!cond) return;
      if (renounced) out.notes.push(text + '（所有权已放弃，该风险实际不可触发）');
      else { out.warn.push({ text, n }); score -= n; }
    };

    deduct('合约未开源，无法审计逻辑', 25, !c.openSource);
    deduct('代理合约，逻辑可被替换', 20, c.proxy);
    ownerDeduct('可增发（有 mint 函数且所有权未放弃）', 25, c.mintable);
    ownerDeduct('可暂停转账（有 pause 函数）', 20, c.transferPausable);
    ownerDeduct('可修改买卖税或滑点', 20, c.slippageModifiable);
    ownerDeduct('可找回合约所有权', 18, c.canTakeBackOwnership);
    ownerDeduct('存在隐藏 owner', 18, c.hiddenOwner);
    ownerDeduct('可调整反鲸鱼阈值', 6, c.antiWhale && c.antiWhaleModifiable !== false);
    ownerDeduct('后台可修改元数据（名称、图标可被换）', 12, c.metadataMutable);
    ownerDeduct('存在可变的余额权限', 12, c.balanceMutableAuth);
    ownerDeduct('存在 transfer hook，转账可被拦截或改写', 15, c.transferHook);
    deduct('内置交易冷却，限制连续买卖', 8, c.tradingCooldown);
    deduct('带黑名单功能，可限制指定地址交易', 10, c.blacklistable);
    deduct('带反鲸鱼限制，大额买入会被拦截（影响出货）', 5, c.antiWhale);
    deduct('买卖税合计 ' + r2(num(c.buyTax) + num(c.sellTax)) + '%', 10, num(c.buyTax) + num(c.sellTax) > 5);

    // LP 锁定率：GoPlus 对「LP 由合约托管」的情形常记为未锁，单独命中不足以判死，
    // 按退出通道宽窄决定权重。
    const lp = num(c.lpLockedPct);
    const lpThin = num(c.holderCount) > 0 && num(c.holderCount) < 2000;
    deduct('LP 锁定率仅 ' + r2(lp) + '%，池子随时可被抽走', lpThin ? 25 : 8, lp < 30);
    deduct('LP 锁定率 ' + r2(lp) + '%，偏低', lpThin ? 12 : 5, lp >= 30 && lp < 60);
    deduct('持币地址仅 ' + num(c.holderCount) + ' 个，样本过小', 15, num(c.holderCount) > 0 && num(c.holderCount) < 100);
    if (sec.copycat && sec.copycat.checked) {
      if (sec.copycat.crowded && !sec.copycat.isCopycat) {
        out.warn.push({ text: '符号已被大量仿制（同符号 ' + sec.copycat.tokenCount + ' 个），容易被混淆', n: 6 });
        score -= 6;
      }
      if (sec.copycat.ratio >= 5 && !sec.copycat.isCopycat) {
        out.warn.push({ text: '存在体量大 ' + sec.copycat.ratio + ' 倍的同符号标的，注意别买错', n: 12 });
        score -= 12;
      }
    }
    if (sec.honeypot && sec.honeypot.simulationSuccess === false) {
      out.gaps.push('蜜罐模拟未成功，卖出可行性未经真机验证');
    }
    if (c.simulated !== true && !sec.isSolana) {
      out.gaps.push('蜜罐模拟未返回结果，仅依据静态标志判断');
    }

    score = clamp(score, 0, 100);
    out.score = Math.round(out.hard.length ? 0 : score);
    out.level = out.hard.length ? 'block' : (score < 50 ? 'high' : score < 75 ? 'mid' : 'low');
    out.ownerRenounced = renounced;

    out.checks = [
      { name: '不是蜜罐（能买能卖）', pass: !c.honeypot && !c.cannotSellAll && !c.cannotBuy, detail: c.honeypot ? '模拟判定为蜜罐' : '可正常买卖' },
      { name: '买卖税可接受（各不超 10%）', pass: num(c.buyTax) <= 10 && num(c.sellTax) <= 10, detail: '买 ' + r2(c.buyTax) + '% / 卖 ' + r2(c.sellTax) + '%' },
      { name: '合约开源', pass: !!c.openSource, detail: c.openSource ? '已开源' : '未开源' },
      { name: '不是代理合约', pass: !c.proxy, detail: c.proxy ? '是代理合约' : '非代理' },
      { name: '不可增发', pass: !c.mintable || renounced, detail: c.mintable ? (renounced ? '有 mint 函数但所有权已放弃' : '可增发') : '不可增发' },
      { name: '所有权已放弃或行为可预期', pass: renounced || !(c.ownerChangeBalance || c.transferPausable || c.slippageModifiable), detail: renounced ? '所有权已放弃' : 'owner 权限仍在' },
      { name: 'LP 锁定率不低于 30%', pass: lp >= 30, detail: '锁定 ' + r2(lp) + '%' },
      { name: '非同符号仿盘', pass: !(sec.copycat && sec.copycat.checked && sec.copycat.isCopycat), detail: sec.copycat && sec.copycat.checked ? ('同符号最大体量为自身 ' + sec.copycat.ratio + ' 倍') : '未检测' },
      { name: '创建者无蜜罐前科', pass: num(c.sameCreatorHoneypot) === 0, detail: num(c.sameCreatorHoneypot) > 0 ? num(c.sameCreatorHoneypot) + ' 个前人蜜罐' : '无记录' },
    ];
    return out;
  }

  // ================================================================ 维度二：叙事
  /**
   * 传播载体与传播强度。
   *
   * 边界说明（必须如实交代）：公开接口拿得到的是「传得动传不动」的代理量，
   * 拿不到「故事本身讲了什么」。所以本维度只给传播强度，故事质量必须人工判断，
   * 报告里会把这一点显式写出来，不用机器猜测冒充结论。
   */
  function narrativeDimension(token, prev, sec) {
    const out = {
      key: 'narrative', label: '叙事', score: 0, stage: 'neutral',
      stageLabel: STAGE_LABEL.neutral, bearers: [], channels: [],
      checks: [], notes: [], gaps: [],
      // 未取到行情时显式置空，否则渲染层会把「没查到」印成「常态」加一串 undefined。
      stageKnown: false, txnShare: null, txnBurst: null, priceRun: null,
    };
    if (!token) {
      out.notes.push('未取到该标的的成交流水，传播阶段无法判断（缺数据不判绿）。');
      out.checks.push({ name: '成交流水数据', pass: false, detail: '未取得' });
      return out;
    }

    const v = token.volume || {};
    const t = token.txns || {};
    const pc = token.priceChange || {};
    const h1 = t.h1 || {}, h24 = t.h24 || {}, m5 = t.m5 || {};

    const tx1h = num(h1.buys) + num(h1.sells);
    const tx24h = num(h24.buys) + num(h24.sells);
    const tx5m = num(m5.buys) + num(m5.sells);
    // 参与广度：近 1 小时成交笔数相对 24 小时均速的倍数。>1 说明参与度在放大。
    const txnShare = tx24h > 0 ? (tx1h / tx24h) * 24 : 0;
    // 近 5 分钟相对 1 小时的瞬时加速度，用于看「刚刚是不是突然有人进来」
    const txnBurst = tx1h > 0 ? (tx5m * 12) / tx1h : 0;

    const priceRun = Math.max(0, num(pc.h24, 0));
    const fdv = num(token.fdv || token.marketCap, 0);
    const ageH = token.pairCreatedAt ? (Date.now() - num(token.pairCreatedAt)) / 3600000 : 999;

    // ---- 阶段判定
    let stage = 'neutral';
    if (ageH < 6 && txnShare > 3 && fdv < 2e6) stage = 'seed';
    else if (txnShare > 1.5 && priceRun < 80) stage = 'spread';
    else if (priceRun >= 80 && txnShare < 1.2) stage = 'peak';
    else if (num(pc.h1, 0) < -15 && txnShare < 0.8) stage = 'ebb';
    out.stage = stage;
    out.stageLabel = STAGE_LABEL[stage];

    // ---- 传播载体（故事靠什么传出去）
    const sites = Array.isArray(token.websites) ? token.websites : [];
    const socials = Array.isArray(token.socials) ? token.socials : [];
    if (sites.length) out.bearers.push('官网');
    const socialTypes = {};
    socials.forEach((s) => {
      const type = String((s && s.type) || '').toLowerCase();
      const url = String((s && s.url) || '');
      if (type) socialTypes[type] = true;
      else if (/twitter|x\.com/.test(url)) socialTypes.twitter = true;
      else if (/t\.me|telegram/.test(url)) socialTypes.telegram = true;
      else if (/discord/.test(url)) socialTypes.discord = true;
    });
    if (socialTypes.twitter) out.bearers.push('X / Twitter');
    if (socialTypes.telegram) out.bearers.push('Telegram');
    if (socialTypes.discord) out.bearers.push('Discord');
    if (token.boosted) out.bearers.push('付费推广位');
    if (token.hasProfile) out.bearers.push('官方代币资料');

    const holderCount = num(sec && sec.contract && sec.contract.holderCount, 0);
    if (holderCount >= 1000) out.bearers.push('持币地址 ' + holderCount + ' 个');

    // ---- 持有人增量（需要两次体检快照才有）
    const prevHolders = num(prev && prev.holderCount, 0);
    let holderGrowthPct = null;
    if (prevHolders > 0 && holderCount > 0) {
      holderGrowthPct = r2(((holderCount - prevHolders) / prevHolders) * 100);
      out.holderGrowthPct = holderGrowthPct;
      out.bearers.push('持币地址在增长');
    }

    // ---- 背离：价格已经走完，参与度却在衰减 = 没有新钱进来接
    const divergence = priceRun > 60 && txnShare < 1.5 && tx24h > 0;
    out.divergence = divergence;

    // ---- 打分
    let score = 0;
    const add = (text, n, detail) => { score += n; out.checks.push({ name: text, pass: n > 0, detail: detail || '' }); };

    add('参与广度在放大', band(txnShare, [[0.7, 3], [1.0, 10], [1.5, 18], [3, 27], [1e9, 35]]),
      '近 1 小时成交笔数相当于日均的 ' + r2(txnShare) + ' 倍');
    add('瞬时加速度', band(txnBurst, [[0.8, 2], [1.2, 6], [2, 10], [1e9, 14]]),
      '近 5 分钟折算 vs 近 1 小时：' + r2(txnBurst) + ' 倍');
    const bearerPts = Math.min(24, out.bearers.length * 8);
    add('传播载体数量', bearerPts, out.bearers.length ? out.bearers.join(' / ') : '无任何社交、官网或推广载体');
    if (holderGrowthPct == null) {
      out.checks.push({ name: '持币地址增长', pass: false, detail: '尚未取到两次体检快照，无法计算增量' });
      score += 8;   // 未知按中性偏低给分，但不当作好消息
    } else {
      // 阈值本身就是按「增长率」升序排的（-20 / -5 / 0 / 上限），必须直接传原值。
      // 这里曾误写成 band(-holderGrowthPct, ...) 导致方向反了：持币地址减少 30% 拿满分、
      // 增加 30% 反而拿 0 分。已修正，并由 test/checkup.test.js 的方向性用例锁住。
      add('持币地址增长', band(holderGrowthPct, [[-20, 0], [-5, 12], [0, 18], [1e9, 25]]),
        '较上次体检 ' + (holderGrowthPct >= 0 ? '+' : '') + holderGrowthPct + '%');
    }
    if (divergence) { score -= 20; out.warn = out.warn || []; out.warn.push({ text: '量价背离：价格 24 小时已涨 ' + r2(priceRun) + '%，但参与广度只有 ' + r2(txnShare) + ' 倍，没有新参与者接手', n: 20 }); }
    if (stage === 'peak') { score -= 10; out.notes.push('价格已经走完大部分，参与度开始衰减，属于典型高潮期特征。'); }
    if (stage === 'ebb') { score -= 30; out.notes.push('价格与参与度同时在退，叙事已过峰值。'); }
    if (stage === 'seed') { out.notes.push('池龄不足 6 小时且参与度快速放大，属萌芽期：赔率高但失败率也最高。'); }
    if (stage === 'spread') { out.notes.push('参与度持续放大且价格尚未走完，属于传播期，是四档里风险收益比最好的一段。'); }

    out.score = clamp(Math.round(score), 0, 100);
    out.txnShare = r2(txnShare);
    out.txnBurst = r2(txnBurst);
    out.priceRun = r2(priceRun);
    out.holderCount = holderCount;
    out.stageKnown = true;
    out.bearers = out.bearers.filter((x) => x !== '持币地址在增长' || holderGrowthPct > 0);
    out.gaps.push('故事内容本身（讲了什么、能否被复述与二次创作）无法从公开接口获得，必须人工判断');

    // 没有任何成交流水时，参与广度、加速度、价格涨幅全部退化为 0，阶段判定会假报「常态」。
    // 这里必须显式降级：缺数据不判绿，也不允许它靠「无数据」拿到中性分。
    if (!(tx24h > 0)) {
      out.noMarket = true;
      out.score = Math.min(out.score, 30);
      out.stageKnown = false;
      out.stageLabel = '未知（未取到成交流水）';
      out.notes.push('未取到成交流水数据，参与广度与阶段无法判断（缺数据不判绿）。');
      out.checks.push({ name: '成交流水数据', pass: false, detail: '未取得' });
    }
    if (!out.bearers.length) {
      out.notes.push('没有任何传播载体：没有社交、没有官网、没有推广位。这种标的只有价格在动，故事传不出去。');
    }
    return out;
  }

  // ================================================================ 维度三：筹码
  /**
   * 筹码在谁手里：DEV 自留、捆绑/狙击、前排地址集中度，
   * 以及最关键的一条——前十大如果一起出货，能不能把池子砸穿。
   */
  function chipsDimension(sec, token) {
    const out = {
      key: 'chips', label: '筹码', score: 0, level: 'unknown',
      critical: false, hard: [], warn: [], checks: [], notes: [],
      // 未取得数据时这些字段显式置空。留 undefined 会让渲染层把「没查到」印成
      // 「前十大 undefined%」、「抛压 0 倍」这类看起来像结论的东西。
      top10Pct: null, top1Pct: null, devPct: null, floatPct: null, holderCount: null,
      lpLockedPct: null, dumpUsd: null, dumpRatio: null, perHolderUsd: null,
      concSource: '', channelLabel: '', excludedHolders: [],
    };
    const c = sec && sec.contract;
    if (!c || !c.holders) {
      out.notes.push('未取得持有人分布数据，无法判断筹码结构。缺数据按最不利情况处理。');
      out.checks.push({ name: '持有人分布', pass: false, detail: '未取得' });
      return out;
    }
    const fdv = num(token && (token.fdv || token.marketCap), 0);
    const liq = num(token && token.liquidityUsd, 0);
    const holders = num(c.holders.count, 0);

    // ---- 集中度重算：剔除池子地址、黑洞地址与已锁仓地址
    // 池子地址持有的是 AMM 储备，不是某个人的筹码；黑洞地址是不可流通的销毁量；
    // 已锁仓地址短期砸不出来。这三类不剔除，前十大占比会系统性虚高，
    // 进而把大量正常标的直接判死。
    //
    // Solana 上还有一层坑：前排名单给的是「代币账户地址」，池子的储备账户 owner 才是池子本身。
    // 例如某个 pump 池的储备账户持有 76% 供应量，它的 address 是账户地址、owner 是池子地址，
    // 只比对 address 永远匹配不上，会把池子储备当成巨鲸，直接误判致命。所以两边都要比。
    const pair = String(sec.pairAddress || (token && token.pairAddress) || '').toLowerCase();
    const poolSet = {};
    if (pair) poolSet[pair] = 1;
    const poolList = sec && sec.rugFull && Array.isArray(sec.rugFull.poolAddresses)
      ? sec.rugFull.poolAddresses : [];
    poolList.forEach((a) => { const s = String(a || '').toLowerCase(); if (s) poolSet[s] = 1; });
    const isPoolAddress = (v) => { const s = String(v || '').toLowerCase(); return !!s && poolSet[s] === 1; };

    const rawTop = Array.isArray(c.topHolders) ? c.topHolders : [];
    const excluded = [];
    const excl = (address, h, why) => excluded.push({ address, pct: num(h.pct, 0), why });
    let concPct = 0, counted = 0;
    rawTop.forEach((h) => {
      if (counted >= 10) return;
      const a = String(h.address || '').toLowerCase();
      if (isPoolAddress(a)) { excl(a, h, '流动性池储备'); return; }
      // 账户地址不是池子，但它归属的钱包是池子 —— 同样是储备，不是个人筹码
      if (isPoolAddress(h.owner) && !isPoolAddress(a)) { excl(a, h, '流动性池储备（账户归属池子）'); return; }
      if (BURN[a]) { excl(a, h, '已销毁'); return; }
      if (h.isLocked) { excl(a, h, '已锁仓'); return; }
      concPct += num(h.pct, 0);
      counted++;
    });
    // 可用的前排名单太少时退回 GoPlus 原值，但会记一条数据口径说明
    const poolExcluded = excluded.filter((x) => String(x.why).indexOf('池子') >= 0);
    let top10, concSource;
    if (rawTop.length >= 5 && counted >= 5) { top10 = r2(concPct); concSource = '剔除池子/销毁/锁仓后重算'; }
    else { top10 = num(c.holders.top10Pct, 0); concSource = 'GoPlus 原始值（可用前排名单不足，未剔除）'; }
    const top1 = num(c.holders.top1Pct, 0);
    const dev = r2(num(c.holders.creatorPct, 0) + num(c.holders.ownerPct, 0));
    const lpLocked = num(c.holders.lpLockedPct, 0);
    const floatPct = r2(Math.max(0, 100 - top10));
    const excludedPct = r2(excluded.reduce((s, x) => s + num(x.pct, 0), 0));

    // 前十大同时出货砸向池子：抛压 / 深度
    const dumpUsd = fdv > 0 ? (fdv * top10) / 100 : 0;
    const dumpRatio = liq > 0 ? dumpUsd / liq : 0;
    // 人均持有市值：市值大但地址少 = 筹码集中在少数人手里，不是真传播
    const perHolder = holders > 0 && fdv > 0 ? fdv / holders : 0;

    // ---- 风险 = 集中度 × 退出通道狭窄程度
    // 只看集中度会误伤大市值标的：那些前排是交易所热钱包，出货走的是 CEX 订单簿，
    // 不是 DEX 池子，池子深度对它没有约束力。只有「集中度高」且「持有人少、池子浅」
    // 同时成立，才是真正能被一次性砸穿的结构。
    const concLevel = top10 >= 60 ? 3 : (top10 >= 45 ? 2 : (top10 >= 30 ? 1 : 0));
    // 持币地址数未知时按「最窄通道」参与打分（缺数据不等于安全），但不据此判致命项：
    // 硬红线必须建立在证据上，不能建立在「没查到」上。
    const holdersUnknown = !(holders > 0);
    const channelLevel = holdersUnknown || holders < 500 ? 0 : (holders < 5000 ? 1 : 2);
    out.concLevel = concLevel;
    out.channelLevel = channelLevel;
    out.holdersUnknown = holdersUnknown;
    out.channelLabel = holdersUnknown ? '未知（未取得持币地址数）'
      : ['狭窄（持币 < 500）', '一般（持币 < 5000）', '宽（持币 >= 5000）'][channelLevel];
    out.concSource = concSource;
    out.excludedHolders = excluded;
    out.poolExcluded = poolExcluded.length;
    if (poolExcluded.length) {
      out.notes.push('前排名单里有 ' + poolExcluded.length + ' 个地址是流动性池储备（合计 '
        + r2(poolExcluded.reduce((s, x) => s + num(x.pct, 0), 0)) + '%），已从集中度里剔除：'
        + '那是 AMM 池子自己的币，不是任何人的筹码。');
    }

    if (!holdersUnknown) {
      if (concLevel >= 3 && channelLevel <= 1) {
        out.hard.push('前十大持有 ' + r2(top10) + '% 且持币地址只有 ' + holders
          + ' 个，少数地址可以一次性出货');
        out.critical = true;
      } else if (concLevel >= 2 && channelLevel === 0) {
        out.hard.push('前十大持有 ' + r2(top10) + '%，而持币地址仅 ' + holders + ' 个，筹码高度集中');
        out.critical = true;
      }
      if (channelLevel === 0 && dumpRatio >= 5) {
        out.hard.push('前十大潜在抛压 ' + usd(dumpUsd) + '，是池子深度（' + usd(liq) + '）的 '
          + r2(dumpRatio) + ' 倍，且持币地址只有 ' + holders + ' 个，砸下去直接击穿');
        out.critical = true;
      }
    }
    if (dev >= 10) {
      out.hard.push('DEV 自留 ' + dev + '%，超过 10% 属于随时可以砸盘的量级');
      out.critical = true;
    }
    const rf = sec && sec.rugFull;
    if (rf && num(rf.graphInsidersDetected) > 0 && num(rf.insiderPct) >= 15) {
      out.hard.push('检测到捆绑地址网络：关联地址 ' + num(rf.graphInsidersDetected)
        + ' 个，合计持有 ' + r2(num(rf.insiderPct)) + '%');
      out.critical = true;
    }

    // ---- 打分
    let score = 100;
    const deduct = (text, n, cond) => { if (cond) { out.warn.push({ text, n }); score -= n; } };
    // 退出通道越宽，同样的集中度越不构成风险：持币上万个的标的，前十大再多也砸不穿市场
    const concW = channelLevel === 0 ? 1 : (channelLevel === 1 ? 0.75 : 0.5);

    // 前排集中度
    const top10Pts = Math.round(band(top10, [[15, 0], [20, 4], [30, 12], [40, 24], [50, 36], [1e9, 50]]) * concW);
    if (top10Pts > 0) {
      out.warn.push({ text: '前十大持有 ' + r2(top10) + '%（第一名单个 ' + r2(top1) + '%，' + concSource + '）', n: top10Pts });
      score -= top10Pts;
    } else out.notes.push('前十大仅持有 ' + r2(top10) + '%，筹码足够分散。');

    // DEV 自留：与市场规模无关，DEV 手里的货永远是第一顺位抛压
    const devPts = band(dev, [[1, 0], [3, 6], [5, 12], [10, 22], [1e9, 35]]);
    if (devPts > 0) { out.warn.push({ text: 'DEV / owner 自留 ' + dev + '%', n: devPts }); score -= devPts; }
    else out.notes.push('DEV 基本没有自留（' + dev + '%）。');

    // 砸盘比
    const dumpPts = Math.round(band(dumpRatio, [[0.3, 0], [0.6, 8], [1, 16], [2, 26], [3, 34], [1e9, 45]]) * concW);
    if (dumpPts > 0) {
      out.warn.push({ text: '前十大潜在抛压 $' + Math.round(dumpUsd) + ' 相当于池子深度的 ' + r2(dumpRatio) + ' 倍', n: dumpPts });
      score -= dumpPts;
    } else if (fdv > 0 && liq > 0) {
      out.notes.push('前十大潜在抛压只有池子深度的 ' + r2(dumpRatio) + ' 倍，砸不穿。');
    } else {
      // 缺市值或池子深度时 dumpRatio 恒为 0，绝不能据此说「砸不穿」
      out.notes.push('未取到市值与池子深度，抛压比无法计算（缺数据不判绿）。');
    }

    // 持币地址规模
    const holderPts = band(holders, [[100, 22], [300, 14], [1000, 8], [5000, 3], [1e9, 0]]);
    if (holderPts > 0) { out.warn.push({ text: '持币地址仅 ' + holders + ' 个', n: holderPts }); score -= holderPts; }

    // 人均持有量
    const perHolderPts = band(perHolder, [[200, 0], [1000, 5], [5000, 12], [20000, 20], [1e9, 28]]);
    if (perHolderPts > 0) {
      out.warn.push({ text: '人均持有市值 $' + Math.round(perHolder) + '，市值撑在少数地址上', n: perHolderPts });
      score -= perHolderPts;
    }

    // LP：退出通道越窄，未锁 LP 越致命。持币上万的标的，LP 早已不是唯一出口。
    const lpPenalty = lpLocked < 30
      ? (channelLevel === 0 ? 25 : (channelLevel === 1 ? 15 : 6))
      : (lpLocked < 60 ? (channelLevel === 0 ? 12 : 5) : 0);
    if (lpPenalty > 0) {
      out.warn.push({ text: 'LP 锁定率 ' + r2(lpLocked) + '%', n: lpPenalty });
      score -= lpPenalty;
    }
    deduct('LP 只有 ' + num(c.holders.lpHolderCount) + ' 个地址提供，流动性脆弱', 10,
      num(c.holders.lpHolderCount) > 0 && num(c.holders.lpHolderCount) <= 5 && lpLocked < 60);
    // GoPlus 的 LP 锁定标记录入不完整（托管在合约里的 LP 常被记为未锁），
    // 因此该字段只做参考，不单独构成致命判定。
    out.notes.push('LP 锁定率取自 GoPlus，对「LP 由合约托管」的情形常记为未锁定，需人工在链上复核。');

    // 捆绑（无全量报告时的近似）
    if (rf) {
      deduct('存在捆绑地址网络（关联 ' + num(rf.graphInsidersDetected) + ' 个）', 20,
        num(rf.graphInsidersDetected) > 0 && num(rf.insiderPct) < 15);
      deduct('创建者仍持有代币（' + num(rf.creatorTokens) + ' 笔）', 10,
        num(rf.creatorTokens) > 0 && num(rf.creatorBalance) > 0);
      out.insiderPct = r2(num(rf.insiderPct));
      out.graphInsiders = num(rf.graphInsidersDetected);
      out.topHolders = rf.topHolders;
    } else if (sec && sec.contract && Array.isArray(sec.contract.topHolders)) {
      out.topHolders = sec.contract.topHolders;
      // 合约钱包占前排比例过高：不是散户，是同一批人用合约一起埋伏
      const contractTop = c.topHolders.filter((h) => h.isContract).length;
      deduct('前十大里有 ' + contractTop + ' 个合约地址，不是自然人筹码', 12, contractTop >= 5);
    }
    // Solana 侧无全量报告时提示能力边界
    if (sec && sec.isSolana && !rf) {
      out.notes.push('未取捆绑网络全量报告，捆绑检测为粗略近似。对单个标的执行深检可拿到关联地址网络。');
    }

    score = clamp(score, 0, 100);
    if (holdersUnknown) {
      // 没查到持币地址数就无法判断退出通道，本维度不给通过分，也不谎称发现了问题
      score = Math.min(score, 55);
      out.notes.push('未取得持币地址数，退出通道无法判断。按「缺数据不判绿」的原则，本维度不给通过分。');
    }
    out.score = Math.round(out.hard.length ? Math.min(score, 25) : score);
    out.level = out.hard.length ? 'critical'
      : (holdersUnknown ? 'unknown' : (score < 50 ? 'high' : score < 75 ? 'mid' : 'low'));
    out.top10Pct = r2(top10);
    out.top1Pct = r2(top1);
    out.devPct = dev;
    out.floatPct = floatPct;
    out.holderCount = holders;
    out.lpLockedPct = r2(lpLocked);
    out.dumpUsd = Math.round(dumpUsd);
    out.dumpRatio = r2(dumpRatio);
    out.perHolderUsd = Math.round(perHolder);

    out.checks = [
      { name: '前十大占比低于 30%', pass: top10 < 30, detail: r2(top10) + '%' },
      { name: 'DEV 自留低于 3%', pass: dev < 3, detail: dev + '%' },
      { name: '前十大抛压砸不穿池子', pass: dumpRatio < 1, detail: r2(dumpRatio) + ' 倍深度' },
      { name: '持币地址超过 1000', pass: holders >= 1000, detail: holders + ' 个' },
      { name: 'LP 锁定率不低于 60%', pass: lpLocked >= 60, detail: r2(lpLocked) + '%' },
      { name: '未检测到捆绑地址网络', pass: !(rf && num(rf.graphInsidersDetected) > 0 && num(rf.insiderPct) >= 15), detail: rf ? (num(rf.graphInsidersDetected) + ' 个关联地址') : '未深检' },
    ];
    return out;
  }

  // ================================================================ 维度四：位置
  /**
   * 入场时机与仓位。仓位由风险预算倒推，不由感觉决定。
   * 核心公式：仓位 = 单笔可承受亏损 / 止损距离，再用流动性上限与单币上限封顶。
   */
  function positionDimension(token, dims, profile) {
    const p = Object.assign({}, DEFAULT_PROFILE, profile || {});
    const out = { key: 'position', label: '位置', checks: [], notes: [], scales: [], exits: [] };

    const fdv = num(token && (token.fdv || token.marketCap), 0);
    const liq = num(token && token.liquidityUsd, 0);
    const stage = (dims.narrative && dims.narrative.stage) || 'neutral';

    // ---- 市值分档
    // fdv 缺失时必须单独分档：否则 0 < 1e6 会落进「早期」，把「没取到行情」
    // 伪装成「这是个早期小盘」，进而倒推出一个看起来合理的仓位。
    const hasMarket = fdv > 0 && liq > 0;
    let bandKey = 'over', bandLabel = '超大盘';
    if (fdv <= 0) { bandKey = 'unknown'; bandLabel = '未取到市值'; }
    else if (fdv < 150e3) { bandKey = 'micro'; bandLabel = '极早期（< $150K）'; }
    else if (fdv < 1e6) { bandKey = 'early'; bandLabel = '早期（$150K - $1M）'; }
    else if (fdv < 5e6) { bandKey = 'mid'; bandLabel = '中段（$1M - $5M）'; }
    else if (fdv < 20e6) { bandKey = 'late'; bandLabel = '后段（$5M - $20M）'; }
    out.mcapBand = bandKey;
    out.mcapBandLabel = bandLabel;
    out.marketComplete = hasMarket;

    // ---- 参与资格
    const safety = dims.safety || {};
    const chips = dims.chips || {};
    const narrative = dims.narrative || {};
    const disq = [];
    if (safety.level === 'block') disq.push('安全维度命中硬红线');
    else if (safety.level === 'unknown') disq.push('合约安全数据缺失，无法给出仓位');
    if (chips.critical) disq.push('筹码结构存在致命项');
    if (stage === 'ebb') disq.push('叙事已进入退潮期');
    // 没有市值与池子深度就没有「流动性上限」，倒推出来的数字会是假的
    if (!hasMarket) disq.push('未取到市值与池子深度，无法倒推仓位');
    out.disqualified = disq;

    // ---- 仓位计算
    const total = num(p.totalCapitalUsd, 0);
    const riskBudget = total * num(p.maxRiskPerTrade, 0.02);
    const stopPct = STAGE_STOP[stage] || 0.45;
    const riskSize = riskBudget > 0 ? riskBudget / stopPct : 0;
    const liqCap = liq * num(p.liquidityCapPct, 0.005);
    const singleCap = total * num(p.maxSinglePct, 0.05);
    const cap = Math.min(riskSize, liqCap, singleCap);
    const capBy = riskSize <= liqCap && riskSize <= singleCap ? '风险预算'
      : (liqCap <= singleCap ? '流动性上限' : '单币上限');

    // 质量系数：四维越差，同样的风险预算也只能下更小的注
    const quality = clamp(
      (num(safety.score, 0) * 0.45 + num(chips.score, 0) * 0.35 + num(narrative.score, 0) * 0.20) / 100,
      0, 1
    );
    const tierMult = { seed: 0.5, spread: 1.0, neutral: 0.7, peak: 0.25, ebb: 0 }[stage];
    let size = disq.length ? 0 : cap * quality * tierMult;
    size = Math.max(0, Math.round(size));

    out.totalCapitalUsd = total;
    out.riskBudgetUsd = Math.round(riskBudget);
    out.stopPct = Math.round(stopPct * 100);
    out.riskSizeUsd = Math.round(riskSize);
    out.liquidityCapUsd = Math.round(liqCap);
    out.singleCapUsd = Math.round(singleCap);
    out.sizeUsd = size;
    out.sizeCapBy = capBy;
    out.qualityFactor = r2(quality);
    out.tierMult = tierMult;
    out.sizePctOfCapital = total > 0 ? r2((size / total) * 100) : 0;
    out.sizePctOfLiquidity = liq > 0 ? r2((size / liq) * 100) : 0;

    // ---- 分批计划
    if (size > 0) {
      out.scales = [
        { label: '首仓', pct: 50, usd: Math.round(size * 0.5), when: '现在就建，不超过计划的一半' },
        { label: '回踩加仓', pct: 30, usd: Math.round(size * 0.3), when: '回踩不破首仓成本 -' + Math.round(stopPct * 60) + '% 且池子深度没掉' },
        { label: '确认加仓', pct: 20, usd: Math.round(size * 0.2), when: '放量突破首仓后高点，且持币地址继续增加' },
      ];
    }

    // ---- 离场条件（先写清楚，再进场）
    out.exits = [
      { label: '止损', detail: '价格跌破建仓均价 -' + Math.round(stopPct * 100) + '%（' + usd(size ? size : cap) + ' 仓位对应亏损约 ' + usd(riskBudget) + '）' },
      { label: '池子变化', detail: '池子深度跌破建仓时的 60%，或 LP 锁定率下降，不等价格先走' },
      { label: '筹码变化', detail: '前十大占比明显上升，或 DEV 地址开始转出，直接离场' },
      { label: '叙事变化', detail: '持币地址开始减少且成交笔数同步衰减，说明故事传不动了，离场' },
    ];

    out.checks = [
      { name: '市值处于可参与区间', pass: bandKey !== 'over', detail: bandLabel + ' / ' + usd(fdv) },
      { name: '池子深度足够进出', pass: liq >= 30000, detail: usd(liq) },
      { name: '叙事阶段适合建仓', pass: stage === 'seed' || stage === 'spread' || stage === 'neutral', detail: STAGE_LABEL[stage] },
      { name: '仓位不超过池子深度的 2%', pass: liq > 0 && (size / liq) * 100 <= 2, detail: r2(liq > 0 ? (size / liq) * 100 : 0) + '%' },
      { name: '止损金额在可承受范围', pass: size > 0 && size * stopPct <= riskBudget * 1.05, detail: '约 ' + usd(Math.round(size * stopPct)) },
    ];
    if (disq.length) out.notes.push('不具备给仓位的条件：' + disq.join('；') + '。给 0 而不是给一个「小仓位」，因为小仓位也无法解决致命结构。');
    else if (size === 0) out.notes.push('四维质量系数过低，按风险预算倒推出来的仓位不足 1 美元，等同于不参与。');
    else out.notes.push('仓位由「单笔可承受亏损 ÷ 止损距离」倒推，取风险预算、流动性上限、单币上限三者最小值，再乘四维质量系数 ' + r2(quality) + ' 与阶段系数 ' + tierMult + '。');
    return out;
  }

  // ================================================================ 编排
  /**
   * 跑完整四维体检。
   * @param {object} token      当前快照标的（含 volume / txns / priceChange / fdv / liquidityUsd）
   * @param {object|null} sec   lib/security.js 的 fetchSecurity 结果
   * @param {object|null} prev  上一次体检的简要记录（至少含 holderCount），用于算增量
   * @param {object} [profile]  资金档案
   */
  function runCheckup(token, sec, prev, profile) {
    const safety = safetyDimension(sec);
    const narrative = narrativeDimension(token, prev, sec);
    const chips = chipsDimension(sec, token);
    const dims = { safety, narrative, chips };
    const position = positionDimension(token, dims, profile);

    // 综合分：安全权重最高，其次筹码，再次叙事。位置不参与加分，它是执行环节。
    const composite = Math.round(
      num(safety.score, 0) * 0.40 + num(chips.score, 0) * 0.30 + num(narrative.score, 0) * 0.30
    );

    // ---- 结论
    let verdictKey;
    if (!sec || !sec.ok || safety.level === 'unknown') verdictKey = 'nodata';
    else if (safety.level === 'block') verdictKey = 'pass';
    else if (chips.critical) verdictKey = 'pass';
    else if (safety.score < 50) verdictKey = 'pass';
    else if (narrative.stage === 'ebb') verdictKey = 'pass';
    else if (narrative.stage === 'peak') verdictKey = 'wait';
    // 筹码数据缺失时最多给到「小仓试错」：连持币地址数都没拿到，不给「可参与」
    else if (chips.level === 'unknown') verdictKey = safety.score >= 65 ? 'probe' : 'watch';
    else if (safety.score >= 75 && chips.score >= 65 && narrative.score >= 60) verdictKey = 'go';
    else if (safety.score >= 65) verdictKey = 'probe';
    else verdictKey = 'watch';

    const meta = VERDICT_META[verdictKey] || VERDICT_META.watch;

    // ---- 一句话结论
    const reasons = [];
    if (safety.hard.length) reasons.push('安全硬红线 ' + safety.hard.length + ' 条');
    else if (safety.warn.length) reasons.push('安全扣分 ' + safety.warn.reduce((s, x) => s + x.n, 0) + ' 分');
    if (chips.hard.length) reasons.push('筹码致命项 ' + chips.hard.length + ' 条');
    if (narrative.divergence) reasons.push('量价背离');
    const summary = meta.label + '：' + (reasons.length ? reasons.join('，') : '四维无硬伤')
      + '。安全 ' + safety.score + ' / 筹码 ' + chips.score + ' / 叙事 ' + narrative.score
      + '，阶段 ' + narrative.stageLabel + '。';

    return {
      ok: true,
      at: Date.now(),
      composite,
      verdict: { key: verdictKey, label: meta.label, cls: meta.cls },
      summary,
      safety,
      narrative,
      chips,
      position,
      // 直答四问
      answers: {
        safety: safety.hard.length ? safety.hard : (safety.level === 'unknown' ? ['安全数据缺失，按最高风险对待'] : []),
        narrative: {
          bearers: narrative.bearers,
          stage: narrative.stageLabel,
          holderGrowthPct: narrative.holderGrowthPct == null ? null : narrative.holderGrowthPct,
          stillSpreading: narrative.stage === 'seed' || narrative.stage === 'spread',
          note: '故事内容无法自动获取，这里只给传播载体与强度',
        },
        chips: {
          devPct: chips.devPct,
          top10Pct: chips.top10Pct,
          top1Pct: chips.top1Pct,
          holderCount: chips.holderCount,
          dumpRatio: chips.dumpRatio,
          insiderPct: chips.insiderPct == null ? null : chips.insiderPct,
        },
        position: {
          mcapBand: position.mcapBandLabel,
          stage: narrative.stageLabel,
          disqualified: position.disqualified,
          sizeUsd: position.sizeUsd,
          sizePctOfCapital: position.sizePctOfCapital,
        },
      },
    };
  }

  return {
    DEFAULT_PROFILE,
    STAGE_STOP,
    STAGE_LABEL,
    VERDICT_META,
    safetyDimension,
    narrativeDimension,
    chipsDimension,
    positionDimension,
    runCheckup,
  };
});
