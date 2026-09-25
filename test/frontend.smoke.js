'use strict';
/**
 * 前端冒烟测试（需要服务已在 127.0.0.1:8791 运行）
 *   node test/frontend.smoke.js
 * 做法：用 jsdom 在进程内跑真实的 public/app.js，拦截 fetch 指向本地服务，
 * 断言雷达卡片 / 龙虎榜 / 筛选 / 追踪页 / 模型页都真的渲染出来了。
 */
const fs = require('fs');
const path = require('path');
const NODE_MODULES = process.env.WB_NODE_MODULES || 'C:/Users/22617/.workbuddy/binaries/node/workspace/node_modules';
const { JSDOM, VirtualConsole } = require(path.join(NODE_MODULES, 'jsdom'));

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')
  .replace(/<!-- build:scripts -->[\s\S]*?<!-- \/build:scripts -->/, '');
const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  OK ' + name);
  else { console.error('  FAIL ' + name + (extra ? ' → ' + extra : '')); fails++; }
};

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { console.error('jsdomError:', e.message); fails++; });

const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

// ---- 环境补齐 ----
window.fetch = (input, init) => fetch(new URL(typeof input === 'string' ? input : input.url, BASE).href, init);
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.scrollTo = () => {};
// jsdom 不实现 canvas：用 Proxy 兜住所有 2D 上下文方法（缺一个方法就会在画图时炸）
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
window.navigator.clipboard = { writeText: () => Promise.resolve() };
window.open = () => null;

(async function run() {
  console.log('前端冒烟测试（jsdom + 真实 app.js）');
  window.eval(appJs);
  await new Promise((r) => setTimeout(r, 4500));

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];

  // ---- 骨架 ----
  ok('顶部免责提示条存在', !!$('.notice') && /不构成投资建议/.test($('.notice').textContent));
  ok('页头品牌存在', !!$('.brand-mark'));
  ok('Hero 大标题存在', !!$('.radar-hero h1') && /新池每分钟都在出/.test($('.radar-hero h1').textContent));
  ok('Hero 统计为 4 项胶囊', $$('.radar-stats li').length === 4, String($$('.radar-stats li').length));
  ok('Hero 统计已填数', $('[data-radar-scanned]').textContent !== '—', $('[data-radar-scanned]').textContent);
  ok('工具条含三组筛选', $$('.radar-toolbar .radar-group').length === 3);
  ok('扫描链 chips 已生成', $$('[data-radar-chains] .radar-chip').length >= 2);
  ok('筛选器渲染 5 档', $$('[data-radar-filters] .radar-filter').length === 5);

  // ---- 状态 ----
  ok('状态行已更新', /本轮已完成|正在扫描|出错/.test($('[data-radar-status]').textContent), $('[data-radar-status]').textContent);
  ok('倒计时有内容', /下一轮|已取数|扫描中/.test($('[data-radar-countdown]').textContent), $('[data-radar-countdown]').textContent);
  ok('结论文案已生成', /可看|没有标的进入/.test($('[data-radar-verdict-line]').textContent));
  ok('数据来源说明已生成', /DexScreener/.test($('[data-radar-source]').textContent));

  // ---- 卡片 ----
  ok('雷达卡片已渲染', $$('.radar-card').length > 5, String($$('.radar-card').length));
  ok('卡片带判定状态色', $$('.radar-card.is-pass, .radar-card.is-review, .radar-card.is-veto, .radar-card.is-unknown').length > 5);
  ok('卡片含判定徽章', $$('.radar-verdict').length > 5);
  ok('卡片含指标网格', $$('.radar-metrics dt').length > 40, String($$('.radar-metrics dt').length));
  ok('卡片涨跌着色（红涨/绿跌）', $$('.radar-metrics dd.is-up').length + $$('.radar-metrics dd.is-down').length > 0);
  ok('卡片含龙分条', $$('.radar-bar span').length > 5);
  ok('卡片含可展开明细', $$('details.radar-checks').length > 5);
  ok('卡片含标签', $$('.radar-tag').length > 3);
  ok('卡片含操作按钮', $$('.radar-card-actions a, .radar-card-actions button').length > 5);

  // ---- 龙虎榜 ----
  const boardBtn = $$('.site-nav button').find((b) => b.dataset.view === 'board');
  boardBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  ok('切到龙虎榜后表格可见', !$('[data-radar-table]').hidden && $('[data-radar-list]').hidden);
  ok('龙虎榜渲染出行', $$('[data-radar-tbody] tr').length > 5, String($$('[data-radar-tbody] tr').length));
  ok('龙虎榜含涨跌色块', $$('[data-radar-tbody] .chg').length > 5);
  ok('龙虎榜含龙分迷你条', $$('[data-radar-tbody] .scorecell i em').length > 5);
  const firstRow = $('[data-radar-tbody] tr');
  firstRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  ok('点击行展开明细', $$('[data-radar-tbody] tr.detail-row').length === 1);
  ok('展开明细含因子条', $$('[data-radar-tbody] .detail-inner .mini .r').length >= 8);
  firstRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  ok('再次点击收起明细', $$('[data-radar-tbody] tr.detail-row').length === 0);

  // ---- 追踪页 ----
  const trackBtn = $$('.site-nav button').find((b) => b.dataset.view === 'track');
  trackBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2200));
  ok('追踪页显示且列表页隐藏', !$('[data-panel="track"]').hidden && $('.radar-board').hidden);
  ok('fomo 名片已渲染', !!$('#fomoBody .fomo-card'));
  ok('名片图片指向 fomo 官方渲染器', /image-renderer\.fomo\.cloud/.test(($('#fomoBody img.ogcard') || {}).src || ''));
  ok('持仓区显示空态', /暂无持仓/.test($('#posTotal').textContent));

  // ---- 模型页 ----
  const modelBtn = $$('.site-nav button').find((b) => b.dataset.view === 'model');
  modelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  ok('模型页显示', !$('[data-panel="model"]').hidden);
  ok('读法卡片 4 张', $$('.radar-guide-card').length === 4, String($$('.radar-guide-card').length));
  ok('权重表 8 行', $$('#modelBody tr').length >= 8, String($$('#modelBody tr').length));
  ok('分级图例已填充', $$('#gradeList span').length >= 4);
  ok('模型页说明四维体检口径', /安全 ×0\.40 ＋ 筹码 ×0\.30 ＋ 叙事 ×0\.30/.test($('[data-panel="model"]').textContent));

  // ---- 四维体检入口（Node 形态）----
  // 真实体检要打 GoPlus / honeypot.is，属于外部依赖；这里只验证入口与承载位齐备，
  // 接口本身的链路由 test/checkup.test.js（模型）与 test/static.smoke.js（适配层）覆盖。
  $$('.site-nav button').find((b) => b.dataset.view === 'radar')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  ok('工具条含总资金输入框', !!$('[data-radar-capital]') && $('[data-radar-capital]').value === '10000');
  ok('卡片带体检按钮与承载位', $$('.radar-card [data-cu-btn]').length > 5 && $$('.radar-card [data-cu-body]').length > 5);

  // ---- 回到雷达 ----
  $$('.site-nav button').find((b) => b.dataset.view === 'radar')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  ok('切回雷达页卡片可见', !$('[data-radar-list]').hidden && $$('.radar-card').length > 5);

  console.log(fails ? `\n失败 ${fails} 项` : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('运行异常：', e); process.exit(1); });
