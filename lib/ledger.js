/**
 * 抓龙雷达 · 信号账本与前瞻回测（纯逻辑，零依赖）
 *
 * 这个模块回答一个问题：雷达给出的信号，事后到底赚不赚钱。
 *
 * ================================================================
 * 为什么是「实时记录 + 事后结算」，而不是「历史回测」
 * ================================================================
 * 龙分的八个因子里，只有量能爆发、价格加速度、池龄、市值这几项能从公开历史数据重建；
 * 买卖笔数分布、池子深度、持币地址数、社交与付费推广状态，公开历史里根本不存在。
 * 拿现在的值去回放过去，等于把「后来涨了才会变大的成交量」当成入场时的依据 ——
 * 那不是回测，是把答案抄进题目。所以本模块不做历史回放。
 *
 * 取而代之：每个标的第一次出现在榜单上时，把那一刻的真实状态（分数、八因子、市值、
 * 深度、池龄、置信度、风险扣分）原样记下来；等 15 分钟 / 1 小时 / 6 小时 / 24 小时
 * 到点后，再用那一刻的真实价格结算。信号是先记的，价格是后取的，没有前视偏差。
 *
 * ================================================================
 * 三个必须同时给出的数，缺一个都会误导
 * ================================================================
 * 1. 胜率本身：正收益占比。但单看胜率没有意义 —— 如果那段时间全市场都在涨，
 *    闭着眼睛买也是高胜率。
 * 2. 榜单指数基准：同一时段、同一个榜单里所有连续在榜标的的等权收益（每轮再平衡）。
 *    超额收益 = 信号收益 - 基准收益。这才回答「雷达选的比雷达池子的平均强吗」。
 * 3. 样本流失率：到点却补不到价格的信号，单独统计，不并入胜率分母之外的任何地方。
 *    掉出榜单的标的很可能就是归零那批，把它们从统计里悄悄抹掉会让胜率系统性虚高。
 *
 * 样本量不足 MIN_SAMPLE 时，本模块只输出原始计数与「样本积累中」，不给结论。
 *
 * ================================================================
 * 基准为什么用「等权平均」而不是「中位数」（线上实测踩到的）
 * ================================================================
 * 第一版基准取的是每轮的中位收益。跑起来发现指数线永远贴在 1.0000：
 * 这类新池子里有大量「一分钟内价格完全没动」的标的，只要过半标的没动，
 * 当轮中位数就精确等于 0，连乘下来整条线是死的。基准恒为 0 之后，
 * 「跑赢基准」退化成「收益为正」，和胜率成了同一个数 —— 基准就白设了。
 * 所以基准改成等权平均，并且为了不被个别脏点带飞，单轮做 10% 截尾。
 * 中位收益仍然记录，只是降级成参照（它说明的是「中位标的其实没动」）。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DragonLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 2：榜单指数从「每轮中位收益」改成「每轮 10% 截尾等权收益」。
  // 旧账本没有等权字段，加载时直接重置 —— 一条指数上混两种口径，比丢数据更糟。
  var VERSION = 2;

  // ---------------------------------------------------------------- 常量
  var HORIZONS = [
    { key: '15m', ms: 15 * 60e3, label: '15 分钟' },
    { key: '1h', ms: 60 * 60e3, label: '1 小时' },
    { key: '6h', ms: 6 * 60 * 60e3, label: '6 小时' },
    { key: '24h', ms: 24 * 60 * 60e3, label: '24 小时' },
  ];
  var HKEYS = HORIZONS.map(function (h) { return h.key; });

  var WHY_LABEL = { first: '首现信号', upgrade: '档位升级信号' };
  // 达到「龙头候选」及以上才算升级信号：这是雷达上真正会让人动手的那一档
  var UPGRADE_RANK = 1;

  var MIN_SAMPLE = 30;              // 少于此样本不给结论，只报计数
  var GIVEUP_MS = 48 * 3600e3;      // 超过 48 小时仍补不到价格，记流失
  var OBS_INTERVAL_MS = 5 * 60e3;   // 未结算信号的观测点间隔（用于算最大不利偏移）
  var OBS_MAX = 288;                // 每信号观测点上限（5 分钟粒度约等于 24 小时）
  var INDEX_MIN_N = 3;              // 指数单轮至少要有这么多个标的才算数
  var INDEX_MAX = 4000;             // 指数序列上限
  var TRIM_P = 0.10;                // 单轮收益的截尾比例（首尾各 10%）
  var TRIM_MIN_N = 20;              // 标的少于此数就不截尾，直接用均值
  var SIGNAL_MAX = 20000;           // 信号上限，超出后优先丢弃已结算且最旧的
  var MIN_ROUND_GAP_MS = 30e3;      // 两轮之间至少隔这么久才算新的一轮

  var GRADE_RANK = { dragon: 0, candidate: 1, latent: 2, watch: 3, trash: 4 };
  var GRADE_LABEL = { dragon: '真龙', candidate: '龙头候选', latent: '潜龙', watch: '观察', trash: '假龙' };
  var GRADE_ORDER = ['dragon', 'candidate', 'latent', 'watch', 'trash'];

  // ---------------------------------------------------------------- 小工具
  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d === undefined ? 0 : d);
  }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function r2(v) { return Math.round(v * 100) / 100; }
  // 指数专用精度。榜单指数累加的是「轮间收益」，实测每轮量级常在 0.001% 上下，
  // 用 4 位小数（0.01%）存会被整片抹成 0，指数线永远是 1.0，基准就白算了。
  // 另外净值是用未舍入值累乘的，超额却要用已存的值回算 —— 两个精度必须对齐，
  // 否则同一条指数会给出两个不同的区间收益。
  function r8(v) { return Math.round(v * 1e8) / 1e8; }
  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function median(arr) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(arr, q) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var pos = (a.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return a[lo];
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }

  /**
   * 截尾均值：去掉首尾各 p 后的平均。
   *
   * 榜单里偶尔会混进「数据源换了价格单位」这类脏点，一个就能把等权均值抬起来；
   * 中位数倒是抗噪，但在这个市场里恒为 0（过半标的根本不走），没法当基准。
   * 截尾均值是两者的折中：抗个别脏点，又保留了「大部分标的都在涨」这件事。
   *
   * 代价要说清楚：截尾会丢掉尾部，如果行情确实只由少数标的拉起，基准会偏低、
   * 超额会偏高。所以汇总里同时给出未截尾的均值，供对照。
   */
  function trimmedMean(arr, p) {
    if (!arr.length) return null;
    if (arr.length < TRIM_MIN_N) {
      var s0 = 0;
      for (var j = 0; j < arr.length; j++) s0 += arr[j];
      return s0 / arr.length;
    }
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var k = Math.floor(a.length * p);
    if (a.length - 2 * k < 1) return median(a);
    var s = 0;
    for (var i = k; i < a.length - k; i++) s += a[i];
    return s / (a.length - 2 * k);
  }

  function horizonByKey(k) {
    for (var i = 0; i < HORIZONS.length; i++) if (HORIZONS[i].key === k) return HORIZONS[i];
    return null;
  }
  function sigId(why, k) { return why + '|' + k; }

  function emptyIdx() {
    return {
      key: 'all', n: 0, med: null, mean: null, level: 1, mlevel: 1,
      chains: {},
    };
  }

  // ---------------------------------------------------------------- 建账本
  function create() {
    return {
      v: VERSION,
      startedAt: 0,
      lastTs: 0,
      seq: 0,
      signals: {},          // id -> signal
      // [{ts, n, med, mean, level, mlevel, chains:{id:[n,med,mean]}}]
      // med 是当轮中位收益（参照），mean 是当轮截尾等权收益（基准本体）
      index: [],
      indexLevel: 1,        // 中位口径净值（参照）
      marketLevel: 1,       // 等权口径净值（基准本体）
      prev: {},             // key -> 上一轮的 priceUsd（算榜单指数用）
      counts: { opened: 0, settled: 0, gaveUp: 0, rounds: 0 },
    };
  }

  function isLedger(led) {
    return !!(led && typeof led === 'object' && led.signals && Array.isArray(led.index));
  }

  /**
   * 读取入口统一走这里：旧版本或损坏的账本直接重置，不让半个结构污染统计。
   * 版本号是硬门槛 —— 指数口径换过一次，旧账本没有等权字段，接着用会让一条线上
   * 混着两种口径，比直接重来更糟。
   */
  function normalize(led) {
    if (!isLedger(led)) return create();
    if (Number(led.v) !== VERSION) return create();
    if (!led.counts || typeof led.counts !== 'object') led.counts = { opened: 0, settled: 0, gaveUp: 0, rounds: 0 };
    if (!led.prev || typeof led.prev !== 'object') led.prev = {};
    if (!finite(led.indexLevel) || led.indexLevel <= 0) led.indexLevel = 1;
    if (!finite(led.marketLevel) || led.marketLevel <= 0) led.marketLevel = 1;
    if (!led.v) led.v = VERSION;
    return led;
  }

  // ---------------------------------------------------------------- 榜单指数
  /**
   * 榜单指数：每一轮，取「上一轮与这一轮都在榜」的标的，算各自的轮间收益，取中位数。
   * 把它连乘起来就是一条等权、每轮再平衡的参考线。
   *
   * 为什么要它：单看胜率无法区分「雷达选得准」和「那阵子全市场在涨」。
   * 有了这条线，超额收益 = 信号收益 - 同期指数收益，才是雷达自己的贡献。
   *
   * 已知口径限制（不藏）：新进榜的标的当轮没有上一轮价格，不计入；掉出榜单的标的
   * 在最后那一轮之后就不再计入。所以它偏向「活得久」的那批，与信号账本面对的是
   * 同一类幸存者问题 —— 但两者同向受影响，做比较仍然成立。
   */
  function updateIndex(led, priceMap, now) {
    var prev = led.prev;
    var all = [];
    var chains = {};
    Object.keys(priceMap).forEach(function (k) {
      var p0 = prev[k], p1 = priceMap[k];
      if (!(p0 > 0) || !(p1 > 0)) return;
      var ret = p1 / p0 - 1;
      // 单轮涨跌超过 10 倍基本是数据源把价格单位换了，这种脏点必须剔掉，
      // 否则一次就能把整条指数线拉飞。
      if (!isFinite(ret) || ret <= -0.95 || ret >= 9) return;
      all.push(ret);
      var chain = k.split(':')[0];
      (chains[chain] || (chains[chain] = [])).push(ret);
    });

    led.prev = priceMap;

    if (all.length < INDEX_MIN_N) {
      led.lastTs = now;
      led.counts.rounds++;
      return null;
    }
    var med = median(all);
    var tmean = trimmedMean(all, TRIM_P);
    led.indexLevel = led.indexLevel * (1 + med);
    led.marketLevel = led.marketLevel * (1 + tmean);
    var entry = {
      ts: now, n: all.length,
      med: r8(med), mean: r8(tmean),
      level: r8(led.indexLevel), mlevel: r8(led.marketLevel),
      chains: {},
    };
    Object.keys(chains).forEach(function (c) {
      if (chains[c].length < INDEX_MIN_N) return;
      entry.chains[c] = [chains[c].length, r8(median(chains[c])), r8(trimmedMean(chains[c], TRIM_P))];
    });
    led.index.push(entry);
    if (led.index.length > INDEX_MAX) led.index.splice(0, led.index.length - INDEX_MAX);
    led.lastTs = now;
    led.counts.rounds++;
    if (!led.startedAt) led.startedAt = now;
    return entry;
  }

  /**
   * 指数在 [from, to] 区间的累计收益。
   * 区间内一个有效采样点都没有时返回 null —— 缺基准就必须显式缺，不能拿 0 顶替，
   * 否则「超额收益」会退化成一个看起来像结论的假数字。
   *
   * which：'mean'（默认，等权截尾口径，基准本体）/ 'med'（中位口径，参照）。
   * 链上没取到该口径时回落到当轮整体值；两级都没有才返回 null。
   */
  function indexReturn(led, from, to, chainId, which) {
    var wantMean = which !== 'med';
    var prod = 1, n = 0;
    for (var i = 0; i < led.index.length; i++) {
      var e = led.index[i];
      if (e.ts <= from || e.ts > to) continue;
      var v = null;
      var c = chainId && e.chains && e.chains[chainId];
      if (c) v = wantMean ? c[2] : c[1];
      if (v == null) v = wantMean ? e.mean : e.med;
      if (v == null) continue;
      prod *= (1 + v);
      n++;
    }
    if (!n) return null;
    return r8(prod - 1);
  }

  // ---------------------------------------------------------------- 结算
  /**
   * 把到点且拿得到价格的视界写进信号。
   * 有效价格的口径：必须是正的有限数。0 与负数在链上行情里代表「池子没了/取数出错」，
   * 当成 0 收益会把最危险的那批悄悄记成「不亏不赚」。
   */
  function settleOne(sig, priceMap, obs, now) {
    var added = 0;
    for (var i = 0; i < HORIZONS.length; i++) {
      var h = HORIZONS[i];
      if (sig.r[h.key]) continue;
      var due = sig.t0 + h.ms;
      if (now < due) continue;
      var p = priceMap[sig.k];
      var src = 'board';
      if (!(p > 0)) {
        var series = obs[sig.id];
        var hit = pickObs(series, due, Math.max(h.ms * 0.25, 10 * 60e3));
        if (hit) { p = hit.p; src = 'obs'; }
      }
      if (!(p > 0)) continue;
      var ret = p / sig.price0 - 1;
      if (!isFinite(ret)) continue;
      var rec = {
        at: now, dt: Math.round((now - sig.t0) / 1000),
        late: Math.round((now - due) / 1000),
        p: p, r: r4(ret), src: src,
      };
      // 最大不利偏移：从开仓到结算之间出现过的最差浮亏。
      // 只有收益数字没有回撤数字，会让「胜率很高」看起来比实际舒服得多。
      var mae = worstOf(obs[sig.id], sig.t0, now, sig.price0);
      if (mae != null) rec.mae = r4(mae);
      sig.r[h.key] = rec;
      added++;
    }
    return added;
  }

  /** 在观测序列里取最接近 target 的点（容差内），取不到返回 null */
  function pickObs(series, target, tolMs) {
    if (!series || !series.length) return null;
    var best = null, bestD = Infinity;
    for (var i = 0; i < series.length; i++) {
      var d = Math.abs(series[i][0] - target);
      if (d < bestD) { bestD = d; best = series[i]; }
    }
    if (!best || bestD > tolMs) return null;
    return { ts: best[0], p: best[1] };
  }

  function worstOf(series, from, to, price0) {
    if (!series || !series.length || !(price0 > 0)) return null;
    var worst = null;
    for (var i = 0; i < series.length; i++) {
      var t = series[i][0], p = series[i][1];
      if (t <= from || t > to) continue;
      if (!(p > 0)) continue;
      var ret = p / price0 - 1;
      if (worst == null || ret < worst) worst = ret;
    }
    return worst;
  }

  /** 记录未结算信号的观测点，供最大不利偏移与离线补价使用 */
  function pushObs(obs, id, now, price) {
    if (!(price > 0)) return;
    var series = obs[id] || (obs[id] = []);
    var last = series[series.length - 1];
    // 同一个 5 分钟窗口内只保留最新价（避免 1 分钟一轮把序列撑爆）。
    // 比的是「窗口编号」，不是「距上一个点的间隔」：按间隔比的话，连续运行时每一轮
    // 都落在 5 分钟以内，每个点都会被就地覆盖，序列永远只有 1 个点 ——
    // 最大不利偏移和离线补价会一起失效，而且表面上完全看不出来。
    if (last && Math.floor(last[0] / OBS_INTERVAL_MS) === Math.floor(now / OBS_INTERVAL_MS)) {
      last[0] = now; last[1] = price;
      return;
    }
    series.push([now, price]);
    if (series.length > OBS_MAX) series.splice(0, series.length - OBS_MAX);
  }

  // ---------------------------------------------------------------- 开仓
  function snapshot(tok, why, now) {
    var f = tok.factors || {};
    var fc = {};
    Object.keys(f).forEach(function (k) { fc[k] = Math.round(num(f[k] && f[k].score, 0)); });
    return {
      id: sigId(why, tok.key),
      why: why,
      k: tok.key,
      chainId: tok.chainId,
      tokenAddress: tok.tokenAddress,
      symbol: tok.symbol || '?',
      t0: now,
      price0: num(tok.priceUsd, 0),
      score: Math.round(num(tok.score, 0)),
      grade: tok.grade || 'trash',
      gradeLabel: tok.gradeLabel || GRADE_LABEL[tok.grade] || '',
      confidence: Math.round(num(tok.confidence, 0)),
      risk: Math.round(num(tok.risk, 0)),
      fdv0: Math.round(num(tok.fdv || tok.marketCap, 0)),
      liq0: Math.round(num(tok.liquidityUsd, 0)),
      ageMin0: tok.ageMin == null ? null : Math.round(num(tok.ageMin, 0)),
      f: fc,
      r: {},
      dead: [],
    };
  }

  // ---------------------------------------------------------------- 主入口
  /**
   * 每轮扫描调用一次。
   *
   * tokens: 本轮评分结果（含 key/chainId/tokenAddress/symbol/priceUsd/score/grade/factors…）
   * now:    本轮时间戳
   *
   * 返回 { settled, opened, needPrices, gaveUp, index }
   *   needPrices —— 已到点但本轮榜单里没有、且本地观测也补不到的标的 key，
   *                 调用方拿去批量查一次价格，再调 settle() 即可。没有就说明本轮零额外请求。
   */
  function observe(led, tokens, now) {
    led = normalize(led);
    var obs = led.__obs || (led.__obs = {});
    var out = { settled: 0, opened: 0, needPrices: [], gaveUp: 0, index: null };

    var priceMap = {};
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t || !t.key) continue;
      if (t.priceUsd > 0) priceMap[t.key] = num(t.priceUsd, 0);
    }

    // 1) 结算：先用本轮已经拿到的价格，零额外请求
    var ids = Object.keys(led.signals);
    for (var j = 0; j < ids.length; j++) {
      var sig = led.signals[ids[j]];
      var got = settleOne(sig, priceMap, obs, now);
      out.settled += got;
      led.counts.settled += got;
    }

    // 2) 记录观测点（只给还没结算完的信号，避免无意义的存储膨胀）
    for (var m = 0; m < ids.length; m++) {
      var s2 = led.signals[ids[m]];
      if (isDone(s2)) continue;
      if (priceMap[s2.k] > 0) pushObs(obs, s2.id, now, priceMap[s2.k]);
    }

    // 3) 弃权：太老还补不到价格的，记流失。必须单独计数，不能混进胜率。
    for (var n = 0; n < ids.length; n++) {
      var s3 = led.signals[ids[n]];
      if (now - s3.t0 < GIVEUP_MS) continue;
      for (var q = 0; q < HKEYS.length; q++) {
        if (s3.r[HKEYS[q]] || s3.dead.indexOf(HKEYS[q]) >= 0) continue;
        s3.dead.push(HKEYS[q]);
        led.counts.gaveUp++;
        out.gaveUp++;
      }
    }

    // 4) 待补价：已到点、还没结算、本轮榜单里也没有的
    for (var a = 0; a < ids.length; a++) {
      var s4 = led.signals[ids[a]];
      if (priceMap[s4.k] > 0) continue;
      for (var b = 0; b < HORIZONS.length; b++) {
        if (s4.r[HORIZONS[b].key] || s4.dead.indexOf(HORIZONS[b].key) >= 0) continue;
        if (now >= s4.t0 + HORIZONS[b].ms) {
          if (out.needPrices.indexOf(s4.k) < 0) out.needPrices.push(s4.k);
          break;
        }
      }
    }

    // 5) 开仓：首现信号 + 档位升级信号
    for (var c = 0; c < tokens.length; c++) {
      var tok = tokens[c];
      if (!tok || !tok.key || !(tok.priceUsd > 0)) continue;
      var f1 = sigId('first', tok.key);
      if (!led.signals[f1]) {
        led.signals[f1] = snapshot(tok, 'first', now);
        led.counts.opened++;
        out.opened++;
      }
      var rank = GRADE_RANK[tok.grade];
      if (rank != null && rank <= UPGRADE_RANK) {
        var f2 = sigId('upgrade', tok.key);
        if (!led.signals[f2]) {
          led.signals[f2] = snapshot(tok, 'upgrade', now);
          led.counts.opened++;
          out.opened++;
        }
      }
    }

    // 6) 榜单指数（放在最后，用本轮价格与上一轮价格比）
    if (now - led.lastTs >= MIN_ROUND_GAP_MS || led.lastTs === 0) {
      out.index = updateIndex(led, priceMap, now);
    }

    led.seq++;
    if (!led.startedAt) led.startedAt = now;
    prune(led);
    return out;
  }

  /** 用外部补到的价格结算。priceMap: {key: priceUsd} */
  function settle(led, priceMap, now) {
    led = normalize(led);
    var obs = led.__obs || (led.__obs = {});
    var n = 0;
    Object.keys(led.signals).forEach(function (id) {
      n += settleOne(led.signals[id], priceMap || {}, obs, now);
    });
    led.counts.settled += n;
    return n;
  }

  function isDone(sig) {
    for (var i = 0; i < HKEYS.length; i++) {
      if (!sig.r[HKEYS[i]] && sig.dead.indexOf(HKEYS[i]) < 0) return false;
    }
    return true;
  }

  function unresolvedCount(sig) {
    var n = 0;
    for (var i = 0; i < HKEYS.length; i++) if (!sig.r[HKEYS[i]]) n++;
    return n;
  }

  /** 控制体积：已结算且最早的信号先丢，未结算的一律保留 */
  function prune(led) {
    var ids = Object.keys(led.signals);
    if (ids.length > SIGNAL_MAX) {
      var done = ids.filter(function (id) { return isDone(led.signals[id]); })
        .sort(function (a, b) { return led.signals[a].t0 - led.signals[b].t0; });
      var drop = ids.length - SIGNAL_MAX;
      for (var i = 0; i < drop && i < done.length; i++) {
        delete led.signals[done[i]];
        delete led.__obs[done[i]];
      }
    }
    // 已结算且三条以上观测路径都不用的信号，观测序列可以清掉
    Object.keys(led.__obs).forEach(function (id) {
      var s = led.signals[id];
      if (!s || isDone(s)) delete led.__obs[id];
    });
  }

  function reset(led) {
    led = normalize(led);
    var fresh = create();
    Object.keys(led).forEach(function (k) { delete led[k]; });
    Object.keys(fresh).forEach(function (k) { led[k] = fresh[k]; });
    return led;
  }

  // ---------------------------------------------------------------- 统计
  function bandOf(score) {
    if (score >= 80) return { key: 'd80', label: '80 - 100（真龙）', lo: 80 };
    if (score >= 70) return { key: 'd70', label: '70 - 79（龙头候选）', lo: 70 };
    if (score >= 60) return { key: 'd60', label: '60 - 69（潜龙）', lo: 60 };
    if (score >= 45) return { key: 'd45', label: '45 - 59（观察）', lo: 45 };
    return { key: 'd0', label: '0 - 44（假龙）', lo: 0 };
  }
  var BAND_ORDER = ['d80', 'd70', 'd60', 'd45', 'd0'];

  function groupStats(rows) {
    if (!rows.length) return { n: 0, winRate: null, median: null, mean: null, medianExcess: null, beatRate: null };
    var rets = rows.map(function (x) { return x.r; });
    var ex = rows.map(function (x) { return x.ex; }).filter(finite);
    var wins = rets.filter(function (x) { return x > 0; }).length;
    var beat = ex.filter(function (x) { return x > 0; }).length;
    var mean = rets.reduce(function (s, x) { return s + x; }, 0) / rets.length;
    return {
      n: rows.length,
      winRate: r4(wins / rows.length),
      median: r4(median(rets)),
      mean: r4(mean),
      medianExcess: ex.length ? r4(median(ex)) : null,
      beatRate: ex.length ? r4(beat / ex.length) : null,
    };
  }

  /**
   * 汇总。返回的每一个数都带着它的样本数，缺基准时 excess 一律为 null 而不是 0。
   *
   * opts:
   *   horizon  '15m' | '1h' | '6h' | '24h'   默认 1h
   *   why      'all' | 'first' | 'upgrade'   默认 all
   *   chain    '' | chainId                  默认全部
   */
  function summarize(led, opts) {
    led = normalize(led);
    opts = opts || {};
    var hk = horizonByKey(opts.horizon) ? opts.horizon : '1h';
    var why = opts.why || 'all';
    var chain = opts.chain || '';

    var all = Object.keys(led.signals).map(function (id) { return led.signals[id]; });
    var picked = all.filter(function (s) {
      if (why !== 'all' && s.why !== why) return false;
      if (chain && s.chainId !== chain) return false;
      return true;
    });

    var rows = [], dead = 0, waiting = 0;
    picked.forEach(function (s) {
      var rec = s.r[hk];
      if (!rec) {
        if (s.dead.indexOf(hk) >= 0) dead++;
        else waiting++;
        return;
      }
      // 基准取不到时 ex 显式为 null：宁可少一个数，也不要一个假的 0。
      // idx 用等权口径（基准本体），idxMed 只作参照 —— 它常年贴 0，
      // 拿它算超额会把「跑赢基准」退化成「收益为正」。
      var idx = indexReturn(led, s.t0, rec.at, s.chainId, 'mean');
      var idxMed = indexReturn(led, s.t0, rec.at, s.chainId, 'med');
      rows.push({
        s: s, r: rec.r,
        ex: idx == null ? null : r4(rec.r - idx),
        idx: idx,
        idxMed: idxMed,
        mae: finite(rec.mae) ? rec.mae : null,
      });
    });

    var rets = rows.map(function (x) { return x.r; });
    var exs = rows.map(function (x) { return x.ex; }).filter(finite);
    var idxs = rows.map(function (x) { return x.idx; }).filter(finite);
    var idxMeds = rows.map(function (x) { return x.idxMed; }).filter(finite);
    var maes = rows.map(function (x) { return x.mae; }).filter(finite);
    var base = groupStats(rows);

    // 分层
    var byGrade = GRADE_ORDER.map(function (g) {
      return Object.assign(
        { key: g, label: GRADE_LABEL[g] },
        groupStats(rows.filter(function (x) { return x.s.grade === g; }))
      );
    }).filter(function (x) { return x.n > 0; });

    var byBand = BAND_ORDER.map(function (k) {
      var b = rows.filter(function (x) { return bandOf(x.s.score).key === k; });
      var first = b[0];
      return Object.assign(
        { key: k, label: first ? bandOf(first.s.score).label : k },
        groupStats(b)
      );
    }).filter(function (x) { return x.n > 0; });

    var chainIds = {};
    rows.forEach(function (x) { chainIds[x.s.chainId] = true; });
    var byChain = Object.keys(chainIds).map(function (c) {
      return Object.assign({ key: c, label: c }, groupStats(rows.filter(function (x) { return x.s.chainId === c; })));
    }).sort(function (a, b) { return b.n - a.n; });

    var unresolved = dead + waiting;
    return {
      horizon: hk,
      horizonLabel: (horizonByKey(hk) || {}).label || hk,
      why: why,
      whyLabel: why === 'all' ? '全部信号' : (WHY_LABEL[why] || why),
      chain: chain,
      // 样本充分性：不足时前端只显示计数，不给胜率结论
      sampleEnough: rows.length >= MIN_SAMPLE,
      minSample: MIN_SAMPLE,
      n: rows.length,
      waiting: waiting,
      dead: dead,
      unresolvedRate: (rows.length + unresolved) ? r4(unresolved / (rows.length + unresolved)) : null,
      winRate: base.winRate,
      median: base.median,
      mean: base.mean,
      p25: rets.length ? r4(quantile(rets, 0.25)) : null,
      p75: rets.length ? r4(quantile(rets, 0.75)) : null,
      worst: rets.length ? r4(Math.min.apply(null, rets)) : null,
      best: rets.length ? r4(Math.max.apply(null, rets)) : null,
      doubleRate: rets.length ? r4(rets.filter(function (x) { return x >= 1; }).length / rets.length) : null,
      halfRate: rets.length ? r4(rets.filter(function (x) { return x <= -0.5; }).length / rets.length) : null,
      avgMae: maes.length ? r4(maes.reduce(function (s, x) { return s + x; }, 0) / maes.length) : null,
      maeN: maes.length,
      // 基准
      benchmark: {
        available: exs.length,
        missing: rows.length - exs.length,
        // 主基准：同期「等权榜单指数」收益的中位值
        marketReturn: idxs.length ? r8(median(idxs)) : null,
        // 参照：同期「中位榜单指数」收益。这个数常年是 0，
        // 它的含义是「中位标的其实没怎么动」，不是「大盘没涨」。
        medianReturn: idxMeds.length ? r8(median(idxMeds)) : null,
        medianExcess: base.medianExcess,
        meanExcess: exs.length ? r4(exs.reduce(function (s, x) { return s + x; }, 0) / exs.length) : null,
        beatRate: base.beatRate,
      },
      byGrade: byGrade,
      byBand: byBand,
      byChain: byChain,
      index: indexInfo(led),
      totals: {
        opened: led.counts.opened || 0,
        settled: led.counts.settled || 0,
        gaveUp: led.counts.gaveUp || 0,
        signals: all.length,
        rounds: led.counts.rounds || 0,
        lastTs: led.lastTs || 0,
        startedAt: led.startedAt || 0,
      },
    };
  }

  function indexInfo(led) {
    if (!led.index.length) {
      return { points: 0, level: 1, marketLevel: 1, fromTs: 0, toTs: 0, medianRoundRet: null, marketRoundRet: null };
    }
    var meds = led.index.map(function (e) { return e.med; });
    var means = led.index.map(function (e) { return e.mean; }).filter(finite);
    return {
      points: led.index.length,
      level: r8(led.indexLevel),           // 中位口径（参照）
      marketLevel: r8(led.marketLevel),    // 等权口径（基准本体）
      fromTs: led.index[0].ts,
      toTs: led.index[led.index.length - 1].ts,
      medianRoundRet: r8(median(meds)),
      marketRoundRet: means.length ? r8(median(means)) : null,
    };
  }

  /** 指数曲线，给前端画线用（按需抽稀到 maxPts 点）。which: 'mean'（默认）| 'med' */
  function indexSeries(led, maxPts, which) {
    led = normalize(led);
    var n = led.index.length;
    if (!n) return [];
    var key = which === 'med' ? 'level' : 'mlevel';
    var cap = maxPts || 120;
    var step = Math.max(1, Math.ceil(n / cap));
    var out = [];
    for (var i = 0; i < n; i += step) out.push([led.index[i].ts, led.index[i][key]]);
    var last = led.index[n - 1];
    if (out.length && out[out.length - 1][0] !== last.ts) out.push([last.ts, last[key]]);
    return out;
  }

  /**
   * 信号明细，最近的在前，供前端列表示例。
   *
   * 默认只出「已结算」的行（state: 'settled'）—— 这是胜率的分母，不能让流失样本混进来。
   * 想看流失 / 待结算的标的时显式传 state: 'all'，那时每行会带 state 字段自行区分。
   *
   * opts: { horizon, why, chain, limit, state: 'settled' | 'all' }
   */
  function samples(led, opts) {
    led = normalize(led);
    opts = opts || {};
    var hk = horizonByKey(opts.horizon) ? opts.horizon : '1h';
    var why = opts.why || 'all';
    var limit = opts.limit || 40;
    var want = opts.state === 'all' ? 'all' : 'settled';
    var out = [];
    Object.keys(led.signals).forEach(function (id) {
      var s = led.signals[id];
      if (why !== 'all' && s.why !== why) return;
      if (opts.chain && s.chainId !== opts.chain) return;
      var rec = s.r[hk];
      if (!rec && want !== 'all') return;
      var idx = rec ? indexReturn(led, s.t0, rec.at, s.chainId, 'mean') : null;
      out.push({
        symbol: s.symbol, chainId: s.chainId, tokenAddress: s.tokenAddress,
        t0: s.t0, why: s.why,
        score: s.score, grade: s.grade, gradeLabel: s.gradeLabel,
        price0: s.price0,
        r: rec ? rec.r : null,
        ex: (rec && idx != null) ? r4(rec.r - idx) : null,
        mae: (rec && finite(rec.mae)) ? rec.mae : null,
        at: rec ? rec.at : null,
        state: rec ? 'settled' : (s.dead.indexOf(hk) >= 0 ? 'lost' : 'waiting'),
      });
    });
    out.sort(function (a, b) { return b.t0 - a.t0; });
    return out.slice(0, limit);
  }

  return {
    VERSION: VERSION,
    HORIZONS: HORIZONS,
    HKEYS: HKEYS,
    WHY_LABEL: WHY_LABEL,
    GRADE_LABEL: GRADE_LABEL,
    GRADE_ORDER: GRADE_ORDER,
    BAND_ORDER: BAND_ORDER,
    MIN_SAMPLE: MIN_SAMPLE,
    GIVEUP_MS: GIVEUP_MS,
    OBS_INTERVAL_MS: OBS_INTERVAL_MS,
    TRIM_P: TRIM_P,
    create: create,
    normalize: normalize,
    reset: reset,
    observe: observe,
    settle: settle,
    summarize: summarize,
    samples: samples,
    indexSeries: indexSeries,
    indexReturn: indexReturn,
    isDone: isDone,
    unresolvedCount: unresolvedCount,
    bandOf: bandOf,
    median: median,
    quantile: quantile,
    trimmedMean: trimmedMean,
  };
});
