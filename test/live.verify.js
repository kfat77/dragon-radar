'use strict';
/**
 * 线上产物验证（联网，默认不跑）
 *
 *   node test/live.verify.js
 *   DR_LIVE_BASE=https://<你的域名>/ node test/live.verify.js
 *
 * 做法：把线上真正发布的那份文件逐个下载到临时目录，再用 jsdom 在进程内加载
 * 「下载下来的副本」，fetch 走真实网络（不 stub），断言线上那一版能自己扫描、
 * 自己渲染、并能跑通四维体检。
 *
 * 与 test/static.smoke.js 的区别：静态站冒烟验的是产物在受控桩数据下的行为，
 * 这个脚本验的是「用户浏览器实际拿到的东西 + 真实第三方接口」能否跑通。
 * 因此它依赖外网与第三方接口可用性，不适合放进 CI，只作为交付前的线上核对。
 *
 * 需要 jsdom（devDependencies，可选）：
 *   npm i -D jsdom     或设 WB_NODE_MODULES 指向已有 node_modules
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const NM = process.env.WB_NODE_MODULES || 'C:/Users/22617/.workbuddy/binaries/node/workspace/node_modules';
const { JSDOM, VirtualConsole } = require(path.join(NM, 'jsdom'));

const BASE = process.env.DR_LIVE_BASE || 'https://kfat77.github.io/dragon-radar/';
const FILES = [
  'index.html', 'style.css', 'app.js', 'engine.js', 'api-static.js',
  'lib/score.js', 'lib/sources.js', 'lib/security.js', 'lib/checkup.js',
];
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-live-'));

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  OK ' + name);
  else { console.error('  FAIL ' + name + (extra ? ' -> ' + extra : '')); fails++; }
};

(async function main() {
  console.log('线上产物验证：' + BASE);
  console.log('落盘目录：' + DIR);

  // 1) 下载线上文件
  for (const rel of FILES) {
    const r = await fetch(BASE + rel, { cache: 'no-store' });
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true });
    fs.writeFileSync(path.join(DIR, rel), buf);
    console.log('    下载 ' + rel.padEnd(20) + ' HTTP ' + r.status + '  ' + buf.length + ' 字节');
    if (!r.ok) fails++;
  }

  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
    .replace(/<script src="[^"]*"><\/script>/g, '');

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { console.error('jsdomError:', e.message); fails++; });
  vc.on('error', (m) => { console.error('console.error:', m); fails++; });

  const dom = new JSDOM(html, { url: BASE, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  const realFetch = globalThis.fetch;
  let hits = 0;
  window.fetch = (input, init) => { hits++; return realFetch(new URL(typeof input === 'string' ? input : input.url, BASE).href, init); };
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  window.scrollTo = () => {};
  window.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    const base = { createLinearGradient: () => ({ addColorStop: noop }), measureText: () => ({ width: 0 }), canvas: this };
    return new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
  };

  // 装载顺序必须与 docs/index.html 里 build:scripts 注入的序列一致：
  // 引擎与适配层依赖先加载的 lib/*.js
  const ORDER = ['lib/score.js', 'lib/sources.js', 'lib/security.js', 'lib/checkup.js', 'engine.js', 'api-static.js', 'app.js'];
  for (const rel of ORDER) {
    window.eval(fs.readFileSync(path.join(DIR, rel), 'utf8'));
  }

  ok('线上 lib/security.js 装载出 window.DragonSecurity', !!window.DragonSecurity);
  ok('线上 lib/checkup.js 装载出 window.DragonCheckup', !!window.DragonCheckup);
  ok('线上 api-static.js 装载出 window.DragonApi', !!window.DragonApi);

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];

  // 2) 等首轮真实扫描
  for (let i = 0; i < 400 && !window.DragonEngine.state.tokens.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const st = window.DragonEngine.state;
  ok('线上版本完成首轮真实扫描', st.scanCount >= 1, 'scanCount=' + st.scanCount);
  ok('线上版本扫出标的', st.tokens.length > 0, st.tokens.length + ' 个');
  ok('扫描无报错', !st.error, String(st.error));
  ok('卡片真实渲染', $$('.radar-card').length >= 8, String($$('.radar-card').length));
  ok('工具条含总资金输入框', !!$('[data-radar-capital]'));
  ok('卡片带体检按钮', $$('.radar-card [data-cu-btn]').length >= 8);

  // 3) 真实跑一次四维体检
  const card = $$('.radar-card')[0];
  const sym = card.querySelector('.radar-title h3').textContent;
  const chain = card.querySelector('.radar-chain').textContent.trim();
  console.log('    对线上首个标的发起真实体检：' + sym + ' (' + chain + ')');
  card.querySelector('[data-cu-btn]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const cardOf = (s) => $$('.radar-card').find((c) => {
    const h = c.querySelector('.radar-title h3');
    return h && h.textContent === s;
  });
  const panelOf = () => { const c = cardOf(sym); return c && c.querySelector('[data-cu-body]'); };
  const t0 = Date.now();
  for (let i = 0; i < 400 && !(panelOf() && panelOf().querySelector('.radar-cu-dim')); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const panel = panelOf();
  console.log('    体检耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  ok('线上真实体检渲染出四维结果', !!(panel && panel.querySelector('.radar-cu-dim')), panel ? panel.textContent.slice(0, 120) : '(无面板)');
  if (panel && panel.querySelector('.radar-cu-dim')) {
    ok('含安全 / 叙事 / 筹码 / 位置', /安全 · 合约能不能碰/.test(panel.textContent) && /位置 · 该不该进、该进多少/.test(panel.textContent));
    ok('给出结论与仓位', /可参与|小仓试错|不追|观察|直接放弃|数据不足/.test(panel.textContent) && /建议仓位/.test(panel.textContent));
    // 集中度必须交代口径：有数据时写清是剔除后重算还是退回原始值；没有前排名单时
    // 明确写「未取得」。三种都不出现，说明筹码维度根本没走到这一步。
    ok('筹码集中度交代了口径（重算 / 原始值 / 未取得）',
      /剔除池子\/销毁\/锁仓后重算/.test(panel.textContent)
        || /GoPlus 原始值/.test(panel.textContent)
        || /前十大集中度：未取得/.test(panel.textContent));
    // 缺数据最容易被印成 undefined 或 NaN，而它们看起来像结论。这条一次拦住整类问题。
    ok('面板里不出现 undefined 或 NaN',
      !/undefined|NaN/.test(panel.textContent),
      (panel.textContent.match(/[^。]{0,50}(undefined|NaN)[^。]{0,50}/) || [''])[0]);
    if (/流动性池储备/.test(panel.textContent)) {
      console.log('    （该标的的前排含池子储备，已按 owner 剔除）');
    }
    console.log('    结论行：' + panel.querySelector('.radar-cu-summary').textContent);
    console.log('    数据来源：' + (panel.textContent.match(/数据来源：[^。]+/) || [''])[0]);
  }
  ok('总请求数 > 0（确实在联网）', hits > 0, String(hits));

  console.log(fails ? '\n失败 ' + fails + ' 项' : '\n全部通过');
  window.DragonEngine.stop();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('运行异常：', e); process.exit(1); });
