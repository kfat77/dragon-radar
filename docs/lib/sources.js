/**
 * 数据源层
 *  - DexScreener 公开接口：主数据源（无需 key，限流约 300 次/分钟，响应带 access-control-allow-origin: *)
 *  - GeckoTerminal：机会性补充（免费档限流极紧，约 1 次/15 秒，失败即降级）
 *  - fomo.family：官方接口 prod-api.fomo.family，需 Privy 授权令牌；未授权时返回 needsAuth
 *
 * 同构模块：Node 端 require('./lib/sources')，浏览器端加载后使用 window.DragonSources。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DragonSources = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const UA = 'Mozilla/5.0 (compatible; DragonRadar/1.0)';

const CHAIN_LABEL = {
  solana: 'Solana',
  base: 'Base',
  bsc: 'BNB Chain',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  hyperevm: 'HyperEVM',
  arc: 'Arc',
  robinhood: 'Robinhood',
  abstract: 'Abstract',
  berachain: 'Berachain',
  monad: 'Monad',
  near: 'NEAR',
  sui: 'Sui',
  ton: 'TON',
  avalanche: 'Avalanche',
  blast: 'Blast',
  linea: 'Linea',
  zksync: 'zkSync',
  scroll: 'Scroll',
  sei: 'Sei',
  sonic: 'Sonic',
  plasma: 'Plasma',
  meme: 'Memecore',
  flow: 'Flow',
  pulsechain: 'PulseChain',
  fantom: 'Fantom',
  cronos: 'Cronos',
  moonbeam: 'Moonbeam',
  celo: 'Celo',
  optimism: 'Optimism',
  unichain: 'Unichain',
  worldchain: 'World Chain',
  ink: 'Ink',
};

// 抓龙雷达默认覆盖的链（DexScreener 上龙池最密集的几条）
const DEFAULT_CHAINS = ['solana', 'base', 'bsc', 'ethereum'];

// 用于发现候选池的关键词（每轮轮换，滚动扩样）
const KEYWORDS = [
  'ai', 'meme', 'dog', 'cat', 'pepe', 'trump', 'moon', 'elon',
  'pump', 'bonk', 'wojak', 'frog', 'chill', 'baby', 'gold', 'king',
];

async function jget(url, { timeout = 12000, headers = {}, token = null } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const h = { 'User-Agent': UA, Accept: 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers: h, signal: ctl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: String(e && e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ------------------------------------------------------------- DexScreener
const DEX = 'https://api.dexscreener.com';

async function dexBoosts(kind) {
  const r = await jget(`${DEX}/token-boosts/${kind}/v1`);
  return r.ok && Array.isArray(r.body) ? r.body : [];
}
async function dexProfiles() {
  const r = await jget(`${DEX}/token-profiles/latest/v1`);
  return r.ok && Array.isArray(r.body) ? r.body : [];
}
async function dexSearch(q) {
  const r = await jget(`${DEX}/latest/dex/search?q=${encodeURIComponent(q)}`);
  return r.ok && r.body && Array.isArray(r.body.pairs) ? r.body.pairs : [];
}
/** 批量取代币交易对，地址上限 30 个/次 */
async function dexTokens(addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const r = await jget(`${DEX}/latest/dex/tokens/${chunk.join(',')}`);
    if (r.ok && r.body && Array.isArray(r.body.pairs)) out.push(...r.body.pairs);
    await sleep(120);
  }
  return out;
}
/** 单地址（用于持仓实时报价） */
async function dexToken(address) {
  const r = await jget(`${DEX}/latest/dex/tokens/${address}`);
  const pairs = r.ok && r.body && Array.isArray(r.body.pairs) ? r.body.pairs : [];
  return bestPair(pairs);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- 池子挑选
const STABLE = /^(usd|usdc|usdt|dai|usde|fdusd|busd|usds|susd|pyusd)/i;

function liquidityOf(p) { return (p && p.liquidity && Number(p.liquidity.usd)) || 0; }

/** 同一代币可能有多个池，挑“最有代表性”的那个：有深度优先，其次 24h 成交额 */
function bestPair(pairs) {
  if (!pairs || !pairs.length) return null;
  return pairs.slice().sort((a, b) => {
    const la = liquidityOf(a), lb = liquidityOf(b);
    if (lb !== la) return lb - la;
    const va = (a.volume && a.volume.h24) || 0, vb = (b.volume && b.volume.h24) || 0;
    return vb - va;
  })[0];
}

function isQuoteUsd(p) {
  return !!p && STABLE.test((p.quoteToken && p.quoteToken.symbol) || '');
}

/** 把 DexScreener pair 压成雷达内部结构；与美元／原生币报价都要，价格统一取 priceUsd */
function normalizePair(p, meta = {}) {
  if (!p) return null;
  const t = (p.txns && p.txns.m5) || {};
  return {
    chainId: p.chainId,
    chainLabel: CHAIN_LABEL[p.chainId] || p.chainId,
    dexId: p.dexId,
    pairAddress: p.pairAddress,
    url: p.url,
    symbol: (p.baseToken && p.baseToken.symbol) || '?',
    name: (p.baseToken && p.baseToken.name) || '',
    tokenAddress: (p.baseToken && p.baseToken.address) || '',
    quoteSymbol: (p.quoteToken && p.quoteToken.symbol) || '',
    quoteIsUsd: isQuoteUsd(p),
    priceUsd: Number(p.priceUsd) || 0,
    priceNative: Number(p.priceNative) || 0,
    txns: p.txns || {},
    volume: p.volume || {},
    priceChange: p.priceChange || {},
    liquidityUsd: liquidityOf(p),
    fdv: Number(p.fdv) || 0,
    marketCap: Number(p.marketCap) || 0,
    pairCreatedAt: Number(p.pairCreatedAt) || 0,
    imageUrl: (p.info && p.info.imageUrl) || '',
    headerImage: (p.info && p.info.header) || (p.info && p.info.openGraph) || '',
    websites: (p.info && p.info.websites) || [],
    socials: (p.info && p.info.socials) || [],
    boosted: !!meta.boosted,
    hasProfile: !!meta.hasProfile,
    boostAmount: Number(meta.boostAmount) || 0,
    source: meta.source || 'dexscreener',
    _m5buys: Number(t.buys) || 0,
    _m5sells: Number(t.sells) || 0,
  };
}

// ------------------------------------------------------------- 候选池构池
/**
 * 构建本轮候选池
 * A 官方推广榜（热钱正在喊单）× B 最新代币资料（新池）× C 关键词检索（滚动扩样）× D 用户自选
 * 返回 [{chainId, tokenAddress, meta}]
 */
async function buildUniverse({ keywords = KEYWORDS, keywordCount = 6, extra = [], boosted = true, profiles = true, search = true, log = () => {} } = {}) {
  const cand = new Map();
  const put = (chainId, tokenAddress, meta) => {
    if (!chainId || !tokenAddress) return;
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;
    const old = cand.get(key);
    if (old) Object.assign(old.meta, meta);
    else cand.set(key, { chainId, tokenAddress, meta: { ...meta } });
  };

  if (boosted) {
    for (const kind of ['top', 'latest']) {
      const list = await dexBoosts(kind);
      for (const b of list) put(b.chainId, b.tokenAddress, { boosted: true, boostAmount: b.totalAmount, source: `boost-${kind}` });
    }
    log(`推广榜候选：${cand.size}`);
  }

  if (profiles) {
    const list = await dexProfiles();
    for (const b of list) put(b.chainId, b.tokenAddress, { hasProfile: true, source: 'profile' });
    log(`新代币资料候选：${cand.size}`);
  }

  if (search) {
    const offset = Math.floor(Date.now() / 60000) % Math.max(1, keywords.length);
    const picks = [];
    for (let i = 0; i < keywordCount; i++) picks.push(keywords[(offset + i) % keywords.length]);
    for (const q of picks) {
      const pairs = await dexSearch(q);
      for (const p of pairs) {
        if (liquidityOf(p) < 20000) continue;
        put(p.chainId, p.baseToken && p.baseToken.address, { source: `search:${q}` });
      }
      await sleep(100);
    }
    log(`关键词扩样候选：${cand.size}（词：${picks.join('/')}）`);
  }

  for (const e of extra) {
    if (e && e.chainId && e.tokenAddress) put(e.chainId, e.tokenAddress, { source: e.source || 'watchlist' });
  }

  return [...cand.values()];
}

const NETWORKS = DEFAULT_CHAINS;

/** GeckoTerminal 趋势池（限流极紧，调用方需容忍失败） */
async function gtTrending(network) {
  const r = await jget(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?page=1&include=base_token,quote_token`, { timeout: 10000 });
  if (!r.ok || !r.body || !Array.isArray(r.body.data)) return { ok: false, status: r.status, pools: [] };
  const inc = r.body.included || [];
  const tokOf = (id) => inc.find((x) => x.id === id);
  const pools = r.body.data.map((d) => {
    const a = d.attributes || {};
    const btId = (d.relationships && d.relationships.base_token && d.relationships.base_token.data && d.relationships.base_token.data.id) || '';
    const bt = tokOf(btId);
    return {
      network,
      poolAddress: a.address,
      name: a.name,
      symbol: (bt && bt.attributes && bt.attributes.symbol) || (a.name || '').split('/')[0].trim(),
      tokenAddress: btId.replace(/^[^_]+_/, ''),
      priceUsd: Number(a.base_token_price_usd) || 0,
      fdv: Number(a.fdv_usd) || 0,
      liquidityUsd: Number(a.reserve_in_usd) || 0,
      priceChange: a.price_change_percentage || {},
      volume: a.volume_usd || {},
      txns: a.transactions || {},
      poolCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : 0,
    };
  });
  return { ok: true, pools };
}

// ------------------------------------------------------------- fomo.family
const FOMO_API = 'https://prod-api.fomo.family';

/** 拉取 fomo 用户资料；未提供授权令牌时返回 needsAuth，不伪造数据 */
async function fomoUser(handle, token) {
  if (!token) {
    return {
      ok: false,
      needsAuth: true,
      handle,
      message: 'fomo.family 官方接口需登录态（Privy 授权令牌）才能读取。填入令牌后即可实时拉取该用户的持仓与成交。',
      publicCard: `https://image-renderer.fomo.cloud/og/profile/${encodeURIComponent(handle)}/card.png`,
      profileUrl: `https://fomo.family/profile/${encodeURIComponent(handle)}`,
    };
  }
  const [byHandle, spotlight] = await Promise.all([
    jget(`${FOMO_API}/v2/users/userHandle/${encodeURIComponent(handle)}`, { token, headers: { 'X-Supported-Chains': '1,56,8453,143,4663,5042' } }),
    jget(`${FOMO_API}/v2/users/userHandle/${encodeURIComponent(handle)}/spotlight`, { token }).catch(() => ({ ok: false })),
  ]);
  return {
    ok: byHandle.ok,
    status: byHandle.status,
    needsAuth: byHandle.status === 401 || byHandle.status === 403,
    user: byHandle.ok ? byHandle.body : null,
    spotlight: spotlight && spotlight.ok ? spotlight.body : null,
    message: byHandle.ok ? null : (byHandle.body && (byHandle.body.error || byHandle.body.message)) || `HTTP ${byHandle.status}`,
    profileUrl: `https://fomo.family/profile/${encodeURIComponent(handle)}`,
    publicCard: `https://image-renderer.fomo.cloud/og/profile/${encodeURIComponent(handle)}/card.png`,
  };
}

  return {
    CHAIN_LABEL,
    DEFAULT_CHAINS,
    NETWORKS,
    KEYWORDS,
    jget,
    dexBoosts,
    dexProfiles,
    dexSearch,
    dexTokens,
    dexToken,
    bestPair,
    isQuoteUsd,
    normalizePair,
    liquidityOf,
    buildUniverse,
    gtTrending,
    fomoUser,
  };
});
