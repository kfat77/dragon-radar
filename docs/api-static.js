/**
 * 静态部署下的数据适配层
 *
 * 纯静态托管（GitHub Pages）没有后端进程，页面无法调用 server.js 的 /api/*。
 * 本文件把同一批 /api/* 路径翻译成浏览器端 DragonEngine 的调用，并挂到
 * window.DragonApi 上；public/app.js 检测到它就直接使用，渲染层代码一行不改。
 *
 * 依赖：lib/score.js（window.DragonScore）、lib/sources.js（window.DragonSources）、
 *       src/engine.js（window.DragonEngine）
 * 导出：window.DragonApi
 */
(function (root) {
  'use strict';

  var E = root.DragonEngine;
  var S = root.DragonSources;
  var SC = root.DragonScore;
  if (!E || !S || !SC) throw new Error('DragonApi 需要先加载 lib/*.js 与 src/engine.js');

  function ok(body) { return { status: 200, ok: true, body: body }; }
  function bad(status, body) { return { status: status, ok: false, body: body }; }

  // 从 "/api/radar?a=1&b=2" 里取出路径与查询参数
  function parse(path) {
    var s = String(path || '');
    var i = s.indexOf('?');
    var p = i < 0 ? s : s.slice(0, i);
    var q = {};
    if (i >= 0) {
      new URLSearchParams(s.slice(i + 1)).forEach(function (v, k) { q[k] = v; });
    }
    return { path: p, query: q };
  }

  function bodyOf(opts) {
    if (!opts || !opts.body) return {};
    try { return typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body; }
    catch (e) { return {}; }
  }

  async function api(path, opts) {
    opts = opts || {};
    var r = parse(path);
    var method = String(opts.method || 'GET').toUpperCase();
    var q = r.query;

    // 元信息：链清单、因子权重、分级口径
    if (r.path === '/api/meta') {
      return ok({
        chains: S.CHAIN_LABEL,
        defaultChains: S.DEFAULT_CHAINS,
        weights: SC.WEIGHTS,
        grades: SC.GRADES,
        scanIntervalMs: E.SCAN_INTERVAL_MS,
        meta: E.state.meta,
      });
    }

    // 榜单
    if (r.path === '/api/radar') {
      return ok(E.radar({
        chain: q.chain || 'all',
        view: q.view || 'all',
        sort: q.sort || 'score',
        q: q.q || '',
        minLiq: q.minLiq || 0,
        limit: q.limit || 260,
      }));
    }

    // 手动触发一轮扫描（静态形态下同步等待整轮结束）
    if (r.path === '/api/scan') {
      var res = await E.scan();
      return res && res.ok === false ? bad(500, res) : ok(res || { ok: true });
    }

    // 运行状态
    if (r.path === '/api/health') return ok(E.health());

    // 单币详情：优先用本轮已算好的结果，没有就现拉一次行情并单独打分
    var tm = /^\/api\/token\/([^/]+)\/([^/]+)$/.exec(r.path);
    if (tm) {
      var detail = await E.tokenDetail(decodeURIComponent(tm[1]), decodeURIComponent(tm[2]));
      return detail ? ok(detail) : bad(404, { error: 'not found' });
    }

    // 四维体检（安全 / 叙事 / 筹码 / 位置）
    // 需要外部风控接口，GoPlus 免费档一次只受理一个地址，所以按需触发并在引擎内长缓存。
    var cm = /^\/api\/checkup\/([^/]+)\/([^/]+)$/.exec(r.path);
    if (cm) {
      var cr = await E.checkup(decodeURIComponent(cm[1]), decodeURIComponent(cm[2]), {
        force: q.force === '1',
        profile: q.capital ? { totalCapitalUsd: Number(q.capital) } : undefined,
      });
      if (!cr || cr.ok === false) return bad(502, cr || { error: 'checkup failed' });
      return ok(cr);
    }

    // 单币实时报价
    if (r.path === '/api/price') {
      var addr = q.address || '';
      if (!addr) return bad(400, { error: 'missing address' });
      var p = await E.price(addr);
      return p ? ok({ price: p }) : bad(404, { error: 'not found' });
    }

    // 自选（常驻候选池），存在浏览器 localStorage
    if (r.path === '/api/watchlist') {
      if (method === 'POST') {
        await E.addWatch(bodyOf(opts));
        return ok({ watchlist: E.watchlist() });
      }
      if (method === 'DELETE') {
        E.removeWatch(q.address || '', q.chainId || '');
        return ok({ watchlist: E.watchlist() });
      }
      return ok({ watchlist: E.watchlist() });
    }

    // 追踪 / 抄作业：fomo.family 的实时资料需要登录态令牌，静态站拿不到。
    // 这里不做任何伪造：明确返回 needsAuth，由页面展示官方公开名片。
    var m = /^\/api\/fomo\/(.+)$/.exec(r.path);
    if (m) {
      var handle = decodeURIComponent(m[1]);
      return ok({
        handle: handle,
        user: null,
        needsAuth: true,
        message: '静态部署没有服务端代理，浏览器直连 fomo.family 会被跨域策略拦下。'
          + '本页只展示其官方公开名片；需要实时持仓请在本地用 Node 形态运行（npm start）。',
        publicCard: 'https://image-renderer.fomo.cloud/og/profile/' + encodeURIComponent(handle) + '/card.png',
        profileUrl: 'https://fomo.family/profile/' + encodeURIComponent(handle),
      });
    }

    return bad(404, { error: 'unknown endpoint: ' + r.path });
  }

  root.DragonApi = api;
})(typeof self !== 'undefined' ? self : this);
