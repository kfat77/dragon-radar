'use strict';
/* 抓龙雷达 · 前端（零依赖，原生 DOM + Canvas） */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  view: 'radar',
  chain: 'all',
  mode: 'all',
  sort: 'score',
  filter: 'all',
  q: '',
  minLiq: false,
  auto: true,
  tokens: [],
  meta: null,
  positions: JSON.parse(localStorage.getItem('dr.positions') || '[]'),
  watchlist: [],
  fomoToken: localStorage.getItem('dr.fomoToken') || '',
  // 四维体检里的仓位是「估值」，必须由服务端/引擎按同一个风险预算倒推。这里只存
  // 用户自己的总资金，默认 10000，改一次即写回本机，不发送到任何第三方。
  capital: Number(localStorage.getItem('dr.capital') || 10000) || 10000,
  // 胜率回测的视图选项。默认 1 小时视界：15 分钟噪声最大，6/24 小时要等很久才够样本。
  bt: { horizon: '1h', why: 'all' },
  _chainSig: '',
};

// 分级 → 判定（沿用「可看 / 待复核 / 数据不足 / 别碰」四档语义）
const VERDICT = {
  dragon: { cls: 'pass', label: '真龙' },
  candidate: { cls: 'pass', label: '龙头候选' },
  latent: { cls: 'review', label: '潜龙' },
  watch: { cls: 'unknown', label: '观察' },
  trash: { cls: 'veto', label: '别碰' },
};
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pass', label: '可看' },
  { key: 'review', label: '待复核' },
  { key: 'unknown', label: '数据不足' },
  { key: 'veto', label: '别碰' },
];
const CHAIN_COLOR = { solana: '#7a5bd0', bsc: '#c99a00', base: '#2563c9', ethereum: '#5b6fd6', arbitrum: '#3d7ae0', near: '#4a8f6d', robinhood: '#2f9e6b', arc: '#8a6fd0', polygon: '#8b5cf6' };

// ------------------------------------------------------------ 格式化
const nf = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
function usd(v) {
  v = Number(v) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  if (a >= 1) return '$' + v.toFixed(2);
  if (a >= 0.001) return '$' + v.toFixed(5);
  if (a > 0) return '$' + v.toPrecision(3);
  return '$0';
}
function price(v) {
  v = Number(v) || 0;
  if (v >= 1000) return '$' + nf(v, 2);
  if (v >= 1) return '$' + nf(v, 4);
  if (v >= 0.01) return '$' + v.toFixed(6);
  return '$' + v.toPrecision(4);
}
function chgCls(v) { return v > 0 ? 'is-up' : v < 0 ? 'is-down' : 'is-flat'; }
function chgTxt(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + (Math.abs(v) >= 1000 ? nf(v, 0) : nf(v, 2)) + '%';
}
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.round(s / 60) + ' 分钟前';
  return (s / 3600).toFixed(1) + ' 小时前';
}
function ageStr(min) {
  if (min == null) return '—';
  if (min < 60) return Math.max(0, Math.round(min)) + ' 分钟';
  if (min < 1440) return (min / 60).toFixed(1) + ' 小时';
  return (min / 1440).toFixed(1) + ' 天';
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms);
}

// ------------------------------------------------------------ 数据请求
// 同一份前端代码支持两种运行形态：
//   1) 本地 Node 形态  —— 直接 fetch 本机 server.js 的 /api/*
//   2) 纯静态形态     —— src/static-api.js 注入 window.DragonApi，把同一批
//                        /api/* 路径翻译成浏览器端 DragonEngine 的调用。
// 上层渲染逻辑对两者无感，因此 GitHub Pages 与本地服务出一致的结果。
const ENGINE = (typeof window !== 'undefined' && window.DragonEngine) || null;

async function fetchApi(path, opts) {
  const r = await fetch(path, opts);
  let j = null; try { j = await r.json(); } catch { /* ignore */ }
  return { status: r.status, ok: r.ok, body: j };
}

const api = (typeof window !== 'undefined' && window.DragonApi) || fetchApi;

async function loadMeta() {
  const r = await api('/api/meta');
  if (!r.ok) return;
  store.meta = r.body;
  renderChainChips();
  renderModel(r.body.weights, r.body.grades);
}

function radarUrl() {
  const p = new URLSearchParams({ chain: store.chain, view: store.mode, sort: store.sort, limit: '260' });
  if (store.q) p.set('q', store.q);
  if (store.minLiq) p.set('minLiq', '30000');
  return '/api/radar?' + p.toString();
}

let loading = false;
let repaintQueued = false;
async function refresh() {
  // 扫描结束的通知可能正好撞上一次还在飞的请求，这里排队重绘而不是直接丢掉。
  if (loading) { repaintQueued = true; return; }
  loading = true;
  try {
    const r = await api(radarUrl());
    if (!r.ok || !r.body) { setStatus('接口异常', 'is-error'); return; }
    const b = r.body;
    store.tokens = b.tokens || [];
    if (b.meta) {
      const sig = Object.keys(b.meta.byChainId || {}).sort().join(',');
      if (sig !== store._chainSig) { store._chainSig = sig; store.meta = Object.assign({}, store.meta || {}, { meta: b.meta }); renderChainChips(); }
    }
    renderStats(b);
    renderFilters();
    renderCards();
    renderBoard();
    setStatus(b.error ? ('扫描出错：' + b.error) : b.scanning ? '正在扫描候选池…' : '本轮已完成', b.error ? 'is-error' : b.scanning ? 'is-warn' : '');
    startCountdown(b.updatedAt, b.scanIntervalMs || 60000, b.scanning);
    const s = b.sources || {};
    $('[data-radar-source]').textContent =
      `候选池 ${s.universeSize || 0} 个 → 本轮取到行情 ${s.dexTokensFetched || 0} 个交易对 → 通过质量地板并评分 ${s.poolsScored || 0} 个。`
      + ` 行情源：DexScreener（公开只读接口，未连接钱包）。未通过质量地板（深度 < $8K 或 24h 成交 < $3K）的池子不进入榜单，因为它没有可读性。`;
  } finally {
    loading = false;
    if (repaintQueued) { repaintQueued = false; refresh().catch(() => {}); }
  }
}

// ------------------------------------------------------------ 自检
// 页面长期没数据时，绝大多数情况不是代码问题，而是浏览器发不出跨域请求
// （本地代理挂掉、扩展拦截、DNS 或企业网络策略）。这里在首轮扫描迟迟不返回时，
// 主动探测一次上游端点，把「网络不通」和「只是还没扫完」区分开，直接写在状态行上，
// 用户不必开控制台猜。
const BOOT_STALL_MS = 20000;
let selfCheckDone = false;

async function selfCheck() {
  if (selfCheckDone) return;
  selfCheckDone = true;
  if (store.tokens.length) return;               // 已经有数据，无需自检
  const engineState = ENGINE && ENGINE.state;
  if (engineState && engineState.scanning) {     // 仍在扫描，属正常
    const line = $('[data-radar-countdown]');
    if (line) line.textContent = '首轮扫描仍在进行（拉取十余次公开接口）…';
    selfCheckDone = false;
    setTimeout(selfCheck, BOOT_STALL_MS);
    return;
  }
  let netOk = false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1', { signal: ctl.signal });
    clearTimeout(t);
    netOk = r.ok;
  } catch { netOk = false; }
  if (netOk) {
    setStatus('已连上行情接口，但本轮尚未取到标的。可再等一轮，或点「刷新这一轮」重试。', 'is-warn');
  } else {
    setStatus('无法访问行情接口 api.dexscreener.com：浏览器没能发出跨域请求。'
      + '请检查本机代理是否在运行、浏览器扩展是否拦截，或换一个网络后刷新。代码本身无异常。', 'is-error');
  }
}

function setStatus(text, cls) {
  const p = $('[data-radar-status]');
  p.textContent = text;
  p.className = 'radar-status' + (cls ? ' ' + cls : '');
}

let cdTimer = null;
function startCountdown(updatedAt, intervalMs, scanning) {
  const el = $('[data-radar-countdown]');
  if (cdTimer) clearInterval(cdTimer);
  const tick = () => {
    const passed = Date.now() - updatedAt;
    const left = Math.max(0, Math.round((intervalMs - passed) / 1000));
    el.textContent = scanning ? '扫描中…' : (store.auto ? `下一轮 ${left}s` : `已取数 ${ago(updatedAt)}（自动更新已关）`);
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

// ------------------------------------------------------------ Hero 统计
function renderStats(b) {
  const m = b.meta || {};
  const t = b.tokens || [];
  const pass = t.filter((x) => x.grade === 'dragon' || x.grade === 'candidate').length;
  const burst = t.filter((x) => x.factors.volBurst.raw >= 2).length;
  $('[data-radar-scanned]').textContent = String(b.total || 0);
  $('[data-radar-pass]').textContent = String(pass);
  $('[data-radar-burst]').textContent = String(burst);
  $('[data-radar-updated]').textContent = ago(b.updatedAt);
  $('[data-radar-verdict-line]').textContent = pass
    ? `本轮 ${pass} 个进入「可看」：龙分 ≥ 70 且风险扣分已计入。它们只是值得你自己核一遍，不是可以买。`
    : '本轮没有标的进入「可看」。这通常意味着候选池整体量能不足或深度过浅，空仓也是一种结论。';
}

// ------------------------------------------------------------ chips
function renderChainChips() {
  const box = $('[data-radar-chains]');
  box.innerHTML = '';
  const labels = (store.meta && store.meta.chains) || {};
  const counts = ((store.meta && store.meta.meta) && (store.meta.meta.byChainId || store.meta.meta.byChain)) || {};
  const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const add = (id, label, n) => {
    const b = el('button', 'radar-chip' + (store.chain === id ? ' is-active' : ''));
    b.type = 'button';
    if (id !== 'all') {
      const i = el('i'); i.style.background = CHAIN_COLOR[id] || '#9aa88f'; b.appendChild(i);
    }
    b.appendChild(el('span', null, label));
    if (n != null) b.appendChild(el('b', null, String(n)));
    b.onclick = () => { store.chain = id; renderChainChips(); refresh(); };
    box.appendChild(b);
  };
  add('all', '全部链', null);
  ids.forEach((id) => add(id, labels[id] || id, counts[id]));
}

function renderFilters() {
  const box = $('[data-radar-filters]');
  box.innerHTML = '';
  const counts = { all: 0, pass: 0, review: 0, unknown: 0, veto: 0 };
  for (const t of store.tokens) {
    counts.all++;
    const c = (VERDICT[t.grade] || VERDICT.watch).cls;
    if (counts[c] != null) counts[c]++;
  }
  FILTERS.forEach((f) => {
    const b = el('button', 'radar-filter' + (store.filter === f.key ? ' is-active' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, f.label));
    b.appendChild(el('b', null, String(counts[f.key])));
    b.onclick = () => { store.filter = f.key; renderFilters(); renderCards(); renderBoard(); };
    box.appendChild(b);
  });
}

const visible = () => store.tokens.filter((t) => store.filter === 'all' || (VERDICT[t.grade] || VERDICT.watch).cls === store.filter);

// ------------------------------------------------------------ 卡片
function tagCls(text) {
  if (/爆发|强势|加速|共振|充足|厚实/.test(text)) return ' is-hot';
  if (/偏薄|市值已高|转弱|背离|掉头/.test(text)) return ' is-cool';
  if (/追高|抽池|过少|未成熟|无人接盘|回撤/.test(text)) return ' is-warn';
  return '';
}

function cardHtml(t, i) {
  const v = VERDICT[t.grade] || VERDICT.watch;
  const pc = t.priceChange || {};
  const metric = (k, val, cls) => `<div><dt>${k}</dt><dd class="${cls || ''}">${val}</dd></div>`;
  const factors = (t.factorList || []).map((f) => `
    <li class="radar-check">
      <b>${esc(f.text.split(' ')[0])}</b><span class="radar-check-state">${f.score} ×${f.weight}</span>
      <span class="radar-check-bar"><em style="width:${Math.max(2, Math.min(100, f.score))}%"></em></span>
      <span class="radar-check-note">${esc(f.text)}</span>
    </li>`).join('');
  const risks = (t.riskItems || []).map((r) => `
    <li class="radar-check is-risk"><b>${esc(r.text)}</b><span class="radar-check-state" style="color:#a3381f">−${r.n}</span></li>`).join('');
  const gaps = (t.missing || []).length
    ? `<li class="radar-check"><b>数据缺口（不计为中性）</b><span class="radar-check-state">${t.missing.length} 项</span>
        <span class="radar-check-note">${esc(t.missing.join('；'))}</span></li>`
    : '';

  return `<article class="radar-card is-${v.cls}" style="--i:${Math.min(i, 24)}">
    <div class="radar-card-head">
      <span class="radar-rank">${String(i + 1).padStart(2, '0')}</span>
      ${t.imageUrl
        ? `<img class="radar-avatar" src="${esc(t.imageUrl)}" alt="" loading="lazy" onerror="this.classList.add('is-fallback');this.removeAttribute('src');this.textContent='${esc((t.symbol || '?').slice(0, 2))}'">`
        : `<div class="radar-avatar is-fallback">${esc((t.symbol || '?').slice(0, 2))}</div>`}
      <div class="radar-title">
        <h3>${esc(t.symbol)}</h3>
        <p>
          <span class="radar-chain"><i style="background:${CHAIN_COLOR[t.chainId] || '#9aa88f'}"></i>${esc(t.chainLabel)}</span>
          <span>${esc(t.dexId)}</span><span>池龄 ${esc(ageStr(t.ageMin))}</span>
        </p>
      </div>
      <span class="radar-verdict is-${v.cls}">${esc(v.label)}</span>
    </div>
    <p class="radar-verdict-note">${esc(t.name || '—')} · ${t.quoteIsUsd ? 'USD 报价' : '原生币报价'}${(() => {
      const rep = CU.cache[cuKey(t.chainId, t.tokenAddress)];
      return rep && rep.ok !== false ? ' · ' + cuBadge(rep, null, true) : '';
    })()}</p>
    <div class="radar-tags">${(t.tags || []).slice(0, 5).map((x) => `<span class="radar-tag${tagCls(x)}">${esc(x)}</span>`).join('')}</div>
    <canvas class="radar-spark" data-i="${i}"></canvas>
    <dl class="radar-metrics">
      ${metric('现价', price(t.priceUsd))}
      ${metric('5 分钟', chgTxt(pc.m5), chgCls(pc.m5))}
      ${metric('1 小时', chgTxt(pc.h1), chgCls(pc.h1))}
      ${metric('6 小时', chgTxt(pc.h6), chgCls(pc.h6))}
      ${metric('24 小时', chgTxt(pc.h24), chgCls(pc.h24))}
      ${metric('24h 成交', usd((t.volume || {}).h24))}
      ${metric('池子深度', usd(t.liquidityUsd))}
      ${metric('市值', usd(t.fdv || t.marketCap))}
      ${metric('净买盘', ((t.factors.buyPressure.raw || 0) * 100).toFixed(0) + '%')}
      ${metric('置信度', String(t.confidence))}
      ${metric('风险扣分', String(t.risk))}
    </dl>
    <div class="radar-bar"><span style="width:${Math.max(3, Math.min(100, t.score))}%"></span></div>
    <p class="radar-score">龙分 <b>${t.score}</b> · 未扣风险前 <b>${t.rawScore}</b> · 置信 <b>${t.confidence}</b> · 风险 <b>−${t.risk}</b></p>
    <details class="radar-checks">
      <summary>展开评分明细（8 因子 / 风险 / 数据缺口）</summary>
      <ul>${factors}${risks}${gaps}</ul>
    </details>
    <div class="radar-card-actions">
      <a href="${esc(t.url)}" target="_blank" rel="noreferrer">在 DexScreener 打开</a>
      <button type="button" data-cu-btn="1" data-chain="${esc(t.chainId)}" data-addr="${esc(t.tokenAddress)}">四维体检（安全 / 叙事 / 筹码 / 位置）</button>
      <button type="button" data-copy="${esc(t.tokenAddress)}">复制合约</button>
      <button type="button" data-watch="${esc(t.tokenAddress)}" data-chain="${esc(t.chainId)}" data-sym="${esc(t.symbol)}">加入自选</button>
    </div>
    <div class="radar-checkup" data-cu-body="${esc(t.chainId)}/${esc(t.tokenAddress)}" hidden></div>
  </article>`;
}

function drawSpark(cv, hist) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 300, h = 38;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pts = (hist || []).filter((p) => p[1] > 0);
  if (pts.length < 2) {
    g.strokeStyle = '#e4eadf'; g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([]);
    return;
  }
  const ys = pts.map((p) => p[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const up = ys[ys.length - 1] >= ys[0];
  const c = up ? '#c0392b' : '#2f7d32';
  const X = (i) => (i / (pts.length - 1)) * w;
  const Y = (v) => (max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 8) - 4);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, up ? 'rgba(192,57,43,.22)' : 'rgba(47,125,50,.2)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.beginPath(); g.moveTo(X(0), h);
  pts.forEach((p, i) => g.lineTo(X(i), Y(p[1])));
  g.lineTo(X(pts.length - 1), h); g.closePath(); g.fillStyle = grd; g.fill();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[1])) : g.moveTo(X(i), Y(p[1]))));
  g.strokeStyle = c; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();
  g.beginPath(); g.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 2.4, 0, Math.PI * 2); g.fillStyle = c; g.fill();
}

function renderCards() {
  const box = $('[data-radar-list]');
  const list = visible();
  if (!list.length) {
    box.innerHTML = '<p class="radar-empty">本轮没有符合筛选条件的标的。放宽筛选（切到「全部」或去掉深度限制），或等下一轮扫描。</p>';
    return;
  }
  box.innerHTML = list.slice(0, 120).map(cardHtml).join('');
  $$('[data-radar-list] canvas.radar-spark').forEach((cv) => {
    const t = list[Number(cv.dataset.i)];
    if (t) requestAnimationFrame(() => drawSpark(cv, t.history));
  });
  $$('[data-radar-list] [data-copy]').forEach((b) => {
    b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); toast('已复制合约地址'); };
  });
  $$('[data-radar-list] [data-watch]').forEach((b) => {
    b.onclick = async () => {
      await api('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenAddress: b.dataset.watch, chainId: b.dataset.chain, symbol: b.dataset.sym }) });
      toast('已加入自选，下轮扫描起常驻');
      loadWatchlist();
    };
  });
  cuBindButtons(box);
  cuRestore(box);
}

function renderSkeleton() {
  const box = $('[data-radar-list]');
  box.innerHTML = Array.from({ length: 8 }, () => `
    <div class="radar-skeleton"><i class="big w60"></i><i class="w40"></i><i class="w80"></i><i class="w60"></i><i class="w40"></i></div>
  `).join('');
}

// ------------------------------------------------------------ 龙虎榜
function scoreCell(v) {
  const w = el('div', 'scorecell');
  w.appendChild(el('b', null, String(v)));
  const i = el('i'); const em = el('em');
  em.style.width = Math.max(3, Math.min(100, v)) + '%';
  i.appendChild(em); w.appendChild(i);
  return w;
}

function renderBoard() {
  const tb = $('[data-radar-tbody]');
  tb.innerHTML = '';
  const list = visible();
  const frag = document.createDocumentFragment();
  list.slice(0, 200).forEach((t, i) => {
    const v = VERDICT[t.grade] || VERDICT.watch;
    const tr = el('tr', i < 3 ? 'is-top' + (i + 1) : '');
    const pc = t.priceChange || {};
    const td0 = el('td'); td0.appendChild(el('span', 'rk', String(i + 1).padStart(2, '0'))); tr.appendChild(td0);

    const tdSym = el('td');
    const w = el('div', 'cell-sym');
    if (t.imageUrl) { const img = el('img'); img.src = t.imageUrl; img.alt = ''; img.loading = 'lazy'; w.appendChild(img); }
    const nm = el('div');
    nm.appendChild(el('div', 'n', t.symbol));
    nm.appendChild(el('div', 'c', t.chainLabel + ' · ' + t.dexId));
    w.appendChild(nm);
    tdSym.appendChild(w); tr.appendChild(tdSym);

    const tdS = el('td'); tdS.appendChild(scoreCell(t.score)); tr.appendChild(tdS);
    const tdV = el('td'); tdV.appendChild(el('span', 'radar-verdict is-' + v.cls, v.label)); tr.appendChild(tdV);
    for (const k of ['m5', 'h1', 'h6', 'h24']) {
      const td = el('td');
      td.appendChild(el('span', 'chg ' + chgCls(pc[k]), chgTxt(pc[k])));
      tr.appendChild(td);
    }
    tr.appendChild(el('td', null, usd((t.volume || {}).h24)));
    tr.appendChild(el('td', null, usd(t.liquidityUsd)));
    tr.appendChild(el('td', null, usd(t.fdv || t.marketCap)));
    tr.appendChild(el('td', null, ((t.factors.buyPressure.raw || 0) * 100).toFixed(0) + '%'));
    tr.appendChild(el('td', null, String(t.confidence)));
    tr.appendChild(el('td', null, String(t.risk)));
    tr.onclick = () => toggleDetail(tr, t);
    frag.appendChild(tr);
  });
  tb.appendChild(frag);
}

let openRow = null;
function toggleDetail(tr, t) {
  const tb = $('[data-radar-tbody]');
  if (openRow) { openRow.remove(); openRow = null; }
  if (tr.classList.contains('is-open')) { tr.classList.remove('is-open'); return; }
  $$('[data-radar-tbody] tr').forEach((r) => r.classList.remove('is-open'));
  tr.classList.add('is-open');

  const row = el('tr', 'detail-row');
  const td = el('td');
  td.colSpan = 14;
  const wrap = el('div', 'detail-inner');

  const fbox = el('div');
  fbox.appendChild(el('h4', null, '龙分因子（得分 × 权重）'));
  const mini = el('div', 'mini');
  (t.factorList || []).forEach((f) => {
    const r = el('div', 'r');
    r.appendChild(el('u', null, f.text.split(' ')[0]));
    const i = el('i'); const em = el('em'); em.style.width = Math.max(2, Math.min(100, f.score)) + '%'; i.appendChild(em);
    r.appendChild(i);
    r.appendChild(el('b', null, `${f.score} ×${f.weight}`));
    mini.appendChild(r);
  });
  fbox.appendChild(mini);
  wrap.appendChild(fbox);

  const rbox = el('div');
  rbox.appendChild(el('h4', null, '风险扣分 / 数据缺口'));
  const ul = el('ul');
  (t.riskItems || []).forEach((r) => { const li = el('li'); li.innerHTML = `<b>−${r.n}</b> ${esc(r.text)}`; ul.appendChild(li); });
  if (!(t.riskItems || []).length) ul.appendChild(el('li', null, '本轮没有命中风险项'));
  (t.missing || []).forEach((m) => ul.appendChild(el('li', null, '缺口：' + m)));
  rbox.appendChild(ul);
  wrap.appendChild(rbox);

  const abox = el('div');
  abox.appendChild(el('h4', null, '操作'));
  const ul2 = el('ul');
  const li1 = el('li');
  const a = el('a', null, '在 DexScreener 打开 ' + t.symbol);
  a.href = t.url; a.target = '_blank'; a.rel = 'noreferrer'; li1.appendChild(a); ul2.appendChild(li1);
  const li2 = el('li'); li2.innerHTML = `合约：<b>${esc(t.tokenAddress)}</b>`; ul2.appendChild(li2);
  const li3 = el('li'); li3.appendChild(el('span', null, '本工具只做公开数据统计，不构成投资建议。')); ul2.appendChild(li3);
  abox.appendChild(ul2);
  wrap.appendChild(abox);

  // 四维体检：龙分只看量价结构，这里补上合约安全、筹码归属与仓位倒推
  const cbox = el('div');
  cbox.appendChild(el('h4', null, '四维体检（安全 / 叙事 / 筹码 / 位置）'));
  const cbtn = el('button', 'radar-toggle', '跑一次体检');
  cbtn.type = 'button';
  cbtn.dataset.cuBtn = '1';
  cbtn.dataset.chain = t.chainId;
  cbtn.dataset.addr = t.tokenAddress;
  cbox.appendChild(cbtn);
  const chost = el('div', 'radar-checkup');
  chost.dataset.cuBody = t.chainId + '/' + t.tokenAddress;
  chost.hidden = true;
  cbox.appendChild(chost);
  cbox.appendChild(el('p', 'radar-note', '体检要调外部风控接口，首次约 1～3 秒，结果缓存 6 小时。仓位按你在工具条里填的总资金倒推。'));
  wrap.appendChild(cbox);
  cuBindButtons(wrap);
  cuRestore(wrap);

  td.appendChild(wrap);
  row.appendChild(td);
  tr.after(row);
  openRow = row;
}

// ------------------------------------------------------------ 四维体检
// 龙分回答「量价结构健不健康」，体检回答「能不能碰、筹码在谁手里、该买多少」。
// 两件事分开：龙分是连续加权，体检里安全维度是一票否决——命中硬红线直接放弃，
// 不参与加权，否则会出现「合约随时能跑路但量价很漂亮所以总分 82」这种荒唐结论。
//
// 体检要调外部风控接口（GoPlus / honeypot.is / RugCheck），GoPlus 免费档一次只受理
// 一个地址，所以不做全池预跑：只在用户点开某个标的时跑一次，结果由接口层缓存 6 小时。
const CU = { cache: {}, inflight: {}, open: {} };
const CU_LEVEL = { block: '否决', critical: '致命', high: '偏高', mid: '中等', low: '低', unknown: '缺数据' };

const cuKey = (chainId, addr) => chainId + ':' + String(addr).toLowerCase();
const cuBadge = (rep, extra, slot) => {
  const at = slot ? ' data-cu-slot="1"' : '';
  if (!rep) return `<span class="radar-cu-badge is-loading"${at}>${esc(extra || '体检中')}</span>`;
  const v = rep.verdict || {};
  return `<span class="radar-cu-badge is-${v.cls || 'unknown'}"${at}>四维：${esc(v.label || '未知')}</span>`;
};

function cuChecks(list) {
  return (list || []).map((c) => `<li class="${c.pass ? '' : 'is-bad'}">${esc(c.name)}：<b>${esc(c.detail || '')}</b></li>`).join('');
}

function cuDim(title, score, level, body) {
  const bad = level === 'block' || level === 'critical' || level === 'high';
  return `<div class="radar-cu-dim${bad ? ' is-block' : level === 'mid' ? ' is-warn' : ''}">
    <h5>${esc(title)}<em>${score == null ? '' : score + ' 分 · '}${esc(CU_LEVEL[level] || level || '')}</em></h5>
    ${body}
  </div>`;
}

function cuHtml(rep, chainId, addr) {
  const v = rep.verdict || {};
  const s = rep.safety || {}, n = rep.narrative || {}, c = rep.chips || {}, p = rep.position || {};

  const redLine = (arr) => (arr && arr.length
    ? `<ul class="radar-cu-list">${arr.map((x) => `<li class="is-bad">${esc(x)}</li>`).join('')}</ul>` : '');
  const deducts = (arr) => (arr && arr.length
    ? `<ul class="radar-cu-list">${arr.map((x) => `<li>扣 ${x.n} 分 · ${esc(x.text)}</li>`).join('')}</ul>` : '');
  const paras = (arr) => (arr || []).map((x) => `<p class="radar-cu-line">${esc(x)}</p>`).join('');

  // ---- 安全：先摆硬红线，再摆扣分项，最后才是核对清单
  const sBody = [
    redLine(s.hard),
    deducts(s.warn),
    `<ul class="radar-cu-list">${cuChecks(s.checks)}</ul>`,
    paras(s.notes),
  ].join('');

  // ---- 叙事：给的是传播载体与强度，故事内容必须人工判断
  // 没有成交流水时 txnShare 会退化成 0，那串「0 倍」看着像结论其实没有信息量，直接不渲染。
  const hasNar = n.stageKnown !== false;
  const nBody = [
    `<p class="radar-cu-line">传播阶段 <b>${hasNar ? esc(n.stageLabel || '—') : '未知（未取到成交流水）'}</b>${n.divergence ? ' · <b class="is-bad">量价背离</b>' : ''}</p>`,
    `<div class="radar-cu-tags">${(n.bearers || []).length
      ? n.bearers.map((b) => `<span class="is-ok">${esc(b)}</span>`).join('')
      : '<span class="is-bad">无任何传播载体</span>'}</div>`,
    hasNar
      ? `<p class="radar-cu-line">近 1 小时成交笔数相当于日均 <b>${n.txnShare}</b> 倍，瞬时加速度 <b>${n.txnBurst}</b> 倍，24 小时价格 <b>${n.priceRun}%</b>${n.holderGrowthPct == null ? '' : '，持币地址较上次体检 <b>' + (n.holderGrowthPct >= 0 ? '+' : '') + n.holderGrowthPct + '%</b>'}</p>`
      : '',
    `<ul class="radar-cu-list">${cuChecks(n.checks)}</ul>`,
    paras(n.notes),
  ].join('');

  // ---- 筹码：集中度 × 退出通道宽窄。人数少且池子是唯一出口，才是致命的。
  // 数字缺失时必须写「未取得」。渲染成 undefined 或 0，会被当成「筹码分散」这种结论读走。
  const nz = (v, unit) => (v == null || v === '' ? '未取得' : v + (unit || ''));
  const hasChips = c.top10Pct != null;
  const cBody = [
    redLine(c.hard),
    hasChips
      ? `<p class="radar-cu-line">前十大 <b>${c.top10Pct}%</b>（第一名单个 ${c.top1Pct}%）· DEV / owner 自留 <b>${c.devPct}%</b> · 持币地址 <b>${nz(c.holderCount)}</b></p>`
      : '<p class="radar-cu-line">前十大集中度：<b class="is-bad">未取得</b>（没有前排名单就判断不了筹码在谁手里，这不等于安全）</p>',
    hasChips
      ? `<p class="radar-cu-line">前十大潜在抛压 <b>${usd(c.dumpUsd)}</b>，等于池子深度的 <b>${c.dumpRatio} 倍</b></p>`
      : '',
    hasChips
      ? `<p class="radar-cu-line">退出通道：<b>${esc(c.channelLabel || '—')}</b> · LP 锁定 ${nz(c.lpLockedPct, '%')}${c.insiderPct == null ? '' : ' · 关联地址持仓 ' + c.insiderPct + '%'}</p>`
      : '',
    hasChips ? `<p class="radar-cu-line">集中度口径：${esc(c.concSource || '')}</p>` : '',
    `<ul class="radar-cu-list">${cuChecks(c.checks)}</ul>`,
    deducts(c.warn),
    paras(c.notes),
  ].join('');

  // ---- 位置：仓位由风险预算倒推，不由感觉决定
  const pBody = [
    `<p class="radar-cu-line">市值分档 <b>${esc(p.mcapBandLabel || '—')}</b> · 本阶段止损距离 <b>${p.stopPct}%</b></p>`,
    `<p class="radar-cu-size">建议仓位 ${usd(p.sizeUsd)} <span style="font-size:12px;font-weight:700;color:var(--ink-label)">＝ 总资金 ${usd(p.totalCapitalUsd)} 的 ${p.sizePctOfCapital}%，池子深度的 ${p.sizePctOfLiquidity}%</span></p>`,
    `<p class="radar-cu-line">单笔可承受亏损 <b>${usd(p.riskBudgetUsd)}</b>；倒推上限：风险预算 ${usd(p.riskSizeUsd)} / 流动性上限 ${usd(p.liquidityCapUsd)} / 单币上限 ${usd(p.singleCapUsd)}，实际受限于 <b>${esc(p.sizeCapBy || '—')}</b>，再乘质量系数 ${p.qualityFactor} 与阶段系数 ${p.tierMult}</p>`,
    (p.scales || []).length
      ? `<ul class="radar-cu-list">${p.scales.map((x) => `<li>${esc(x.label)} ${x.pct}%（${usd(x.usd)}）：${esc(x.when)}</li>`).join('')}</ul>` : '',
    `<ul class="radar-cu-list">${cuChecks(p.checks)}</ul>`,
    paras(p.notes),
    `<ul class="radar-cu-exits">${(p.exits || []).map((x) => `<li><b>${esc(x.label)}</b>${esc(x.detail)}</li>`).join('')}</ul>`,
  ].join('');

  const gaps = [].concat(rep.secGaps || [], s.gaps || [], n.gaps || []);

  return `<div class="radar-checkup is-${v.cls || 'unknown'}" data-cu-body="${esc(chainId)}/${esc(addr)}">
    <div class="radar-checkup-head">
      <h4>四维体检 · ${esc(v.label || '未知')}</h4>
      ${v.cls ? `<span class="radar-cu-badge is-${v.cls}">${esc(v.label)}</span>` : ''}
      <span class="radar-cu-score">综合 ${rep.composite} · 安全 ${s.score} / 筹码 ${c.score} / 叙事 ${n.score}</span>
    </div>
    <p class="radar-cu-summary">${esc(rep.summary || '')}</p>
    <div class="radar-cu-grid">
      ${cuDim('安全 · 合约能不能碰', s.score, s.level, sBody)}
      ${cuDim('叙事 · 故事还传不传得动', n.score, hasNar ? (n.stage === 'ebb' ? 'high' : 'low') : 'unknown', nBody)}
      ${cuDim('筹码 · 在谁手里', c.score, c.level, cBody)}
    </div>
    <div class="radar-cu-pos">
      <h5>位置 · 该不该进、该进多少</h5>
      ${pBody}
    </div>
    ${gaps.length ? `<p class="radar-cu-gaps">数据缺口与口径说明：${esc(gaps.join('；'))}</p>` : ''}
    ${rep.marketMissing ? '<p class="radar-cu-gaps is-bad">未取到行情数据（DexScreener 未收录该合约或接口异常）。叙事与位置两个维度已按缺数据降级，不要按这里的数字建仓。</p>' : ''}
    ${!rep.marketMissing && rep.marketOffline ? '<p class="radar-cu-gaps">该标的不在本轮候选池内，行情取自单币实时查询（非候选池快照）。</p>' : ''}
    <p class="radar-cu-gaps">数据来源：${esc((rep.secSources || []).join(' / ') || '—')} · 取数时间 ${esc(ago(rep.at))}${rep.cached ? ' · 命中缓存' : ''}。仪表仅整理公开数据，不构成投资建议。</p>
    <div class="radar-cu-actions">
      <button type="button" data-cu-refresh="${esc(chainId)}/${esc(addr)}">重跑体检</button>
    </div>
  </div>`;
}

function cuSkeleton(chainId, addr) {
  return `<div class="radar-checkup" data-cu-body="${esc(chainId)}/${esc(addr)}">
    <div class="radar-checkup-head"><h4>四维体检</h4>${cuBadge(null, '正在调外部风控接口')}</div>
    <p class="radar-cu-summary">正在拉取合约安全标志、持有人分布与同名仿盘对照。GoPlus 免费档一次只受理一个地址，首次约 1～3 秒。</p>
    <div class="radar-cu-grid">${Array.from({ length: 3 }, () => '<div class="radar-skeleton"><i class="w60"></i><i class="w80"></i><i class="w40"></i></div>').join('')}</div>
  </div>`;
}

async function cuLoad(chainId, addr, opts = {}) {
  const k = cuKey(chainId, addr);
  // 总资金必须每次都传：仓位是服务端/引擎按这个口径倒推的，不能靠默认值兜底
  const cap = Number(store.capital) > 0 ? Number(store.capital) : 0;
  const url = `/api/checkup/${encodeURIComponent(chainId)}/${encodeURIComponent(addr)}`
    + '?capital=' + cap + (opts.force ? '&force=1' : '');
  const r = await api(url);
  if (!r.ok || !r.body || r.body.ok === false) {
    CU.cache[k] = { ok: false, error: (r.body && r.body.error) || ('接口返回 ' + r.status) };
  } else {
    CU.cache[k] = r.body;
  }
  return CU.cache[k];
}

// 把体检结果填进页面上的承载位。卡片与龙虎榜展开行共用这一套 DOM 结构。
function cuPaint(host, chainId, addr) {
  if (!host) return;
  const k = cuKey(chainId, addr);
  const rep = CU.cache[k];
  if (!rep) { host.innerHTML = cuSkeleton(chainId, addr); return; }
  if (rep.ok === false) {
    host.innerHTML = `<div class="radar-checkup is-veto">
      <div class="radar-checkup-head"><h4>四维体检</h4><span class="radar-cu-badge is-veto">取数失败</span></div>
      <p class="radar-cu-summary">${esc(rep.error)}</p>
      <p class="radar-cu-gaps">缺数据不等于安全。拿不到合约数据时本工具不给通过结论。</p>
      <div class="radar-cu-actions"><button type="button" data-cu-refresh="${esc(chainId)}/${esc(addr)}">重试</button></div>
    </div>`;
  } else {
    host.innerHTML = cuHtml(rep, chainId, addr);
  }
  host.hidden = false;
  // 卡片头部同步挂上结论徽标：面板收起后也能一眼看到结论
  const card = (host.closest && host.closest('.radar-card')) || null;
  if (card && rep && rep.ok !== false) {
    const slot = card.querySelector('.radar-cu-badge[data-cu-slot]');
    if (slot) slot.outerHTML = cuBadge(rep, null, true);
    else {
      const note = card.querySelector('.radar-verdict-note');
      if (note) note.insertAdjacentHTML('beforeend', ' · ' + cuBadge(rep, null, true));
    }
  }
  const btn = host.querySelector('[data-cu-refresh]');
  if (btn) btn.onclick = () => cuToggle(host, chainId, addr, true);
}

// 展开 / 收起 / 重跑。同一标的的并发请求共用同一个 Promise，避免重复打接口。
async function cuToggle(host, chainId, addr, force) {
  if (!host) return null;
  const k = cuKey(chainId, addr);
  const open = CU.open[k] === 1;
  if (open && !force) { delete CU.open[k]; host.dataset.cuOpen = '0'; host.hidden = true; return null; }
  CU.open[k] = 1;
  host.dataset.cuOpen = '1';
  host.hidden = false;
  if (CU.cache[k] && !force) { cuPaint(host, chainId, addr); return CU.cache[k]; }

  host.innerHTML = cuSkeleton(chainId, addr);
  if (!CU.inflight[k]) {
    CU.inflight[k] = cuLoad(chainId, addr, { force }).finally(() => { delete CU.inflight[k]; });
  }
  const rep = await CU.inflight[k];
  cuPaint(host, chainId, addr);
  return rep;
}

// 扫描每 15 秒重绘一次卡片，重绘会把已经展开的体检面板清掉。缓存里明明有结果，
// 却要用户再点一次很别扭，所以重绘后按 CU.open 把打开过的面板直接从缓存还原。
function cuRestore(root) {
  if (!root) return;
  root.querySelectorAll('[data-cu-body]').forEach((host) => {
    const raw = host.dataset.cuBody || '';
    const i = raw.indexOf('/');
    if (i < 0) return;
    const chainId = raw.slice(0, i);
    const addr = raw.slice(i + 1);
    // 承载位用的是 "chain/addr"，缓存的键是 cuKey 的小写形式，必须转一次再查
    if (CU.open[cuKey(chainId, addr)] !== 1) return;
    host.dataset.cuOpen = '1';
    if (CU.cache[cuKey(chainId, addr)]) cuPaint(host, chainId, addr);
    else { host.hidden = false; host.innerHTML = cuSkeleton(chainId, addr); }
  });
}

// 卡片与展开行里的体检按钮
function cuBindButtons(root) {
  root.querySelectorAll('[data-cu-btn]').forEach((b) => {
    if (b.dataset.cuBound === '1') return;
    b.dataset.cuBound = '1';
    b.onclick = () => {
      const host = b.closest('.radar-card, .detail-inner') || root;
      const box = host.querySelector('[data-cu-body]');
      cuToggle(box, b.dataset.chain, b.dataset.addr, false);
    };
  });
}

// ------------------------------------------------------------ 模型页
const WEIGHT_CARDS = [
  { i: '01 / 量能', t: '先问有没有人真的在买', d: '当前成交速率 ÷ 基准速率。速率优先用相邻两次快照的真实增量，修掉新池 h24=h1=m5 的退化统计；基准取 24h 均速（新池取生命周期均速）。' },
  { i: '02 / 买盘', t: '再问买的是不是比卖的多', d: '主动买笔数占比，净买盘 ≥ +31% 记满分。样本量按 n/(n+25) 向中性收缩，避免「2 笔成交 100% 买盘」这种噪声。' },
  { i: '03 / 加速', t: '然后问是不是正在起飞', d: '5 分钟涨幅 − 1 小时均速，衡量超额动能。长窗口未成熟时改用快照真实价差，不会拿退化数据凑数。' },
  { i: '04 / 共振', t: '最后问四个周期是否同向', d: '5m / 1h / 6h / 24h 方向一致性，只在已成熟的窗口上归一化。窗口没到就少算一个，不硬凑四个。' },
];
const FACTOR_DESC = {
  volBurst: '当前成交速率 / 基准速率。成熟池 15x、新池 40x 封顶，并按实测成交额限幅，防止几笔小单刷出天量倍数。',
  buyPressure: '主动买笔数占比与买卖家数。净买盘 ≥ +31% 记满分，小样本向中性收缩。',
  accel: '短周期相对长周期的超额动能（5 分钟涨幅 − 1 小时均速）。长窗口未成熟时改用快照价差。',
  resonance: '5m / 1h / 6h / 24h 方向一致性，仅在已成熟窗口上归一化。',
  liquidity: '池子深度绝对值 + 深度/市值比。深度 60 万美金且占比 ≥ 15% 记满分。',
  headroom: '市值还有多少倍空间。20 万–200 万美金区间最优，超大市值扣分。',
  freshness: '池龄。1 小时–1 天最新鲜，超 30 天降权。',
  social: '社交账号 / 官网 / 官方推广 / 代币资料完整度。',
};

function renderModel(weights, grades) {
  const grid = $('[data-radar-weights]');
  grid.innerHTML = WEIGHT_CARDS.map((c) => `
    <article class="radar-guide-card">
      <p class="card-index">${esc(c.i)}</p>
      <h3>${esc(c.t)}</h3>
      <p>${esc(c.d)}</p>
    </article>`).join('');

  const tb = $('#modelBody');
  tb.innerHTML = '';
  for (const k of Object.keys(weights || {})) {
    const tr = el('tr');
    tr.appendChild(el('td', null, k));
    tr.appendChild(el('td', null, (weights[k] * 100).toFixed(0) + '%'));
    tr.appendChild(el('td', null, FACTOR_DESC[k] || ''));
    tb.appendChild(tr);
  }

  const box = $('#gradeList');
  box.innerHTML = '';
  const desc = { pass: '龙分 ≥ 70', review: '龙分 60–69', unknown: '龙分 45–59', veto: '龙分 < 45' };
  ['pass', 'review', 'unknown', 'veto'].forEach((k) => {
    const g = (grades || []).find((x) => (VERDICT[x.key] || {}).cls === k);
    const s = el('span');
    s.innerHTML = `<span class="radar-verdict is-${k}">${esc(g ? g.label : k)}</span> ${esc(desc[k])}`;
    box.appendChild(s);
  });
}

// ------------------------------------------------------------ 抓龙胜率（信号账本）
/**
 * 这一页不做历史回放，只报「先记录、后结算」的真实样本。
 *
 * 三个数必须同时出现：胜率、同期榜单指数基准、样本流失率。缺任何一个，胜率都能被做得很漂亮 ——
 * 全市场普涨时闭眼买也是高胜率；把归零掉出榜单的标的从分母里悄悄抹掉，胜率还会更高。
 * 所以这里把三件事绑在同一张卡上，不给单独取用的机会。
 *
 * 样本不足 MIN_SAMPLE 时只渲染原始计数，胜率 / 中位收益 / 超额一律写「样本积累中」，
 * 不拿几笔的结果冒充结论。
 */
const BT = { loading: false, last: null };

const pctStr = (v) => (typeof v === 'number' && isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%' : '—');
const rateStr = (v) => (typeof v === 'number' && isFinite(v) ? (v * 100).toFixed(1) + '%' : '—');

function btUrl() {
  const p = new URLSearchParams({ horizon: store.bt.horizon, why: store.bt.why, limit: '60' });
  return '/api/backtest?' + p.toString();
}

async function loadBacktest() {
  if (BT.loading) return BT.last;
  BT.loading = true;
  try {
    const r = await api(btUrl());
    if (r.ok && r.body) { BT.last = r.body; renderBacktest(); }
    else {
      $('[data-bt-body]').innerHTML = `<p class="radar-empty">取不到账本：${esc((r.body && r.body.error) || ('HTTP ' + r.status))}</p>`;
    }
    return BT.last;
  } catch (e) {
    $('[data-bt-body]').innerHTML = `<p class="radar-empty">取不到账本：${esc(String(e && e.message || e))}</p>`;
    return BT.last;
  } finally { BT.loading = false; }
}

function renderBacktest() {
  const host = $('[data-bt-body]');
  if (!host) return;
  const d = BT.last;
  if (!d) { host.innerHTML = '<p class="radar-empty">尚未取到账本数据。</p>'; return; }
  if (d.available === false) { host.innerHTML = `<p class="radar-empty">${esc(d.error || '回测不可用')}</p>`; return; }

  const s = d.summary || {};
  const b = s.benchmark || {};
  const t = s.totals || {};
  const ix = s.index || {};
  const enough = !!s.sampleEnough;
  const H = esc(s.horizonLabel || '');
  const W = esc(s.whyLabel || '');

  const stat = (k, v, n, cls) => `<div class="radar-bt-stat${cls ? ' ' + cls : ''}">
    <p class="k">${esc(k)}</p><p class="v">${v}</p><p class="n">${esc(n || '')}</p></div>`;

  // 样本不够：胜率、中位、超额一律替换成「样本积累中」，不给数字就没有误读空间
  const stats = [
    stat('已结算样本', String(s.n || 0), `${H}视界 · ${W}`),
    enough ? stat('胜率', rateStr(s.winRate), '正收益占比', s.winRate >= 0.5 ? 'is-up' : 'is-down')
           : stat('胜率', '样本积累中', `门槛 ${s.minSample || 30} 笔`, 'is-mute'),
    enough ? stat('中位收益', pctStr(s.median), '比均值更抗极端值', s.median >= 0 ? 'is-up' : 'is-down')
           : stat('中位收益', '样本积累中', '不足门槛不给结论', 'is-mute'),
    enough ? (b.medianExcess == null
      ? stat('中位超额', '无基准', '同期榜单指数没有采样点')
      : stat('中位超额', pctStr(b.medianExcess), '信号收益 − 同期榜单指数', b.medianExcess >= 0 ? 'is-up' : 'is-down'))
           : stat('中位超额', '样本积累中', '不足门槛不给结论', 'is-mute'),
    stat('待结算', String(s.waiting || 0), '视界未到，或刚落榜'),
    stat('样本流失', String(s.dead || 0), '到期仍补不到价格'),
  ].join('');

  const gate = enough ? '' : `<div class="radar-bt-gate">
    <b>样本积累中。</b>当前 ${H} 视界已结算 <b>${s.n || 0}</b> 笔，门槛 <b>${s.minSample || 30}</b> 笔。
    样本不足时本页只报原始计数，不给胜率 —— 几笔的胜率没有解释力，写出来比不写更误导。
    15 分钟视界的样本积得最快，可以先看它。
  </div>`;

  // 基准：把「雷达选得准」和「那阵子全市场在涨」分开的唯一办法
  const benchRows = [
    ['同期榜单指数收益（等权中位）', b.medianReturn == null ? '无采样点' : pctStr(b.medianReturn)],
    ['信号中位超额（信号 − 指数）', b.medianExcess == null ? '无采样点' : pctStr(b.medianExcess)],
    ['跑赢基准的比例', b.beatRate == null ? '—' : rateStr(b.beatRate)],
    ['有基准的样本 / 缺基准的样本', `${b.available || 0} / ${b.missing || 0}`],
    ['指数点数 / 当前净值', `${ix.points || 0} 点 · ${ix.level == null ? '—' : ix.level.toFixed(4)}`],
    ['指数单轮中位波动', ix.medianRoundRet == null ? '—' : pctStr(ix.medianRoundRet)],
  ].map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('');

  // 分层：档位越高是否确实越赚，这是龙分有没有区分度的直接证据
  const gradeRows = (s.byGrade || []).map((g) => `<tr>
    <td><b>${esc(g.label)}</b></td>
    <td>${g.n}</td>
    <td class="${g.winRate >= 0.5 ? 'is-up' : 'is-down'}">${rateStr(g.winRate)}</td>
    <td class="${g.median >= 0 ? 'is-up' : 'is-down'}">${pctStr(g.median)}</td>
    <td>${g.medianExcess == null ? '无基准' : pctStr(g.medianExcess)}</td>
  </tr>`).join('') || '<tr><td colspan="5">该视界下还没有已结算样本。</td></tr>';

  const chainRows = (s.byChain || []).map((c) => `<tr>
    <td>${esc(c.label)}</td><td>${c.n}</td>
    <td class="${c.winRate >= 0.5 ? 'is-up' : 'is-down'}">${rateStr(c.winRate)}</td>
    <td class="${c.median >= 0 ? 'is-up' : 'is-down'}">${pctStr(c.median)}</td>
    <td>${c.medianExcess == null ? '无基准' : pctStr(c.medianExcess)}</td>
  </tr>`).join('');

  const STATE_LABEL = { settled: '已结算', lost: '流失', waiting: '待结算' };
  const sampleRows = (d.samples || []).map((x) => `<tr>
    <td>${esc(ago(x.t0))}</td>
    <td><b>${esc(x.symbol || '?')}</b><span class="radar-bt-dim"> ${esc(x.chainId || '')}</span></td>
    <td>${esc((d.whyLabels || {})[x.why] || x.why)}</td>
    <td>${x.score}</td>
    <td>${esc(x.gradeLabel || x.grade || '')}</td>
    <td>${price(x.price0)}</td>
    <td class="${x.r == null ? '' : x.r >= 0 ? 'is-up' : 'is-down'}">${x.r == null ? '—' : pctStr(x.r)}</td>
    <td class="${x.ex == null ? '' : x.ex >= 0 ? 'is-up' : 'is-down'}">${x.ex == null ? '—' : pctStr(x.ex)}</td>
    <td class="is-down">${x.mae == null ? '—' : pctStr(x.mae)}</td>
    <td>${esc(STATE_LABEL[x.state] || x.state || '')}</td>
  </tr>`).join('') || '<tr><td colspan="10">还没有记录到该视界下的信号。</td></tr>';

  // q 分位、最大不利偏移：只有收益没有回撤，胜率会显得比实际舒服
  const dist = enough ? `<div class="radar-bt-dist">
    <span>25 分位 <b>${pctStr(s.p25)}</b></span>
    <span>中位 <b>${pctStr(s.median)}</b></span>
    <span>75 分位 <b>${pctStr(s.p75)}</b></span>
    <span>最好 <b class="is-up">${pctStr(s.best)}</b></span>
    <span>最差 <b class="is-down">${pctStr(s.worst)}</b></span>
    <span>翻倍以上 <b>${rateStr(s.doubleRate)}</b></span>
    <span>腰斩以上 <b class="is-down">${rateStr(s.halfRate)}</b></span>
    <span>平均最大浮亏 <b class="is-down">${s.avgMae == null ? '—' : pctStr(s.avgMae)}</b>（${s.maeN || 0} 笔有观测）</span>
  </div>` : '';

  const curve = (d.series || []).length >= 2
    ? `<canvas class="radar-bt-spark" data-bt-spark></canvas>
       <p class="radar-note" style="margin-top:6px">榜单指数净值：每轮取「上一轮与这一轮都在榜」标的的轮间收益中位数，连乘而成。它偏向活得久的那批，与信号账本面对同一类幸存者问题 —— 但两者同向受影响，做比较仍然成立。</p>`
    : '<p class="radar-empty">榜单指数还没有足够的采样点（单轮至少 3 个连续在榜标的才记点）。</p>';

  host.innerHTML = `
    <div class="radar-bt-grid">${stats}</div>
    ${gate}
    ${dist}
    <div class="radar-bt-cols">
      <div class="radar-panel">
        <p class="card-index">对照基准 · 回答「雷达选的比池子平均强吗」</p>
        <div class="table-wrap"><table class="radar-table"><tbody>${benchRows}</tbody></table></div>
        ${curve}
      </div>
      <div class="radar-panel">
        <p class="card-index">档位分层 · 分数越高是不是真的越赚</p>
        <div class="table-wrap"><table class="radar-table">
          <thead><tr><th>档位</th><th style="width:60px">样本</th><th style="width:80px">胜率</th><th style="width:88px">中位收益</th><th style="width:88px">中位超额</th></tr></thead>
          <tbody>${gradeRows}</tbody>
        </table></div>
        ${chainRows ? `<div class="table-wrap" style="margin-top:12px"><table class="radar-table">
          <thead><tr><th>链</th><th style="width:60px">样本</th><th style="width:80px">胜率</th><th style="width:88px">中位收益</th><th style="width:88px">中位超额</th></tr></thead>
          <tbody>${chainRows}</tbody>
        </table></div>` : ''}
      </div>
    </div>

    <div class="radar-panel" style="margin-top:18px">
      <p class="card-index">最近信号明细（含待结算与流失）</p>
      <div class="table-wrap"><table class="radar-table">
        <thead><tr>
          <th style="width:96px">开仓时间</th><th>标的</th><th style="width:110px">信号</th>
          <th style="width:56px">龙分</th><th style="width:88px">档位</th><th style="width:110px">入场价</th>
          <th style="width:84px">视界收益</th><th style="width:84px">超额</th>
          <th style="width:88px">最大浮亏</th><th style="width:84px">状态</th>
        </tr></thead>
        <tbody>${sampleRows}</tbody>
      </table></div>
      <p class="radar-note" style="margin-top:10px">
        账本自 ${esc(t.startedAt ? ago(t.startedAt) : '尚未开始')} 起记录，共 ${t.rounds || 0} 轮扫描，
        累计开仓 ${t.opened || 0} 次、完成结算 ${t.settled || 0} 个视界，当前存续 ${t.signals || 0} 个信号。
        「流失」指到期仍补不到价格：多半是池子被撤或标的归零。它们不计入胜率分母，但会单独列出来 ——
        从统计里悄悄抹掉这批，胜率会系统性虚高。
      </p>
    </div>
  `;

  const cv = host.querySelector('[data-bt-spark]');
  if (cv) requestAnimationFrame(() => drawSpark(cv, d.series));
}

// ------------------------------------------------------------ 追踪 / 抄作业
async function loadFomo() {
  const handle = $('#fomoHandle').value.trim() || 'IcyNoisyWhale';
  $('#fomoHint').textContent = '正在拉取 ' + handle + ' …';
  const headers = {};
  if (store.fomoToken) headers['X-Fomo-Token'] = store.fomoToken;
  const r = await api('/api/fomo/' + encodeURIComponent(handle), { headers });
  const box = $('#fomoBody');
  box.innerHTML = '';
  const d = r.body || {};
  const u = d.user || null;
  const trades = u && (u.trades ?? u.numTrades ?? u.tradeCount);
  const followers = u && (u.followers ?? u.followerCount ?? u.numFollowers);

  const cardEl = el('div', 'fomo-card');
  cardEl.appendChild(el('div', 'fomo-avatar', (handle[0] || '?').toUpperCase()));
  const h = el('h3'); h.innerHTML = `<span>@</span>${esc(handle)}`; cardEl.appendChild(h);
  const meta = el('div', 'fomo-meta');
  meta.innerHTML = `<span><b>${trades ?? 0}</b> 笔交易</span><span><b>${followers ?? 0}</b> 关注者</span>`;
  cardEl.appendChild(meta);

  if (r.ok && u) {
    const dl = el('dl', 'fomo-kv');
    const kv = (k, v) => { if (v == null || v === '') return; dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, String(v))); };
    kv('用户 ID', u.id || u.userId);
    kv('钱包', u.walletAddress || u.address);
    kv('积分', u.points ?? u.score);
    kv('排名', u.rank);
    kv('加入时间', u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : null);
    cardEl.appendChild(dl);
  } else {
    cardEl.appendChild(el('div', 'radar-alert', d.message || '该用户的实时持仓与成交需要 fomo 登录态（授权令牌）才能读取。下方是其官方公开名片。'));
  }

  const img = el('img', 'ogcard');
  img.src = d.publicCard || `https://image-renderer.fomo.cloud/og/profile/${encodeURIComponent(handle)}/card.png`;
  img.alt = handle + ' 公开名片';
  img.onerror = () => { img.remove(); };
  cardEl.appendChild(img);

  const a = el('a', 'radar-toggle', '前往 fomo.family 主页');
  a.href = d.profileUrl || `https://fomo.family/profile/${encodeURIComponent(handle)}`;
  a.target = '_blank'; a.rel = 'noreferrer'; a.style.marginTop = '16px';
  cardEl.appendChild(a);

  box.appendChild(cardEl);
  $('#fomoHint').textContent = r.ok
    ? '已通过授权令牌拉取到该用户的实时资料。'
    : '官方公开名片已加载；实时持仓需令牌（在浏览器已登录 fomo 时，可从 Network 请求头复制 Authorization 里的令牌）。';
}

function savePositions() { localStorage.setItem('dr.positions', JSON.stringify(store.positions)); }

function renderPositions(prices) {
  const tb = $('#posBody');
  tb.innerHTML = '';
  let cost = 0, value = 0;
  store.positions.forEach((p, idx) => {
    const q = prices[p.address] || {};
    const now = q.priceUsd || 0;
    const size = Number(p.size) || 1;
    const pnl = (now - Number(p.cost)) * size;
    const pnlPct = Number(p.cost) > 0 ? ((now - Number(p.cost)) / Number(p.cost)) * 100 : 0;
    cost += Number(p.cost) * size;
    value += now * size;
    const tr = el('tr');
    const td0 = el('td');
    const w = el('div', 'cell-sym');
    w.appendChild(el('div', 'n', p.symbol || (p.address || '').slice(0, 8)));
    td0.appendChild(w); tr.appendChild(td0);
    tr.appendChild(el('td', null, now ? price(now) : '—'));
    tr.appendChild(el('td', null, price(Number(p.cost))));
    tr.appendChild(el('td', null, String(size)));
    const td4 = el('td');
    td4.innerHTML = `<span class="${pnl >= 0 ? 'is-up' : 'is-down'}">${pnl >= 0 ? '+' : ''}${usd(pnl)} (${pnlPct.toFixed(1)}%)</span>`;
    tr.appendChild(td4);
    const td5 = el('td');
    const del = el('button', 'radar-toggle', '删');
    del.onclick = () => { store.positions.splice(idx, 1); savePositions(); renderPositions(prices); };
    td5.appendChild(del); tr.appendChild(td5);
    tb.appendChild(tr);
  });
  const tot = $('#posTotal');
  const totalPnl = value - cost;
  const pv = cost > 0 ? (totalPnl / cost) * 100 : 0;
  tot.innerHTML = store.positions.length
    ? `<span>持仓 <b>${store.positions.length}</b> 个</span><span>成本 <b>${usd(cost)}</b></span><span>现值 <b>${usd(value)}</b></span>
       <span>浮动盈亏 <b class="${totalPnl >= 0 ? 'is-up' : 'is-down'} big">${totalPnl >= 0 ? '+' : ''}${usd(totalPnl)}（${pv.toFixed(1)}%）</b></span>`
    : `<span>暂无持仓。填合约地址 + 成本价即可实时算浮盈，等同于自己的一份持仓页。</span>`;
}

async function refreshPositions() {
  if (!store.positions.length) { renderPositions({}); return; }
  const prices = {};
  await Promise.all(store.positions.map(async (p) => {
    const r = await api('/api/price?address=' + encodeURIComponent(p.address));
    if (r.ok && r.body && r.body.price) { prices[p.address] = r.body.price; if (!p.symbol) p.symbol = r.body.price.symbol; }
  }));
  savePositions();
  renderPositions(prices);
}

async function loadWatchlist() {
  const r = await api('/api/watchlist');
  if (!r.ok) return;
  store.watchlist = r.body.watchlist || [];
  const box = $('#wlList');
  box.innerHTML = '';
  if (!store.watchlist.length) { box.appendChild(el('span', null, '暂无自选。加入后每次扫描都会始终纳入候选池。')); return; }
  store.watchlist.forEach((w) => {
    const s = el('span');
    s.appendChild(el('span', null, `${w.symbol || ''} ${String(w.tokenAddress).slice(0, 6)}… · ${w.chainId}`));
    const b = el('button', null, '×');
    b.onclick = async () => {
      await api(`/api/watchlist?address=${encodeURIComponent(w.tokenAddress)}&chainId=${w.chainId}`, { method: 'DELETE' });
      loadWatchlist(); toast('已移出自选');
    };
    s.appendChild(b);
    box.appendChild(s);
  });
}

// ------------------------------------------------------------ 视图切换
function setView(v) {
  store.view = v;
  $$('.site-nav button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === v));
  $('[data-panel="track"]').hidden = v !== 'track';
  $('[data-panel="model"]').hidden = v !== 'model';
  $('[data-panel="backtest"]').hidden = v !== 'backtest';
  const board = v === 'radar' || v === 'board';
  $('.radar-board').hidden = !board;
  $('.radar-hero').hidden = !board;
  $('[data-radar-list]').hidden = v !== 'radar';
  $('[data-radar-table]').hidden = v !== 'board';
  if (v === 'track') { loadFomo().catch(() => {}); refreshPositions(); loadWatchlist(); }
  if (v === 'backtest') loadBacktest().catch(() => {});
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bind() {
  $$('.site-nav button').forEach((b) => { b.onclick = () => { setView(b.dataset.view); $('[data-menu]').classList.remove('is-open'); }; });
  const mt = $('[data-menu-toggle]');
  if (mt) mt.onclick = () => {
    const nav = $('[data-menu]');
    const open = nav.classList.toggle('is-open');
    mt.setAttribute('aria-expanded', String(open));
  };
  const nc = $('[data-notice-close]');
  if (nc) nc.onclick = () => { $('[data-notice]').classList.add('is-hidden'); };

  $$('[data-radar-modes] .radar-chip').forEach((b) => {
    b.onclick = () => {
      $$('[data-radar-modes] .radar-chip').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      store.mode = b.dataset.mode;
      refresh();
    };
  });
  $$('[data-radar-sorts] .radar-chip').forEach((b) => {
    b.onclick = () => {
      $$('[data-radar-sorts] .radar-chip').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      store.sort = b.dataset.sort;
      refresh();
    };
  });
  let qt = null;
  $('[data-radar-search]').oninput = (e) => {
    clearTimeout(qt);
    qt = setTimeout(() => { store.q = e.target.value.trim(); refresh(); }, 320);
  };
  const depth = $('[data-radar-depth]');
  depth.onclick = () => {
    store.minLiq = !store.minLiq;
    depth.classList.toggle('is-active', store.minLiq);
    depth.setAttribute('aria-pressed', String(store.minLiq));
    refresh();
  };
  const auto = $('[data-radar-auto]');
  const setAuto = (on) => {
    store.auto = on;
    auto.classList.toggle('is-active', on);
    auto.setAttribute('aria-pressed', String(on));
    auto.textContent = '自动更新：' + (on ? '开' : '关');
  };
  auto.onclick = () => { setAuto(!store.auto); toast(store.auto ? '已开启自动刷新（15 秒一次）' : '已关闭自动刷新'); };
  $('[data-radar-refresh]').onclick = async () => {
    const btn = $('[data-radar-refresh]');
    btn.disabled = true; btn.textContent = '刷新中…';
    setStatus('已触发一轮扫描…', 'is-warn');
    try { await api('/api/scan', { method: 'POST' }); } catch { /* 扫描失败会在状态行直说 */ }
    // 静态形态下 /api/scan 是同步等待整轮扫描结束；Node 形态下它异步触发，需留出时间。
    await new Promise((r) => setTimeout(r, ENGINE ? 200 : 3500));
    await refresh();
    btn.disabled = false; btn.textContent = '刷新这一轮';
  };

  // 总资金只用于四维体检里的仓位倒推，存在本机，不发往任何第三方
  const cap = $('[data-radar-capital]');
  if (cap) {
    cap.value = String(store.capital);
    cap.onchange = () => {
      const v = Number(cap.value);
      if (!isFinite(v) || v <= 0) { cap.value = String(store.capital); return; }
      store.capital = Math.round(v);
      localStorage.setItem('dr.capital', String(store.capital));
      CU.cache = {};                 // 仓位口径变了，缓存里的仓位结论不再有效
      toast('总资金已更新为 ' + usd(store.capital) + '，下次体检按新口径倒推仓位');
    };
  }

  $('#btnFomo').onclick = () => loadFomo().catch(() => toast('拉取失败'));
  $('#btnFomoOpen').onclick = () => {
    const h = $('#fomoHandle').value.trim() || 'IcyNoisyWhale';
    window.open('https://fomo.family/profile/' + encodeURIComponent(h), '_blank');
  };
  $('#btnFomoSave').onclick = () => {
    store.fomoToken = $('#fomoToken').value.trim();
    localStorage.setItem('dr.fomoToken', store.fomoToken);
    toast(store.fomoToken ? '令牌已保存到本机浏览器' : '已清空令牌');
    loadFomo().catch(() => {});
  };
  $('#fomoToken').value = store.fomoToken;

  $('#btnPosAdd').onclick = async () => {
    const address = $('#posAddr').value.trim();
    const costV = Number($('#posCost').value);
    const size = Number($('#posSize').value) || 1;
    if (!address || !costV) { toast('请填写合约地址与成本价'); return; }
    const r = await api('/api/price?address=' + encodeURIComponent(address));
    if (!r.ok) { toast('查不到该合约的报价，请确认地址'); return; }
    const sym = r.body && r.body.price ? r.body.price.symbol : '';
    store.positions.push({ address, cost: costV, size, symbol: sym });
    savePositions();
    $('#posAddr').value = ''; $('#posCost').value = ''; $('#posSize').value = '';
    refreshPositions();
  };
  $('#btnWlAdd').onclick = async () => {
    const address = $('#wlAddr').value.trim();
    if (!address) return;
    await api('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenAddress: address }) });
    $('#wlAddr').value = '';
    toast('已加入自选');
    loadWatchlist(); refresh();
  };

  // 胜率回测：视界与信号类型切换
  $$('[data-bt-horizons] .radar-chip').forEach((b) => {
    b.onclick = () => {
      $$('[data-bt-horizons] .radar-chip').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      store.bt.horizon = b.dataset.horizon;
      loadBacktest().catch(() => {});
    };
  });
  $$('[data-bt-whys] .radar-chip').forEach((b) => {
    b.onclick = () => {
      $$('[data-bt-whys] .radar-chip').forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      store.bt.why = b.dataset.why;
      loadBacktest().catch(() => {});
    };
  });
  const br = $('#btReset');
  if (br) br.onclick = async () => {
    if (!window.confirm('清空信号账本并重新开始积累？已收集的样本会全部丢失，榜单与自选不受影响。')) return;
    const r = await api('/api/backtest/reset', { method: 'POST' });
    if (!r.ok) { toast('清空失败：' + ((r.body && r.body.error) || r.status)); return; }
    toast('账本已清空，从下一轮扫描开始重新积累');
    BT.last = null;
    loadBacktest().catch(() => {});
  };
}

// ------------------------------------------------------------ 启动
let pollTimer = null;
(async function boot() {
  bind();
  renderSkeleton();
  // 静态形态：浏览器端引擎自己按 SCAN_INTERVAL_MS 一轮轮扫，页面只需定期重读内存里的结果。
  // Node 形态：扫描由 server.js 负责，页面定期问 /api/radar 拿最新数据。
  if (ENGINE) {
    ENGINE.start();
    // 引擎在「扫描开始 / 扫描结束」时主动通知，页面立刻重绘，不用干等轮询周期。
    if (typeof ENGINE.onChange === 'function') ENGINE.onChange(() => { refresh().catch(() => {}); });
  }
  await loadMeta();
  await refresh();
  await loadWatchlist();
  pollTimer = setInterval(() => { if (store.auto) refresh(); }, ENGINE ? 5000 : 15000);
  setInterval(() => { if (store.view === 'track') refreshPositions(); }, 30000);
  // 首轮扫描迟迟不返回时，主动区分「网络不通」与「还在扫」，把结论写在状态行上。
  setTimeout(selfCheck, BOOT_STALL_MS);
})();
