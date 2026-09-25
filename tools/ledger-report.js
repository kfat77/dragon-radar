#!/usr/bin/env node
/**
 * 抓龙胜率离线报告
 *
 *   node tools/ledger-report.js                    读取 data/ledger.json，打印全部视界的统计
 *   node tools/ledger-report.js --horizon=1h       只看某个视界
 *   node tools/ledger-report.js --why=upgrade      只看升级信号
 *   node tools/ledger-report.js --chain=solana     只看某条链
 *   node tools/ledger-report.js --file=path.json   指定账本文件
 *
 * 为什么要有它：账本是「先记录、后结算」的，数字是一点点攒出来的。想随时看进度不必开着服务、
 * 也不必开页面 —— 直接读已经落盘的账本即可。本工具只读不写，不会改动任何数据。
 *
 * 报告口径（与页面上完全一致，同一个 lib/ledger.js）：
 *   胜率、同期榜单指数基准、样本流失率三件事必须一起读，缺一个都会误导。
 *   样本不足 MIN_SAMPLE 笔时只打印计数与「样本积累中」，不给结论。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const L = require('../lib/ledger');

const ROOT = path.resolve(__dirname, '..');

function arg(name, dflt) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
}

const FILE = path.resolve(ROOT, arg('file', path.join('data', 'ledger.json')));

function pct(v) {
  if (v == null || !isFinite(v)) return '   —   ';
  const s = (v * 100).toFixed(1) + '%';
  return (v >= 0 ? '+' : '') + s;
}
function rate(v) { return v == null || !isFinite(v) ? '  —  ' : (v * 100).toFixed(1) + '%'; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function tsOf(ms) { return ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—'; }

function main() {
  if (!fs.existsSync(FILE)) {
    console.error('找不到账本文件：' + FILE);
    console.error('先跑一轮采集：npm start（或把 --file 指向别处的账本）');
    process.exit(1);
  }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { console.error('账本文件不是合法 JSON：' + e.message); process.exit(1); }

  const led = L.normalize(raw);
  const signals = Object.keys(led.signals).length;

  console.log('抓龙胜率报告（前瞻记录 + 事后结算，不做历史回放）');
  console.log('账本文件：' + path.relative(ROOT, FILE).replace(/\\/g, '/'));
  console.log('开始记录：' + tsOf(led.startedAt) + '    最后推进：' + tsOf(led.lastTs));
  console.log('扫描轮次：' + (led.counts.rounds || 0)
    + '    存续信号：' + signals
    + '    累计开仓：' + (led.counts.opened || 0)
    + '    完成结算：' + (led.counts.settled || 0)
    + '    记流失：' + (led.counts.gaveUp || 0));
  console.log('榜单指数：' + led.index.length + ' 个采样点，等权净值 '
    + (led.index.length ? L.summarize(led, {}).index.marketLevel.toFixed(4) : '—')
    + '（中位口径参照 ' + (led.index.length ? L.summarize(led, {}).index.level.toFixed(4) : '—') + '）');
  console.log('');

  if (!signals) {
    console.log('账本还是空的。它是「先记录、后结算」的：服务跑起来后每轮扫描才会开始积累样本。');
    return;
  }

  const onlyH = arg('horizon', '');
  const onlyWhy = arg('why', 'all');
  const chain = arg('chain', '');
  const horizons = onlyH ? L.HORIZONS.filter((h) => h.key === onlyH) : L.HORIZONS;
  if (!horizons.length) {
    console.error('未知视界：' + onlyH + '（可用：' + L.HKEYS.join(' / ') + '）');
    process.exit(1);
  }

  console.log('样本门槛：' + L.MIN_SAMPLE + ' 笔。低于门槛只报计数，不给胜率结论。');
  console.log('');
  console.log(pad('视界', 10) + padL('已结算', 8) + padL('待结算', 8) + padL('流失', 6)
    + padL('胜率', 9) + padL('中位收益', 11) + padL('基准收益', 11)
    + padL('中位超额', 11) + padL('跑赢基准', 10));

  for (const h of horizons) {
    const s = L.summarize(led, { horizon: h.key, why: onlyWhy, chain });
    const enough = s.sampleEnough;
    console.log(
      pad(h.label, 10) + padL(s.n, 8) + padL(s.waiting, 8) + padL(s.dead, 6)
      + padL(enough ? rate(s.winRate) : '积累中', 9)
      + padL(enough ? pct(s.median) : '—', 11)
      + padL(enough ? (s.benchmark.marketReturn == null ? '无基准' : pct(s.benchmark.marketReturn)) : '—', 11)
      + padL(enough ? (s.benchmark.medianExcess == null ? '无基准' : pct(s.benchmark.medianExcess)) : '—', 11)
      + padL(enough ? rate(s.benchmark.beatRate) : '—', 10)
    );
  }
  console.log('');

  // 明细：按档位分层，看龙分有没有区分度
  const ref = onlyH || '1h';
  const s = L.summarize(led, { horizon: ref, why: onlyWhy, chain });
  console.log('按档位分层（' + s.horizonLabel + ' · ' + s.whyLabel + '）');
  if (!s.byGrade.length) {
    console.log('  该视界下还没有已结算样本。');
  } else {
    console.log('  ' + pad('档位', 12) + padL('样本', 6) + padL('胜率', 9) + padL('中位收益', 11) + padL('中位超额', 11));
    for (const g of s.byGrade) {
      console.log('  ' + pad(g.label, 12) + padL(g.n, 6)
        + padL(s.sampleEnough ? rate(g.winRate) : '积累中', 9)
        + padL(g.median == null ? '—' : pct(g.median), 11)
        + padL(g.medianExcess == null ? '无基准' : pct(g.medianExcess), 11));
    }
  }
  console.log('');

  if (!s.sampleEnough) {
    console.log('结论：样本积累中（' + s.n + '/' + L.MIN_SAMPLE + ' 笔）。'
      + '样本不足时本工具只报计数 —— 几笔的胜率没有解释力，写出来比不写更误导。');
  } else {
    console.log('结论（' + s.horizonLabel + ' · ' + s.whyLabel + '）：'
      + s.n + ' 笔已结算，胜率 ' + rate(s.winRate) + '，中位收益 ' + pct(s.median)
      + (s.benchmark.medianExcess == null
        ? '；同期榜单指数没有采样点，超额无法计算。'
        : '；同期等权榜单指数 ' + pct(s.benchmark.marketReturn) + '，中位超额 ' + pct(s.benchmark.medianExcess)
          + '，跑赢基准 ' + rate(s.benchmark.beatRate) + '。'));
  }
  if (s.dead) {
    console.log('流失 ' + s.dead + ' 笔（到期仍补不到价格，多半是池子被撤或标的归零）。'
      + '它们不计入胜率分母 —— 从统计里抹掉这批，胜率会系统性虚高。');
  }
  if (s.avgMae != null) {
    console.log('平均最大浮亏 ' + pct(s.avgMae) + '（' + s.maeN + ' 笔有观测序列）。'
      + '只有收益没有回撤，胜率会显得比实际舒服。');
  }
  console.log('');
  console.log('已知偏差：候选池由推广榜 / 新资料 / 关键词扩样合成，不是全市场；'
    + '榜单指数偏向活得久的标的。两者同向受影响，做比较仍然成立，但不能外推到整个市场。');
  console.log('本报告基于公开数据整理，仅供参考，不构成投资建议。过往表现不预示未来收益。');
}

main();
