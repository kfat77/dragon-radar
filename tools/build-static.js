#!/usr/bin/env node
/**
 * 组装 GitHub Pages 用的纯静态站点到 docs/
 *
 * 单一数据源，不做人工同步：
 *   lib/score.js      -> docs/lib/score.js     龙分模型
 *   lib/sources.js    -> docs/lib/sources.js   公开数据源封装
 *   lib/security.js   -> docs/lib/security.js  合约安全 / 筹码 / 仿盘
 *   lib/checkup.js    -> docs/lib/checkup.js   四维体检模型
 *   src/engine.js     -> docs/engine.js        浏览器端引擎
 *   src/static-api.js -> docs/api-static.js    /api/* 适配层
 *   public/app.js     -> docs/app.js           渲染层（与 Node 形态同一份）
 *   public/style.css  -> docs/style.css
 *   public/index.html -> docs/index.html       注入静态形态的 <script> 序列
 *
 * 自定义域名：仓库根目录放 cname.txt（内容为裸域名，一行），或设环境变量
 * DR_CUSTOM_DOMAIN，构建时会写出 docs/CNAME。两者都没有则不生成 CNAME，
 * 站点直接跑在 GitHub Pages 默认地址上。
 *
 * 用法： node tools/build-static.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

const STATIC_SCRIPTS = [
  '<!-- 静态形态：浏览器端引擎 + /api/* 适配层，无后端进程 -->',
  '<script src="./lib/score.js"></script>',
  '<script src="./lib/sources.js"></script>',
  '<script src="./lib/security.js"></script>',
  '<script src="./lib/checkup.js"></script>',
  '<script src="./engine.js"></script>',
  '<script src="./api-static.js"></script>',
  '<script src="./app.js"></script>',
].join('\n');

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), to);
  return path.relative(ROOT, to).replace(/\\/g, '/');
}

function readCustomDomain() {
  const fromEnv = (process.env.DR_CUSTOM_DOMAIN || '').trim();
  if (fromEnv) return fromEnv;
  const f = path.join(ROOT, 'cname.txt');
  if (!fs.existsSync(f)) return '';
  const raw = fs.readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return raw[0] || '';
}

function main() {
  fs.rmSync(DOCS, { recursive: true, force: true });
  fs.mkdirSync(path.join(DOCS, 'lib'), { recursive: true });

  const written = [];
  // 单币详情与四维体检在浏览器端同样可用：体检的外部风控接口均带 CORS 允许头，
  // 静态站可以直接联网调用，不需要服务端代理。
  written.push(copy('lib/score.js', path.join(DOCS, 'lib/score.js')));
  written.push(copy('lib/sources.js', path.join(DOCS, 'lib/sources.js')));
  written.push(copy('lib/security.js', path.join(DOCS, 'lib/security.js')));
  written.push(copy('lib/checkup.js', path.join(DOCS, 'lib/checkup.js')));
  written.push(copy('src/engine.js', path.join(DOCS, 'engine.js')));
  written.push(copy('src/static-api.js', path.join(DOCS, 'api-static.js')));
  written.push(copy('public/style.css', path.join(DOCS, 'style.css')));
  written.push(copy('public/app.js', path.join(DOCS, 'app.js')));

  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const re = /<!--\s*build:scripts\s*-->[\s\S]*?<!--\s*\/build:scripts\s*-->/;
  if (!re.test(html)) {
    throw new Error('public/index.html 里找不到 build:scripts 注入位，构建中止');
  }
  fs.writeFileSync(
    path.join(DOCS, 'index.html'),
    html.replace(re, STATIC_SCRIPTS),
    'utf8'
  );
  written.push('docs/index.html');

  // 让 GitHub Pages 跳过 Jekyll 处理，避免多余构建与非预期过滤
  fs.writeFileSync(path.join(DOCS, '.nojekyll'), '', 'utf8');
  written.push('docs/.nojekyll');

  const domain = readCustomDomain();
  if (domain) {
    fs.writeFileSync(path.join(DOCS, 'CNAME'), domain + '\n', 'utf8');
    written.push('docs/CNAME -> ' + domain);
  }

  console.log('静态站点已生成到 docs/：');
  written.forEach((f) => console.log('  ' + f));
  console.log(domain
    ? '自定义域名：' + domain
    : '未配置自定义域名，站点将使用 GitHub Pages 默认地址。');
}

main();
