/**
 * 安全与筹码数据源层（四维体检的外部输入）
 *
 * lib/sources.js 只负责技术面（价量、深度、池龄）。合约安不安全、筹码在谁手里、
 * 有没有仿盘，这些拿不到，必须另接风控类接口。本文件就是这一层。
 *
 * 数据源（全部公开、无需 key，实测均返回 CORS 允许头，浏览器可直连）：
 *   GoPlus       https://api.gopluslabs.io     EVM + Solana 合约安全标志与持有人分布
 *   honeypot.is  https://api.honeypot.is       EVM 真实买卖模拟（比静态标志可靠）
 *   RugCheck     https://api.rugcheck.xyz      Solana 风险报告，含发行方与 insider 网络
 *   DexScreener  同名检索                      仿盘识别（同符号但小几个数量级的新盘）
 *
 * 免费档实测约束（重要，决定了调用策略）：
 *   1. GoPlus 不带 API key 时**一次请求只返回 1 个地址**，comma 批量无效。因此体检
 *      不能对全池逐轮调用，只能按需触发 + 长缓存。
 *   2. RugCheck 的 `/report` 单币可达 2 MB 以上；`/report/summary` 只有几百字节。
 *      轻检走 summary，需要 insider 网络数据时才取全量报告。
 *
 * 字段口径陷阱（已实测核对，切勿凭直觉改）：
 *   GoPlus 的 `percent` 是**小数**（0.0883 表示 8.83%）；RugCheck 的 `pct` 是**百分数**
 *   （8.83 表示 8.83%）。两者在本文件里统一归一到 0-100 的百分数再往外抛。
 *
 * 同构模块：Node 端 require('./lib/security')，浏览器端加载后使用 window.DragonSecurity。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DragonSecurity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UA = 'Mozilla/5.0 (compatible; DragonRadar/1.0)';
  const DEX = 'https://api.dexscreener.com';
  const GP = 'https://api.gopluslabs.io';
  const HP = 'https://api.honeypot.is';
  const RC = 'https://api.rugcheck.xyz';

  const CACHE_PREFIX = 'dr.sec.v1.';
  const CACHE_TTL_MS = 6 * 3600 * 1000;   // 合约安全属性变化很慢，6 小时足够
  const FULL_TTL_MS = 24 * 3600 * 1000;   // RugCheck 全量报告更贵，缓存更久

  // GoPlus 支持的链（键与 DexScreener 的 chainId 一致）
  const GP_CHAIN = {
    ethereum: '1', bsc: '56', base: '8453', arbitrum: '42161', polygon: '137',
    optimism: '10', avalanche: '43114', linea: '59144', scroll: '534352',
    zksync: '324', fantom: '250', cronos: '25', celo: '42220',
    moonbeam: '1284', blast: '81457', sei: '1329', mantle: '5000',
  };

  // honeypot.is 支持的链（只覆盖主要 EVM 链）
  const HP_CHAIN = {
    ethereum: 1, bsc: 56, base: 8453, arbitrum: 42161, polygon: 137,
    optimism: 10, avalanche: 43114, fantom: 250, cronos: 25,
  };

  // 黑洞 / 已销毁地址：LP 打到这里等同于锁定
  const BURN = {
    '0x0000000000000000000000000000000000000000': 1,
    '0x000000000000000000000000000000000000dead': 1,
    '0x0000000000000000000000000000000000000001': 1,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const flag = (v) => v === true || v === 1 || v === '1';
  const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };
  // GoPlus 的 percent 是 0-1 小数，统一转成 0-100
  const toPct = (v) => { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(100, n * 100)) : 0; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  const isBurn = (a) => !!BURN[String(a || '').toLowerCase()];

  // ------------------------------------------------------------- 缓存
  // 浏览器用 localStorage，Node 形态用内存表。键前缀一致，便于排查。
  const memCache = {};
  function cacheGet(key) {
    const full = CACHE_PREFIX + key;
    let raw = null;
    if (typeof localStorage !== 'undefined') {
      try { raw = localStorage.getItem(full); } catch (e) { raw = null; }
    }
    if (!raw && memCache[full]) raw = memCache[full];
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw);
      if (!rec || !rec.at || Date.now() - rec.at > (rec.ttl || CACHE_TTL_MS)) return null;
      return rec.value;
    } catch (e) { return null; }
  }
  function cacheSet(key, value, ttl) {
    const full = CACHE_PREFIX + key;
    const rec = JSON.stringify({ at: Date.now(), ttl: ttl || CACHE_TTL_MS, value });
    memCache[full] = rec;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(full, rec); } catch (e) { /* 配额满则只留内存 */ }
    }
  }
  function clearCache() {
    Object.keys(memCache).forEach((k) => delete memCache[k]);
    if (typeof localStorage !== 'undefined') {
      try {
        Object.keys(localStorage)
          .filter((k) => k.indexOf(CACHE_PREFIX) === 0)
          .forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* ignore */ }
    }
  }

  // ------------------------------------------------------------- 请求
  async function jget(url, { timeout = 12000, headers = {} } = {}) {
    let ctl = null, timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctl = new AbortController();
        timer = setTimeout(() => ctl.abort(), timeout);
      }
      const r = await fetch(url, {
        headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers),
        signal: ctl ? ctl.signal : undefined,
      });
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null, error: String((e && e.message) || e) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------- GoPlus
  /** EVM 合约安全 + 持有人。address 需为 0x 开头。 */
  async function goplusEVM(chainId, address) {
    const id = GP_CHAIN[chainId];
    if (!id) return { supported: false };
    const r = await jget(`${GP}/api/v1/token_security/${id}?contract_addresses=${encodeURIComponent(address)}`);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const key = String(address).toLowerCase();
    const o = (r.body && r.body.result && r.body.result[key]) || null;
    if (!o) return { ok: true, found: false };
    return { ok: true, found: true, raw: o };
  }

  /** Solana 合约安全 + 持有人 */
  async function goplusSolana(address) {
    const r = await jget(`${GP}/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(address)}`);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const o = (r.body && r.body.result && r.body.result[address]) ||
              (r.body && r.body.result && r.body.result[String(address)]) || null;
    if (!o) return { ok: true, found: false };
    return { ok: true, found: true, raw: o };
  }

  /** 把 GoPlus 返回压成统一字段（percent 已归一为 0-100） */
  function normalizeGoplus(g, isSolana) {
    if (!g || !g.found) return null;
    const o = g.raw;
    const holders = Array.isArray(o.holders) ? o.holders : [];
    const lp = Array.isArray(o.lp_holders) ? o.lp_holders : [];

    const pcts = holders.map((h) => toPct(h.percent)).sort((a, b) => b - a);
    const top10Pct = round2(pcts.slice(0, 10).reduce((s, v) => s + v, 0));
    const top1Pct = round2(pcts[0] || 0);

    let lpLockedPct = 0, lpBurnPct = 0;
    lp.forEach((h) => {
      const p = toPct(h.percent);
      const addr = String(h.address || '').toLowerCase();
      if (flag(h.is_locked)) lpLockedPct += p;
      else if (BURN[addr]) lpBurnPct += p;
    });
    lpLockedPct = round2(Math.min(100, lpLockedPct + lpBurnPct));

    if (isSolana) {
      const st = (x) => (x && typeof x === 'object' ? flag(x.status) : flag(x));
      const feeRaw = o.transfer_fee && typeof o.transfer_fee === 'object' ? o.transfer_fee : {};
      return {
        source: 'goplus-solana',
        openSource: true,                     // Solana 上不适用「开源」，一律视为可读
        proxy: false,
        mintable: st(o.mintable),
        freezable: st(o.freezable),
        closable: st(o.closable),
        metadataMutable: st(o.metadata_mutable),
        balanceMutableAuth: st(o.balance_mutable_authority),
        transferHook: flag(o.transfer_hook && o.transfer_hook.status) || (Array.isArray(o.transfer_hook) && o.transfer_hook.length > 0),
        nonTransferable: flag(o.non_transferable),
        transferFeePct: round2(num(feeRaw.fee_rate, num(feeRaw.current_fee, 0)) * (num(feeRaw.fee_rate, 0) <= 1 ? 100 : 1)),
        trusted: num(o.trusted_token, 0) > 0,
        canTakeBackOwnership: false,
        ownerChangeBalance: false,
        hiddenOwner: false,
        selfDestruct: false,
        transferPausable: false,
        slippageModifiable: false,
        tradingCooldown: false,
        blacklistable: false,
        antiWhale: false,
        honeypot: false,
        buyTax: 0, sellTax: 0, cannotSellAll: false, cannotBuy: false,
        sameCreatorHoneypot: 0,
        creatorPct: 0, ownerPct: 0,
        ownerAddress: '',
        creatorAddress: (Array.isArray(o.creators) && o.creators[0]
          ? (o.creators[0].address || String(o.creators[0])) : ''),
        // Solana 侧 GoPlus 返回的是「该权限当前是否仍然有效」，本身就是最终状态，
        // 不需要再做「owner 是否放弃」的二次判断。
        ownerRenounced: true,
        holderCount: num(o.holder_count, 0),
        top10Pct, top1Pct,
        lpLockedPct, lpHolderCount: lp.length,
        topHolders: holders.slice(0, 10).map((h) => ({
          address: h.account || h.address || '',
          pct: round2(toPct(h.percent)),
          isContract: flag(h.is_contract),
          isLocked: flag(h.is_locked),
          tag: h.tag || '',
        })),
      };
    }

    return {
      source: 'goplus',
      openSource: flag(o.is_open_source),
      proxy: flag(o.is_proxy),
      mintable: flag(o.is_mintable),
      freezable: false,
      closable: false,
      metadataMutable: false,
      balanceMutableAuth: false,
      transferHook: false,
      nonTransferable: false,
      transferFeePct: 0,
      trusted: false,
      canTakeBackOwnership: flag(o.can_take_back_ownership),
      ownerChangeBalance: flag(o.owner_change_balance),
      hiddenOwner: flag(o.hidden_owner),
      selfDestruct: flag(o.selfdestruct),
      transferPausable: flag(o.transfer_pausable),
      slippageModifiable: flag(o.slippage_modifiable),
      tradingCooldown: flag(o.trading_cooldown),
      blacklistable: flag(o.is_blacklisted),
      antiWhale: flag(o.is_anti_whale),
      honeypot: flag(o.is_honeypot),
      buyTax: round2(num(o.buy_tax, 0) * 100),
      sellTax: round2(num(o.sell_tax, 0) * 100),
      cannotSellAll: flag(o.cannot_sell_all),
      cannotBuy: flag(o.cannot_buy),
      sameCreatorHoneypot: num(o.honeypot_with_same_creator, 0),
      creatorPct: round2(toPct(o.creator_percent)),
      ownerPct: round2(toPct(o.owner_percent)),
      ownerAddress: o.owner_address || '',
      creatorAddress: o.creator_address || '',
      // 「合约里有后门函数」和「有人能调用后门函数」是两件事。owner 已打到黑洞地址
      // 说明所有权已放弃，owner 类风险实际不可触发，判定时必须据此降级。
      ownerRenounced: isBurn(o.owner_address),
      holderCount: num(o.holder_count, 0),
      top10Pct, top1Pct,
      lpLockedPct, lpHolderCount: num(o.lp_holder_count, lp.length),
      isInCex: flag(o.is_in_cex),
      dexCount: Array.isArray(o.dex) ? o.dex.length : 0,
      topHolders: holders.slice(0, 10).map((h) => ({
        address: h.address || '',
        pct: round2(toPct(h.percent)),
        isContract: flag(h.is_contract),
        isLocked: flag(h.is_locked),
        tag: h.tag || '',
      })),
    };
  }

  // ------------------------------------------------------------- honeypot.is
  /** 真实买卖模拟。比 GoPlus 的静态标志更接近真机行为。 */
  async function honeypotIs(chainId, address) {
    const id = HP_CHAIN[chainId];
    if (!id) return { supported: false };
    const r = await jget(`${HP}/v2/IsHoneypot?address=${encodeURIComponent(address)}&chainID=${id}`);
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const d = r.body || {};
    const sim = d.simulationResult || {};
    const ana = d.holderAnalysis || {};
    return {
      ok: true,
      found: !!(d.token || d.honeypotResult),
      honeypot: !!(d.honeypotResult && d.honeypotResult.isHoneypot),
      risk: (d.summary && d.summary.risk) || '',
      riskLevel: num(d.summary && d.summary.riskLevel, 0),
      flags: Array.isArray(d.flags) ? d.flags : [],
      buyTax: round2(num(sim.buyTax, 0)),
      sellTax: round2(num(sim.sellTax, 0)),
      transferTax: round2(num(sim.transferTax, 0)),
      simulationSuccess: d.simulationSuccess !== false,
      openSource: !!(d.contractCode && d.contractCode.openSource),
      proxy: !!(d.contractCode && d.contractCode.isProxy),
      holderTotal: num(ana.holders, 0),
      snipersSuccess: num(ana.snipersSuccess, 0),
      highTaxWallets: num(ana.highTaxWallets, 0),
      totalHolders: num(d.token && d.token.totalHolders, 0),
    };
  }

  // ------------------------------------------------------------- RugCheck
  /** 轻量摘要（几百字节）。risks 与 LP 锁定率足够做安全判定。 */
  async function rugcheckSummary(mint) {
    const r = await jget(`${RC}/v1/tokens/${encodeURIComponent(mint)}/report/summary`, { timeout: 10000 });
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const d = r.body || {};
    return {
      ok: true,
      found: !!(d.tokenProgram || d.risks),
      risks: (Array.isArray(d.risks) ? d.risks : []).map((x) => ({
        name: x.name || '', level: x.level || '', score: num(x.score, 0), description: x.description || '',
      })),
      score: num(d.score, 0),
      scoreNormalised: num(d.score_normalised, 0),
      lpLockedPct: round2(num(d.lpLockedPct, 0)),
      tokenType: d.tokenType || '',
    };
  }

  /** 全量报告（可达 2 MB）。只在用户主动深检单个标的时调用，用于 insider 网络。 */
  async function rugcheckFull(mint) {
    const key = 'rcfull:' + mint;
    const hit = cacheGet(key);
    if (hit) return hit;
    const r = await jget(`${RC}/v1/tokens/${encodeURIComponent(mint)}/report`, { timeout: 20000 });
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    const d = r.body || {};
    const th = Array.isArray(d.topHolders) ? d.topHolders : [];
    // LP 锁定率分散在每个市场里，取最大值代表该代币最好的那个池子
    const markets = Array.isArray(d.markets) ? d.markets : [];
    let lpLockedPctMax = 0, lpLockedUsdMax = 0, marketCount = 0;
    markets.forEach((m) => {
      const lp = m && m.lp;
      if (!lp) return;
      marketCount++;
      const p = num(lp.lpLockedPct, 0);
      if (p > lpLockedPctMax) { lpLockedPctMax = p; lpLockedUsdMax = num(lp.lpLockedUSD, 0); }
    });
    const out = {
      ok: true,
      found: !!d.mint,
      creator: d.creator || '',
      creatorBalance: num(d.creatorBalance, 0),
      creatorTokens: Array.isArray(d.creatorTokens) ? d.creatorTokens.length : 0,
      mintAuthority: d.mintAuthority || null,
      freezeAuthority: d.freezeAuthority || null,
      rugged: d.rugged === true,
      graphInsidersDetected: num(d.graphInsidersDetected, 0),
      insiderNetworks: Array.isArray(d.insiderNetworks) ? d.insiderNetworks.length : 0,
      insiderPct: round2(th.filter((h) => h.insider).reduce((s, h) => s + num(h.pct, 0), 0)),
      totalHolders: num(d.totalHolders, 0),
      totalLPProviders: num(d.totalLPProviders, 0),
      totalMarketLiquidity: num(d.totalMarketLiquidity, 0),
      marketCount,
      lpLockedPctMax: round2(lpLockedPctMax),
      lpLockedUsdMax: Math.round(lpLockedUsdMax),
      launchpad: d.launchpad || null,
      deployPlatform: d.deployPlatform || '',
      lockerCount: d.lockers && typeof d.lockers === 'object' ? Object.keys(d.lockers).length : 0,
      risks: (Array.isArray(d.risks) ? d.risks : []).map((x) => ({
        name: x.name || '', level: x.level || '', score: num(x.score, 0),
      })),
      topHolders: th.slice(0, 20).map((h) => ({
        address: h.address || '', pct: round2(num(h.pct, 0)),
        insider: h.insider === true, owner: h.owner || '',
      })),
    };
    cacheSet(key, out, FULL_TTL_MS);
    return out;
  }

  // ------------------------------------------------------------- 仿盘识别
  /**
   * 同符号碰撞检测。
   * 思路：用符号检索全市场，如果存在同符号但体量大 50 倍以上的标的，基本可判定为仿盘；
   * 同符号池子越多，说明这个符号已经被仿烂，识别时越要保守。
   * 纯数据驱动，不维护「知名符号白名单」，避免名单过期。
   */
  async function copycatScan(symbol, selfFdv, selfAddress) {
    const sym = String(symbol || '').trim();
    if (!sym || sym.length < 2) return { checked: false, reason: '符号过短' };
    const key = 'cc:' + sym.toUpperCase();
    const hit = cacheGet(key);
    if (hit) return Object.assign({}, hit, { cached: true });

    const r = await jget(`${DEX}/latest/dex/search?q=${encodeURIComponent(sym)}`, { timeout: 12000 });
    if (!r.ok || !r.body || !Array.isArray(r.body.pairs)) {
      return { checked: false, reason: '检索失败', status: r.status };
    }
    const up = sym.toUpperCase();
    const self = String(selfAddress || '').toLowerCase();
    const same = r.body.pairs.filter((p) => {
      const s = ((p.baseToken && p.baseToken.symbol) || '').toUpperCase();
      return s === up;
    });

    // 按 FDV 聚合到代币维度
    const byTok = {};
    same.forEach((p) => {
      const addr = ((p.baseToken && p.baseToken.address) || '').toLowerCase();
      if (!addr) return;
      const fdv = num(p.fdv, 0) || num(p.marketCap, 0);
      const liq = num(p.liquidity && p.liquidity.usd, 0);
      const vol = num(p.volume && p.volume.h24, 0);
      const cur = byTok[addr];
      if (!cur || fdv > cur.fdv) {
        byTok[addr] = {
          address: addr, chainId: p.chainId || '', fdv,
          liq: Math.max(liq, cur ? cur.liq : 0),
          vol: Math.max(vol, cur ? cur.vol : 0),
          createdAt: num(p.pairCreatedAt, 0),
        };
      }
    });

    const list = Object.keys(byTok).map((k) => byTok[k]).sort((a, b) => b.fdv - a.fdv);
    const leader = list[0] || null;
    const mine = self ? byTok[self] || null : null;
    // 自己的体量口径优先级：按精确地址在检索结果里查到的 > 调用方传入的。
    // 传进来的 fdv 可能来自另一条链或更早的快照，用它去比会把自己的龙头误判成仿盘。
    const myFdv = (mine && mine.fdv > 0) ? mine.fdv : num(selfFdv, 0);

    const out = {
      checked: true,
      symbol: up,
      tokenCount: list.length,
      poolCount: same.length,
      leader: leader ? { address: leader.address, chainId: leader.chainId, fdv: leader.fdv, liq: leader.liq } : null,
      selfFdv: myFdv,
      selfIsLeader: !!(mine && leader && mine.address === leader.address),
      ratio: leader && myFdv > 0 ? Math.round((leader.fdv / myFdv) * 10) / 10 : 0,
      isCopycat: false,
      crowded: list.length >= 8,
      list: list.slice(0, 6),
    };
    // 判定：存在更大 50 倍的同符号标的，且自己不是那个龙头，且体量口径可靠。
    if (leader && myFdv > 0 && !out.selfIsLeader) {
      out.isCopycat = leader.fdv > myFdv * 50;
    }
    cacheSet(key, out, CACHE_TTL_MS);
    return out;
  }

  // ------------------------------------------------------------- 编排
  /**
   * 取一个标的的全部安全与筹码数据。
   * @param {{chainId:string, tokenAddress:string, symbol?:string, fdv?:number}} t
   * @param {{deep?:boolean, log?:Function}} [opts]
   */
  async function fetchSecurity(t, opts) {
    opts = opts || {};
    const chainId = t.chainId;
    const address = t.tokenAddress || t.address;
    if (!chainId || !address) return { ok: false, error: '缺少 chainId 或 tokenAddress' };

    const isSolana = chainId === 'solana';
    const key = 'sec:' + chainId + ':' + String(address).toLowerCase() + (opts.deep ? ':deep' : '');
    const hit = cacheGet(key);
    if (hit) return Object.assign({}, hit, { cached: true });

    const out = {
      ok: true,
      chainId,
      tokenAddress: address,
      // 池子地址：它持有的代币是 AMM 储备，不是某个人的筹码，
      // 算集中度时必须剔除，否则每个新池的前十大都会虚高到 60% 以上。
      pairAddress: t.pairAddress || '',
      isSolana,
      at: Date.now(),
      sources: [],
      contract: null,
      holders: null,
      rug: null,
      copycat: null,
      penalties: [],
      gaps: [],
    };

    // --- 合约安全
    try {
      const g = isSolana ? await goplusSolana(address) : await goplusEVM(chainId, address);
      if (g.supported === false) {
        out.gaps.push('GoPlus 未覆盖 ' + chainId + '，合约安全检查缺失');
      } else if (g.ok && g.found) {
        out.contract = normalizeGoplus(g, isSolana);
        out.contract.holders = {
          count: out.contract.holderCount,
          top10Pct: out.contract.top10Pct,
          top1Pct: out.contract.top1Pct,
          lpLockedPct: out.contract.lpLockedPct,
          lpHolderCount: out.contract.lpHolderCount,
          creatorPct: out.contract.creatorPct,
          ownerPct: out.contract.ownerPct,
        };
        out.sources.push(out.contract.source);
      } else if (g.ok && !g.found) {
        out.gaps.push('GoPlus 未收录该合约，安全检查缺失');
      } else {
        out.gaps.push('GoPlus 请求失败：' + (g.error || ('HTTP ' + g.status)));
      }
    } catch (e) { out.gaps.push('GoPlus 异常：' + String(e && e.message || e)); }

    // --- 蜜罐模拟（EVM）
    if (!isSolana) {
      try {
        const h = await honeypotIs(chainId, address);
        if (h.supported === false) {
          out.gaps.push('honeypot.is 未覆盖 ' + chainId + '，蜜罐模拟缺失');
        } else if (h.ok && h.found) {
          out.honeypot = h;
          out.sources.push('honeypot.is');
          // 模拟结果优先于静态标志：静态标志只能说「有该函数」，无法说明是否真的会触发
          if (out.contract) {
            if (h.honeypot) out.contract.honeypot = true;
            if (h.simulationSuccess) {
              out.contract.buyTax = Math.max(out.contract.buyTax, h.buyTax);
              out.contract.sellTax = Math.max(out.contract.sellTax, h.sellTax);
              out.contract.simulated = true;
            }
            if (h.openSource) out.contract.openSource = true;
          }
        } else if (!h.ok) {
          out.gaps.push('honeypot.is 请求失败：' + (h.error || ('HTTP ' + h.status)));
        }
      } catch (e) { out.gaps.push('honeypot.is 异常：' + String(e && e.message || e)); }
      await sleep(120);
    }

    // --- Solana：RugCheck 才是权威源
    // 实测 GoPlus 对 Solana 新币不返回持有人分布（holder_count 为 undefined、holders 为空），
    // 而筹码维度离不开持有人数据，所以这里直接取 RugCheck 全量报告：它同时给出前 20 持有人、
    // insider 标记、逐市场 LP 锁定率、发行方与冻结权限，一份顶三份。
    // 代价是单币响应可达 2 MB 以上，因此只对用户主动关注的标的调用，并长缓存。
    if (isSolana) {
      try {
        const f = await rugcheckFull(address);
        if (f.ok && f.found) {
          out.rug = {
            source: 'rugcheck',
            score: f.score, scoreNormalised: f.scoreNormalised,
            risks: f.risks, lpLockedPct: f.lpLockedPctMax,
            rugged: f.rugged, mintAuthority: f.mintAuthority, freezeAuthority: f.freezeAuthority,
          };
          out.rugFull = f;
          out.sources.push('rugcheck');
          if (out.contract) {
            if (f.mintAuthority) out.contract.mintable = true;
            if (f.freezeAuthority) out.contract.freezable = true;
            if (f.rugged) out.contract.rugged = true;
            if (f.launchpad) out.contract.launchpad = f.launchpad;
            out.contract.lpLockedPct = Math.max(num(out.contract.lpLockedPct, 0), num(f.lpLockedPctMax, 0));
          }
          // GoPlus 没给持有人时，用 RugCheck 的补上
          if (out.contract && !num(out.contract.holderCount, 0) && num(f.totalHolders, 0) > 0) {
            const th = Array.isArray(f.topHolders) ? f.topHolders : [];
            const t10 = round2(th.slice(0, 10).reduce((s, h) => s + num(h.pct, 0), 0));
            const t1 = round2(num(th[0] && th[0].pct, 0));
            out.contract.holderCount = f.totalHolders;
            out.contract.top10Pct = t10;
            out.contract.top1Pct = t1;
            out.contract.topHolders = th.map((h) => ({
              address: h.address || '', pct: round2(num(h.pct, 0)),
              isContract: false, isLocked: false, insider: h.insider === true,
            }));
            out.contract.holders = {
              count: f.totalHolders, top10Pct: t10, top1Pct: t1,
              lpLockedPct: num(f.lpLockedPctMax, 0), lpHolderCount: num(f.totalLPProviders, 0),
              creatorPct: 0, ownerPct: 0,
            };
            out.contract.holderSource = 'rugcheck';
          } else if (out.contract && out.contract.holderCount > 0) {
            out.contract.holderSource = 'goplus';
          }
        } else if (!f.ok) {
          out.gaps.push('RugCheck 报告失败：' + (f.error || ('HTTP ' + f.status)));
        } else {
          out.gaps.push('RugCheck 未收录该合约，筹码数据缺失');
        }
      } catch (e) { out.gaps.push('RugCheck 异常：' + String((e && e.message) || e)); }
    }

    // --- 仿盘
    try {
      const cc = await copycatScan(t.symbol, t.fdv, address);
      out.copycat = cc;
      if (cc.checked) out.sources.push('dexscreener-search');
      else if (cc.reason) out.gaps.push('仿盘检测未执行：' + cc.reason);
    } catch (e) { out.gaps.push('仿盘检测异常：' + String(e && e.message || e)); }

    // 只要有一条通道成功，就认为体检有效
    out.ok = out.sources.length > 0;
    if (!out.ok) out.error = out.gaps.join('；') || '所有安全数据源均不可用';
    cacheSet(key, out, opts.deep ? FULL_TTL_MS : CACHE_TTL_MS);
    return out;
  }

  return {
    CACHE_TTL_MS,
    FULL_TTL_MS,
    CACHE_PREFIX,
    GP_CHAIN,
    HP_CHAIN,
    BURN,
    jget,
    sleep,
    goplusEVM,
    goplusSolana,
    honeypotIs,
    rugcheckSummary,
    rugcheckFull,
    copycatScan,
    fetchSecurity,
    clearCache,
    cacheGet,
    cacheSet,
  };
});
