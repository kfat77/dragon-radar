'use strict';
/**
 * 静态站点冒烟测试（GitHub Pages 产物）
 *
 *   node test/static.smoke.js
 *
 * 做法：把 docs/ 里构建出来的那一整套脚本（lib + engine + api-static + app）
 * 按 index.html 的顺序在 jsdom 里跑起来，fetch 换成假行情，不需要后端、不需要网络。
 * 断言的是「真正会部署上去的那份产物」能不能自己扫描、自己算分、自己渲染。
 *
 * 需要 jsdom（devDependencies，可选）：
 *   npm i -D jsdom     或设 WB_NODE_MODULES 指向已有 node_modules
 */
const fs = require('fs');
const path = require('path');

function loadJsdom() {
  const candidates = [
    process.env.WB_NODE_MODULES,
    path.join(__dirname, '..', 'node_modules'),
    'C:/Users/22617/.workbuddy/binaries/node/workspace/node_modules',
  ].filter(Boolean);
  for (const base of candidates) {
    try { return require(path.join(base, 'jsdom')); } catch { /* 换下一个 */ }
  }
  try { return require('jsdom'); } catch { /* 全都没有 */ }
  console.error('缺少 jsdom。请执行： npm i -D jsdom');
  process.exit(2);
}

const { JSDOM, VirtualConsole } = loadJsdom();

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

if (!fs.existsSync(path.join(DOCS, 'index.html'))) {
  console.error('docs/index.html 不存在，请先执行： npm run build:static');
  process.exit(2);
}

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  OK ' + name);
  else { console.error('  FAIL ' + name + (extra ? ' \u2192 ' + extra : '')); fails++; }
};

// ------------------------------------------------------------- 假行情（12 个标的，4 条链）
const SYMS = [
  ['solana', 'DRGN', '龙', 300000, 420000, 2.4, 18.0, 55.0, 120.0],
  ['solana', 'PEPE2', '青蛙', 90000, 180000, 1.1, 6.0, 22.0, 60.0],
  ['solana', 'BONKX', '狗', 60000, 95000, 0.4, 2.0, 8.0, 24.0],
  ['base', 'MOONC', '月', 150000, 260000, 3.1, 9.5, 31.0, 78.0],
  ['base', 'AIBOT', 'AI', 210000, 300000, 1.8, 14.0, 44.0, 96.0],
  ['base', 'WAGMI', '信仰', 45000, 52000, -0.6, -2.4, -6.0, -14.0],
  ['bsc', 'KINGZ', '王', 130000, 240000, 2.2, 11.0, 26.0, 65.0],
  ['bsc', 'CHILL', '躺', 52000, 64000, 0.2, 1.1, 3.0, 9.0],
  ['bsc', 'FROGY', '蛙', 78000, 120000, 1.5, 7.5, 19.0, 41.0],
  ['ethereum', 'GOLDM', '金', 260000, 380000, 0.9, 5.5, 17.0, 38.0],
  ['ethereum', 'BABYX', '宝', 34000, 40000, -1.2, -4.0, -11.0, -26.0],
  ['ethereum', 'WOJAK', '悲', 70000, 110000, 1.0, 4.0, 12.0, 28.0],
];

const boosts = SYMS.map(([chain, sym], i) => ({
  chainId: chain,
  tokenAddress: '0x' + sym.padEnd(38, '0') + i,
  totalAmount: 100 + i * 10,
}));

function pair([chain, sym, name, liq, vol, m5, h1, h6, h24], i) {
  const addr = '0x' + sym.padEnd(38, '0') + i;
  const buys = 20 + (i % 7) * 11;
  const sells = 8 + (i % 5) * 6;
  return {
    chainId: chain,
    dexId: chain === 'solana' ? 'raydium' : 'uniswap',
    pairAddress: 'PAIR' + sym,
    url: 'https://dexscreener.com/' + chain + '/' + addr,
    baseToken: { address: addr, symbol: sym, name: name + ' Token' },
    quoteToken: { address: 'Q', symbol: chain === 'solana' ? 'USDC' : 'WETH' },
    priceUsd: String(0.001 + i * 0.004),
    priceNative: '0.000001',
    txns: { m5: { buys, sells }, h1: { buys: buys * 8, sells: sells * 8 }, h6: {}, h24: {} },
    volume: { h24: vol, h6: Math.round(vol * 0.55), h1: Math.round(vol * 0.2), m5: Math.round(vol * 0.03) },
    priceChange: { m5, h1, h6, h24 },
    liquidity: { usd: liq, base: 1e9, quote: 1e5 },
    fdv: liq * 8,
    marketCap: liq * 8,
    pairCreatedAt: Date.now() - (2 + i) * 3600 * 1000,
    info: i % 3 === 0
      ? { imageUrl: 'https://example.invalid/' + sym + '.png', socials: [{ type: 'twitter', url: 'https://x.example.invalid/' + sym }], websites: [{ url: 'https://' + sym.toLowerCase() + '.example.invalid' }] }
      : {},
  };
}

const byAddr = {};
SYMS.forEach((s, i) => { byAddr[s[1]] = [pair(s, i)]; });

// ------------------------------------------------------------- 假风控接口
// 四维体检要调 GoPlus / honeypot.is / RugCheck。这里造出「干净合约」的应答，
// 目的是验证「浏览器端能不能把这三个源串起来并渲染出结论」，不是验证风控本身。
const addrToSym = {};
SYMS.forEach((s, i) => { addrToSym[('0x' + s[1].padEnd(38, '0') + i).toLowerCase()] = s[1]; });
const pairOf = (sym) => 'PAIR' + sym;
// 这个符号的合约在 GoPlus 里查不到，用来覆盖「风控源未收录」这条缺数据路径
const NO_DATA_SYM = 'WOJAK';

// EVM：GoPlus 的 percent 是 0-1 小数；holder_count 必须是字符串
function goplusEvmPayload(a) {
  const sym = addrToSym[a] || '';
  // 风控源完全没收录该合约：用来验证「缺数据」那条路径不会把结论印成 undefined / 0。
  if (sym === NO_DATA_SYM) return { code: 1, result: {} };
  return {
    code: 1,
    result: {
      [a]: {
        is_open_source: '1', is_proxy: '0', is_mintable: '0',
        owner_address: '0x000000000000000000000000000000000000dead',
        can_take_back_ownership: '0', owner_change_balance: '0', hidden_owner: '0',
        selfdestruct: '0', transfer_pausable: '0', slippage_modifiable: '0',
        trading_cooldown: '0', is_blacklisted: '0', is_anti_whale: '0',
        is_honeypot: '0', buy_tax: '0', sell_tax: '0',
        cannot_sell_all: '0', cannot_buy: '0', honeypot_with_same_creator: '0',
        creator_percent: '0', owner_percent: '0',
        holder_count: '4200', lp_holder_count: '1', is_in_cex: '0',
        holders: [
          // 池子储备与销毁量都必须被剔除，否则前十大占比会虚高
          { address: pairOf(sym), percent: '0.42', is_contract: '1' },
          { address: '0x000000000000000000000000000000000000dead', percent: '0.06' },
          { address: '0xaaa1', percent: '0.05' },
          { address: '0xaaa2', percent: '0.04' },
          { address: '0xaaa3', percent: '0.03' },
          { address: '0xaaa4', percent: '0.03' },
          { address: '0xaaa5', percent: '0.02' },
          { address: '0xaaa6', percent: '0.02' },
          { address: '0xaaa7', percent: '0.02' },
        ],
        lp_holders: [{ address: '0xlp1', percent: '0.95', is_locked: '1' }],
        dex: [{ id: 'uniswap' }],
      },
    },
  };
}

// Solana：GoPlus 对新币不返回持有人（holder_count 缺失、holders 为空），必须由 RugCheck 补上
function goplusSolPayload(a) {
  return {
    code: 1,
    result: {
      [a]: {
        mintable: { status: '0' }, freezable: { status: '0' }, closable: { status: '0' },
        metadata_mutable: { status: '0' }, balance_mutable_authority: { status: '0' },
        transfer_hook: { status: '0' }, non_transferable: '0',
        trusted_token: '0', creators: [{ address: 'DEVx' }],
        holder_count: undefined, holders: [],
      },
    },
  };
}

function rugcheckPayload() {
  const pool = pairOf('DRGN');
  // 另一个市场的池子。它只会出现在 markets[].pubkey 里，DexScreener 的 pairAddress 是另一个，
  // 所以这一条专门用来锁住「不能只认 DexScreener 那一个池子」。
  const otherPool = 'RaydiumOtherPool1111111111111111111111111';
  const th = [
    // Solana 上前排给的是代币账户地址，owner 才是池子。只比 address 会把这个
    // 40% 的池子储备当成巨鲸，把刚开盘的池子直接判死。
    { address: 'ReserveAcct1', pct: 40, owner: pool, insider: false },
    { address: 'ReserveAcct2', pct: 6, owner: otherPool, insider: false },
    { address: 'a1', pct: 4 }, { address: 'a2', pct: 3 }, { address: 'a3', pct: 3 },
    { address: 'a4', pct: 2 }, { address: 'a5', pct: 2 }, { address: 'a6', pct: 2 },
    { address: 'a7', pct: 1.5 }, { address: 'a8', pct: 1.5 }, { address: 'a9', pct: 1 },
    { address: 'a10', pct: 1 }, { address: 'a11', pct: 0.5 },
  ];
  return {
    mint: 'mint', creator: 'DEVx', creatorBalance: 0, creatorTokens: [],
    mintAuthority: null, freezeAuthority: null, rugged: false,
    graphInsidersDetected: 0, insiderNetworks: [], totalHolders: 5448,
    totalLPProviders: 12, totalMarketLiquidity: 42000,
    markets: [
      { pubkey: pool, marketType: 'raydium', lp: { lpLockedPct: 92.5, lpLockedUSD: 38850 } },
      { pubkey: otherPool, marketType: 'pump_fun_amm', lp: { lpLockedPct: 40, lpLockedUSD: 2100 } },
    ],
    risks: [], lockers: {}, topHolders: th,
  };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const calledUrls = [];
function fakeFetch(url, opts) {
  const u = String(url);
  calledUrls.push(u);
  if (u.includes('/token-boosts/top/')) return Promise.resolve(response(200, boosts));
  if (u.includes('/token-boosts/latest/')) return Promise.resolve(response(200, []));
  if (u.includes('/token-profiles/latest')) return Promise.resolve(response(200, []));
  if (u.includes('/latest/dex/search')) return Promise.resolve(response(200, { pairs: [] }));
  if (u.includes('/latest/dex/tokens/')) {
    const raw = decodeURIComponent(u.split('/latest/dex/tokens/')[1]);
    const out = [];
    for (const a of raw.split(',')) {
      const sym = (a.match(/0x([A-Z0-9]+?)(0+)\d*$/) || [])[1];
      if (sym && byAddr[sym]) out.push(...byAddr[sym]);
    }
    return Promise.resolve(response(200, { pairs: out }));
  }
  // --- 风控接口
  if (u.includes('api.gopluslabs.io/api/v1/token_security/')) {
    const a = decodeURIComponent((u.match(/contract_addresses=([^&]+)/) || [])[1] || '').toLowerCase();
    return Promise.resolve(response(200, goplusEvmPayload(a)));
  }
  if (u.includes('api.gopluslabs.io/api/v1/solana/token_security')) {
    const a = decodeURIComponent((u.match(/contract_addresses=([^&]+)/) || [])[1] || '');
    return Promise.resolve(response(200, goplusSolPayload(a)));
  }
  if (u.includes('api.honeypot.is/v2/IsHoneypot')) {
    return Promise.resolve(response(200, {
      token: { name: 'T', symbol: 'T' },
      honeypotResult: { isHoneypot: false },
      simulationResult: { buyTax: 0, sellTax: 0, transferTax: 0, simulationSuccess: true },
      summary: { risk: 'low', riskLevel: 1 },
      holderAnalysis: { holders: 4200, successful: 4200, failed: 0, sniperWallets: 0 },
      flags: [],
    }));
  }
  if (u.includes('api.rugcheck.xyz') && /\/report\/summary/.test(u)) {
    return Promise.resolve(response(200, { tokenProgram: 'spl-token', risks: [], score: 1, score_normalised: 1, lpLockedPct: 92.5, tokenType: 'spl' }));
  }
  if (u.includes('api.rugcheck.xyz')) return Promise.resolve(response(200, rugcheckPayload()));
  return Promise.resolve(response(404, { error: 'unexpected ' + u }));
}

// ------------------------------------------------------------- 起 jsdom
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { console.error('jsdomError:', e.message); fails++; });
vc.on('error', (m) => { console.error('console.error:', m); fails++; });

const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://example.github.io/dragon-radar/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

window.fetch = fakeFetch;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.scrollTo = () => {};
window.open = () => null;
window.navigator.clipboard = { writeText: () => Promise.resolve() };
window.HTMLCanvasElement.prototype.getContext = function () {
  const noop = () => {};
  const base = {
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: [] }),
    canvas: this,
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^(fillStyle|strokeStyle|lineWidth|lineJoin|lineCap|font|textAlign|textBaseline|globalAlpha)$/.test(k)) return '';
      return noop;
    },
    set() { return true; },
  });
};

const SCRIPTS = ['lib/score.js', 'lib/sources.js', 'lib/security.js', 'lib/checkup.js', 'engine.js', 'api-static.js', 'app.js'];

(async function run() {
  console.log('静态站点冒烟测试（jsdom + docs/ 构建产物）');

  // 1) 按 index.html 的顺序装载
  for (const rel of SCRIPTS) {
    const code = fs.readFileSync(path.join(DOCS, rel), 'utf8');
    window.eval(code);
  }
  ok('docs/lib/score.js 装载出 window.DragonScore', !!window.DragonScore);
  ok('docs/lib/sources.js 装载出 window.DragonSources', !!window.DragonSources);
  ok('docs/lib/security.js 装载出 window.DragonSecurity', !!window.DragonSecurity);
  ok('docs/lib/checkup.js 装载出 window.DragonCheckup', !!window.DragonCheckup);
  ok('docs/engine.js 装载出 window.DragonEngine', !!window.DragonEngine);
  ok('docs/api-static.js 装载出 window.DragonApi', !!window.DragonApi);
  ok('静态模式扫描周期为 60 秒', window.DragonEngine.SCAN_INTERVAL_MS === 60000);

  await new Promise((r) => setTimeout(r, 3200));

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];

  // 2) 引擎真的自己扫出了东西
  const st = window.DragonEngine.state;
  ok('浏览器端引擎完成首轮扫描', st.scanCount >= 1, 'scanCount=' + st.scanCount);
  ok('引擎扫出标的', st.tokens.length > 0, String(st.tokens.length) + ' 个');
  ok('扫描没有报错', !st.error, String(st.error));
  ok('结果写入 localStorage', !!window.localStorage.getItem('dr.static.v1'));
  ok('请求全部打向公开行情接口', calledUrls.length > 0 && calledUrls.every((u) => /api\.dexscreener\.com/.test(u)), calledUrls[0] || '(无请求)');

  // 3) 骨架
  ok('顶部免责提示条存在', !!$('.notice') && /不构成投资建议/.test($('.notice').textContent));
  ok('页头品牌存在', !!$('.brand-mark'));
  ok('Hero 大标题存在', /新池每分钟都在出/.test($('.radar-hero h1').textContent));
  ok('Hero 统计为 4 项胶囊', $$('.radar-stats li').length === 4);
  ok('Hero 统计已填数', $('[data-radar-scanned]').textContent !== '—', $('[data-radar-scanned]').textContent);
  ok('工具条含三组筛选', $$('.radar-toolbar .radar-group').length === 3);
  ok('扫描链 chips 已生成', $$('[data-radar-chains] .radar-chip').length >= 2, String($$('[data-radar-chains] .radar-chip').length));
  ok('筛选器渲染 5 档', $$('[data-radar-filters] .radar-filter').length === 5);

  // 4) 状态行
  ok('状态行已更新', /本轮已完成|正在扫描|出错/.test($('[data-radar-status]').textContent), $('[data-radar-status]').textContent);
  ok('倒计时有内容', /下一轮|已取数|扫描中/.test($('[data-radar-countdown]').textContent), $('[data-radar-countdown]').textContent);
  ok('结论文案已生成', /可看|没有标的进入/.test($('[data-radar-verdict-line]').textContent));
  ok('数据来源说明已生成', /DexScreener/.test($('[data-radar-source]').textContent));

  // 5) 卡片
  ok('雷达卡片已渲染', $$('.radar-card').length >= 8, String($$('.radar-card').length));
  ok('卡片带判定状态色', $$('.radar-card.is-pass, .radar-card.is-review, .radar-card.is-veto, .radar-card.is-unknown').length >= 8);
  ok('卡片含判定徽章', $$('.radar-verdict').length >= 8);
  ok('卡片含指标网格', $$('.radar-metrics dt').length > 40, String($$('.radar-metrics dt').length));
  ok('卡片涨跌着色（红涨/绿跌）', $$('.radar-metrics dd.is-up').length + $$('.radar-metrics dd.is-down').length > 0);
  ok('卡片含龙分条', $$('.radar-bar span').length >= 8);
  ok('卡片含可展开明细', $$('details.radar-checks').length >= 8);
  ok('卡片含标签', $$('.radar-tag').length > 3);
  ok('卡片含操作按钮', $$('.radar-card-actions a, .radar-card-actions button').length >= 8);
  const card0 = $('.radar-card');
  ok('卡片标明报价币种', /USD 报价|原生币报价/.test(card0.textContent));
  ok('卡片带外部链接到 DexScreener', /dexscreener\.com/.test(card0.querySelector('.radar-card-actions a').href));

  // 6) 排序与筛选真的走通适配层
  const solChip = $$('[data-radar-chains] .radar-chip').find((b) => b.textContent.includes('Solana'));
  solChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const chainNow = $$('.radar-card .radar-chain').map((e) => e.textContent.trim());
  ok('切到 Solana 后卡片只剩 Solana', chainNow.length > 0 && chainNow.every((t) => t.includes('Solana')), chainNow.join(','));

  const allChip = $$('[data-radar-chains] .radar-chip')[0];
  allChip.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));

  const search = $('[data-radar-search]');
  search.value = 'WOJAK';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  ok('搜索走通并只命中一个', $$('.radar-card').length === 1 && /WOJAK/.test($('.radar-card').textContent), String($$('.radar-card').length));
  search.value = '';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));

  // 7) 龙虎榜
  $$('.site-nav button').find((b) => b.dataset.view === 'board')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  ok('切到龙虎榜后表格可见', !$('[data-radar-table]').hidden && $('[data-radar-list]').hidden);
  ok('龙虎榜渲染出行', $$('[data-radar-tbody] tr').length >= 8, String($$('[data-radar-tbody] tr').length));
  ok('龙虎榜含涨跌色块', $$('[data-radar-tbody] .chg').length >= 8);
  ok('龙虎榜含龙分迷你条', $$('[data-radar-tbody] .scorecell i em').length >= 8);
  const firstRow = $('[data-radar-tbody] tr');
  firstRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  ok('点击行展开明细', $$('[data-radar-tbody] tr.detail-row').length === 1);
  ok('展开明细含 8 个因子条', $$('[data-radar-tbody] .detail-inner .mini .r').length >= 8, String($$('[data-radar-tbody] .detail-inner .mini .r').length));
  ok('展开明细带免责声明', /不构成投资建议/.test($('.detail-inner').textContent));
  firstRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  ok('再次点击收起明细', $$('[data-radar-tbody] tr.detail-row').length === 0);

  // 8) 追踪页：静态形态必须如实说明拿不到实时持仓
  $$('.site-nav button').find((b) => b.dataset.view === 'track')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  ok('追踪页显示且列表页隐藏', !$('[data-panel="track"]').hidden && $('.radar-board').hidden);
  ok('fomo 名片已渲染', !!$('#fomoBody .fomo-card'));
  ok('静态形态如实提示需要令牌/后端', /服务端代理|登录态|令牌/.test($('#fomoHint').textContent), $('#fomoHint').textContent);
  const og = $('#fomoBody img.ogcard');
  ok('名片图片指向 fomo 官方渲染器', og && /image-renderer\.fomo\.cloud/.test(og.src));
  ok('持仓区显示空态', /暂无持仓/.test($('#posTotal').textContent));

  // 9) 手动刷新这一轮
  $$('.site-nav button').find((b) => b.dataset.view === 'radar')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  const before = st.scanCount;
  $('[data-radar-refresh]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2500));
  ok('点「刷新这一轮」触发新扫描', st.scanCount > before, before + ' -> ' + st.scanCount);
  ok('刷新按钮恢复可点', !$('[data-radar-refresh]').disabled);

  // 10) 模型页
  $$('.site-nav button').find((b) => b.dataset.view === 'model')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  ok('模型页显示', !$('[data-panel="model"]').hidden);
  ok('读法卡片 4 张', $$('.radar-guide-card').length === 4, String($$('.radar-guide-card').length));
  ok('权重表 8 行', $$('#modelBody tr').length >= 8, String($$('#modelBody tr').length));
  ok('分级图例已填充', $$('#gradeList span').length >= 4);
  ok('模型页含免责声明', /不构成投资建议/.test($('[data-panel="model"]').textContent + $('.radar-caveat-card').textContent));
  ok('模型页说明四维体检口径', /综合分 ＝ 安全 ×0\.40 ＋ 筹码 ×0\.30 ＋ 叙事 ×0\.30/.test($('[data-panel="model"]').textContent));

  // 11) 四维体检：点开卡片上的按钮，验证适配层 → 风控接口 → 渲染整条链路
  $$('.site-nav button').find((b) => b.dataset.view === 'radar')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  ok('工具条含总资金输入框（仓位倒推口径）', !!$('[data-radar-capital]') && $('[data-radar-capital]').value === '10000');
  ok('每张卡片都带体检按钮', $$('.radar-card [data-cu-btn]').length >= 8, String($$('.radar-card [data-cu-btn]').length));
  ok('每张卡片都留了体检承载位', $$('.radar-card [data-cu-body]').length >= 8);
  ok('体检面板默认收起', $$('.radar-card .radar-checkup').every((e) => e.hidden));

  // 找一个 EVM 标的（base 链，走 GoPlus + honeypot.is）。
  // 注意：卡片每 5 秒整体重绘一次，任何时刻缓存的 DOM 节点都可能已经被换掉，
  // 所以断言一律按符号在当前文档里重新定位，不能拿住旧节点。
  const cardOf = (sym) => $$('.radar-card').find((c) => {
    const h = c.querySelector('.radar-title h3');
    return h && h.textContent === sym;
  });
  const evmCard0 = $$('.radar-card').find((c) => /Base|Ethereum|BSC|BNB/.test(c.querySelector('.radar-chain').textContent));
  ok('找到 EVM 标的用于体检', !!evmCard0);
  const evmSym = evmCard0.querySelector('.radar-title h3').textContent;
  evmCard0.querySelector('[data-cu-btn]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // 点击后立刻就该展开并给出加载态（cuToggle 在第一个 await 之前同步完成这一步）
  ok('点一下立刻展开并给出加载态',
    !evmCard0.querySelector('[data-cu-body]').hidden
    && /正在调外部风控接口/.test(evmCard0.querySelector('[data-cu-body]').textContent),
    evmCard0.querySelector('[data-cu-body]').textContent.slice(0, 60));

  // 等风控接口回来（GoPlus → honeypot.is 之间还有 120ms 节流）。
  // 骨架屏里也有 .radar-cu-grid，只有真结果才有 .radar-cu-dim，别等错东西。
  const evmPanelOf = () => { const c = cardOf(evmSym); return c && c.querySelector('[data-cu-body]'); };
  for (let i = 0; i < 120 && !(evmPanelOf() && evmPanelOf().querySelector('.radar-cu-dim')); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const evmPanel = evmPanelOf();
  ok('体检结果已渲染出四个维度容器（当前文档内）',
    $$('.radar-card .radar-cu-dim').length >= 3, String($$('.radar-card .radar-cu-dim').length));
  ok('体检含安全维度', /安全 · 合约能不能碰/.test(evmPanel.textContent));
  ok('体检含叙事维度', /叙事 · 故事还传不传得动/.test(evmPanel.textContent));
  ok('体检含筹码维度', /筹码 · 在谁手里/.test(evmPanel.textContent));
  ok('体检含位置维度与仓位', /位置 · 该不该进、该进多少/.test(evmPanel.textContent) && /建议仓位/.test(evmPanel.textContent));
  ok('体检给出结论', /可参与|小仓试错|不追|观察|直接放弃|数据不足/.test(evmPanel.querySelector('.radar-checkup-head').textContent));
  ok('体检标明数据来源', /goplus|honeypot\.is|dexscreener-search/.test(evmPanel.textContent));
  ok('集中度已剔除池子与销毁地址', /剔除池子\/销毁\/锁仓后重算/.test(evmPanel.textContent));
  // 缺数据最容易被印成 undefined / NaN，而它们看起来像结论。两个面板都拦一遍。
  ok('EVM 体检面板不出现 undefined 或 NaN', !/undefined|NaN/.test(evmPanel.textContent));
  ok('体检带重跑按钮', !!evmPanel.querySelector('[data-cu-refresh]'));
  ok('卡片头部挂上四维结论徽标（当前文档内）', !!cardOf(evmSym).querySelector('.radar-cu-badge[data-cu-slot]'));
  ok('体检面板带免责声明', /不构成投资建议/.test(evmPanel.textContent));
  ok('面板跨整轮重绘后仍保持展开', !evmPanel.hidden);
  ok('体检确实调用了外部风控接口',
    calledUrls.some((u) => u.includes('api.gopluslabs.io')) && calledUrls.some((u) => u.includes('api.honeypot.is')),
    calledUrls.filter((u) => /goplus|honeypot/.test(u)).join(' | '));

  // 12) Solana 标：RugCheck 必须补上 GoPlus 缺失的持有人数据
  const solCard0 = $$('.radar-card').find((c) => /Solana/.test(c.querySelector('.radar-chain').textContent));
  ok('找到 Solana 标的用于体检', !!solCard0);
  const solSym = solCard0.querySelector('.radar-title h3').textContent;
  solCard0.querySelector('[data-cu-btn]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const solPanelOf = () => { const c = cardOf(solSym); return c && c.querySelector('[data-cu-body]'); };
  for (let i = 0; i < 120 && !(solPanelOf() && solPanelOf().querySelector('.radar-cu-dim')); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const solPanel = solPanelOf();
  if (!solPanel || !solPanel.querySelector('.radar-cu-dim')) {
    console.error('    [诊断] Solana 相关请求：', calledUrls.filter((u) => /goplus|rugcheck|honeypot/.test(u)).join('\n      '));
  }
  ok('Solana 体检渲染出结果', !!(solPanel && solPanel.querySelector('.radar-cu-dim')), solPanel ? solPanel.textContent.slice(0, 120) : '(无面板)');
  ok('Solana 体检调用 RugCheck', calledUrls.some((u) => u.includes('api.rugcheck.xyz')), '未调用 rugcheck');
  ok('Solana 筹码由 RugCheck 补齐（含持币地址数）', /持币地址 <b>5448<\/b>/.test(solPanel.innerHTML), solPanel.textContent.slice(0, 200));
  ok('Solana 体检标明数据来源含 rugcheck', /rugcheck/.test(solPanel.textContent));
  // Solana 上前排「持有人」给的是代币账户，owner 才是池子。只比 address 会把这个 40% 的
  // 池子储备当成巨鲸，把刚开盘的池子直接判死 —— 这条锁住 owner 维度的剔除确实生效。
  ok('Solana 池子储备账户（owner 命中池子）已剔除并说明',
    /流动性池储备/.test(solPanel.textContent), solPanel.textContent.slice(0, 300));
  ok('集中度按剔除池子储备后重算，且不再据此判致命',
    /剔除池子\/销毁\/锁仓后重算/.test(solPanel.textContent)
      && !/少数地址可以一次性出货/.test(solPanel.textContent));
  ok('Solana 体检面板不出现 undefined 或 NaN', !/undefined|NaN/.test(solPanel.textContent));

  // 14) 风控源完全未收录该合约：缺数据必须写成「未取得」，不能印成
  //     「前十大 undefined%」「抛压 0 倍」这种看起来像结论的东西。
  const ndCard = $$('.radar-card').find((c) => {
    const h = c.querySelector('.radar-title h3');
    return h && h.textContent === NO_DATA_SYM;
  });
  ok('找到风控源未收录的标的用于体检', !!ndCard);
  ndCard.querySelector('[data-cu-btn]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const ndPanelOf = () => { const c = cardOf(NO_DATA_SYM); return c && c.querySelector('[data-cu-body]'); };
  for (let i = 0; i < 120 && !(ndPanelOf() && ndPanelOf().querySelector('.radar-cu-dim')); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const ndPanel = ndPanelOf();
  ok('未收录合约的体检也能渲染出四维', !!(ndPanel && ndPanel.querySelector('.radar-cu-dim')),
    ndPanel ? ndPanel.textContent.slice(0, 120) : '(无面板)');
  ok('缺数据的面板不出现 undefined 或 NaN', !/undefined|NaN/.test(ndPanel.textContent),
    (ndPanel.textContent.match(/[^。]{0,50}(undefined|NaN)[^。]{0,50}/) || [''])[0]);
  ok('缺数据时筹码写明「未取得」而不是留白',
    /前十大集中度：<b class="is-bad">未取得<\/b>/.test(ndPanel.innerHTML));
  ok('缺数据时叙事也不假报「常态」', /未知（未取到成交流水）/.test(ndPanel.textContent));
  ok('缺数据时结论为数据不足', /数据不足/.test(ndPanel.querySelector('.radar-checkup-head').textContent));

  // 13) 改总资金会让下一轮体检按新口径倒推仓位
  const cap = $('[data-radar-capital]');
  cap.value = '50000';
  cap.dispatchEvent(new window.Event('change', { bubbles: true }));
  ok('总资金写回本机存储', window.localStorage.getItem('dr.capital') === '50000');

  console.log(fails ? '\n失败 ' + fails + ' 项' : '\n全部通过');
  window.DragonEngine.stop();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('运行异常：', e); process.exit(1); });
