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
    <p class="radar-verdict-note">${esc(t.name || '—')} · ${t.quoteIsUsd ? 'USD 报价' : '原生币报价'}</p>
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
      <button type="button" data-copy="${esc(t.tokenAddress)}">复制合约</button>
      <button type="button" data-watch="${esc(t.tokenAddress)}" data-chain="${esc(t.chainId)}" data-sym="${esc(t.symbol)}">加入自选</button>
    </div>
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

  td.appendChild(wrap);
  row.appendChild(td);
  tr.after(row);
  openRow = row;
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
  const board = v === 'radar' || v === 'board';
  $('.radar-board').hidden = !board;
  $('.radar-hero').hidden = !board;
  $('[data-radar-list]').hidden = v !== 'radar';
  $('[data-radar-table]').hidden = v !== 'board';
  if (v === 'track') { loadFomo().catch(() => {}); refreshPositions(); loadWatchlist(); }
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
})();
