# 抓龙雷达 / Dragon Radar

全链新池公开数据扫描器 + 可解释龙分模型 + 跟车监控与持仓账本。零运行时依赖。
An on-chain new-pool scanner with an explainable Dragon Score model, plus position
tracking. Zero runtime dependencies.

在线访问 / Live site: <https://kfat77.github.io/dragon-radar/>

---

## 目录 / Table of Contents

- [中文文档](#中文文档)
  - [一、项目简介](#一项目简介)
  - [二、核心功能](#二核心功能)
  - [三、龙分模型](#三龙分模型)
  - [三之二、四维体检（安全 / 叙事 / 筹码 / 位置）](#三之二四维体检安全--叙事--筹码--位置)
  - [四、环境要求](#四环境要求)
  - [五、安装与启动](#五安装与启动)
  - [六、日常使用说明](#六日常使用说明)
  - [七、目录结构](#七目录结构)
  - [八、仓库文件清单](#八仓库文件清单)
  - [九、接口一览](#九接口一览)
  - [十、测试](#十测试)
  - [十一、部署方式与访问地址](#十一部署方式与访问地址)
  - [十二、常见问题](#十二常见问题)
  - [十三、注意事项](#十三注意事项)
  - [十四、免责声明](#十四免责声明)
- [English Documentation](#english-documentation)
  - [1. Introduction](#1-introduction)
  - [2. Core Features](#2-core-features)
  - [3. The Dragon Score](#3-the-dragon-score)
  - [3b. Four-Dimension Checkup (Safety / Narrative / Chips / Position)](#3b-four-dimension-checkup-safety--narrative--chips--position)
  - [4. Requirements](#4-requirements)
  - [5. Install and Run](#5-install-and-run)
  - [6. Daily Usage](#6-daily-usage)
  - [7. Project Layout](#7-project-layout)
  - [8. Repository File List](#8-repository-file-list)
  - [9. API Reference](#9-api-reference)
  - [10. Tests](#10-tests)
  - [11. Deployment and URLs](#11-deployment-and-urls)
  - [12. FAQ](#12-faq)
  - [13. Caveats](#13-caveats)
  - [14. Disclaimer](#14-disclaimer)
- [License](#license)

---

# 中文文档

## 一、项目简介

抓龙雷达（Dragon Radar）是一套只看公开数据的链上扫描工具。它把 DexScreener
的公开只读接口拉成一个候选池，对池子逐个算分、分级，然后把「量价结构」摊开在页面上，
让使用者能快速把不值得看的标的划掉。在此之上再补一层四维体检：合约能不能碰、故事还传不传
得动、筹码在谁手里、现在该不该进与该进多少，把「不能碰」的理由也摆到台面上。

设计原则只有四条：

1. **不假装有数据。** 拿不到的字段明确标成「数据缺口」，不填 0、不填中性值、
   不用演示数据撑场面。上游限流或接口异常时，页面直说，不缓存凑数。
2. **不替你做决定。** 分数与体检结论是机械加权的结果，不是推荐。页面固定位置放免责声明。
3. **不碰你的资产。** 不连接钱包、不请求签名、不下单、不需要任何密钥。
4. **不一票否决没证据的事。** 硬红线必须落在接口字段上。缺数据时降级并标注，
   而不是把「没查到」当成「有问题」。

项目有两种运行形态，共用同一份打分口径与同一份前端代码：

| 形态 | 入口 | 数据从哪来 | 适合场景 |
| --- | --- | --- | --- |
| 本地服务形态 | `server.js` | 服务端进程定时扫描，页面走 `/api/*` | 自己跑、想长期挂着、要用 fomo 令牌 |
| 纯静态形态 | `docs/` | 浏览器端引擎自己按 60 秒一轮扫描 | GitHub Pages 等静态托管，无后端 |

## 二、核心功能

- **全链候选池构建。** 由四条来源合成一轮候选池：DexScreener 官方推广榜
  （`token-boosts/top` 与 `latest`）、最新代币资料（`token-profiles/latest`）、
  关键词滚动扩样（`latest/dex/search`）、以及你自己的自选清单与上轮强势标的。
  每轮覆盖约 100 至 160 个标的。
- **质量地板。** 池子深度低于 8,000 美元或 24 小时成交额低于 3,000 美元的标的直接
  不进榜（自选清单里的标的豁免）。原因很直白：这种池子没有可读性。
- **龙分（Dragon Score）。** 八个可解释因子加权得出方向分，风险扣分与置信度单独输出，
  最终映射到五档分级，再归入「可看 / 待复核 / 数据不足 / 别碰」四种判定。
- **四种榜单视图。** 全部、爆发榜（量能 × 加速）、潜伏榜（未启动但有资金流入）、
  热度榜（社交完整度 × 成交额）、新池（24 小时内创建）、深度榜。
- **雷达卡片与龙虎榜。** 卡片视图含迷你价差走势图（Canvas 自绘）与可展开的评分明细；
  表格视图可点行展开因子条与风险项。
- **四维体检。** 在任意卡片或龙虎榜展开行点击即可按需触发，补上龙分回答不了的四件事：
  合约能不能碰（安全，一票否决）、故事还传不传得动（叙事，五个传播阶段）、
  筹码在谁手里（集中度 × 退出通道宽窄）、现在该不该进与该进多少（位置，风险预算倒推仓位）。
  结果带综合分与六档结论，并给出分批计划与离场条件。详见第三之二节。
- **自选清单。** 加入自选的标的每轮固定进候选池，不受质量地板限制，存在浏览器本地。
- **手动持仓账本。** 填合约地址、成本价、数量，用实时报价算浮动盈亏（红涨绿跌）。
- **跟车监控。** 复刻 fomo.family 个人主页结构。该站的实时持仓与成交需要登录态令牌，
  未提供令牌时只展示其官方公开名片，不会伪造数据。
- **数据缺口披露。** 新池的 24 小时、6 小时、1 小时窗口尚未成熟时，
  DexScreener 会把几个周期的字段填成同一个值。模型能识别这种退化统计，
  只在真正成熟的窗口上做归一化，不硬凑共振数。
- **首屏自检。** 首轮扫描超过 20 秒仍未取到任何标的时，页面会主动探测一次上游端点，
  把结论直接写在状态行上：连得上就是「还没取到标的，可再等一轮」；连不上就是
  「浏览器没能发出跨域请求，请检查代理或网络」。不必开控制台猜。

## 三、龙分模型

方向分 = Σ（因子得分 × 权重），满分 100；风险扣分上限 60，单独列出；置信度单独列出。

| 因子 | 权重 | 衡量什么 | 满分条件 |
| --- | --- | --- | --- |
| 量能 burst | 0.18 | 当前成交速率 ÷ 基准速率 | 成熟池 15 倍、新池 40 倍封顶 |
| 买盘 pressure | 0.16 | 主动买笔数占比 | 净买盘 ≥ +31% |
| 加速 accel | 0.14 | 短周期相对长周期的超额动能 | 5 分钟涨幅 − 1 小时均速 |
| 共振 resonance | 0.13 | 5m / 1h / 6h / 24h 方向一致性 | 仅在成熟窗口上归一化 |
| 深度 liquidity | 0.12 | 池子深度绝对值 + 深度/市值比 | 深度 60 万美元且占比 ≥ 15% |
| 空间 headroom | 0.11 | 市值还有多少倍空间 | 20 万至 200 万美元区间最优 |
| 新鲜度 freshness | 0.08 | 池龄 | 1 小时至 1 天最新鲜 |
| 社交 social | 0.08 | 社交账号 / 官网 / 推广 / 资料完整度 | 字段齐全 |

分级与判定：

| 龙分 | 分级 | 判定 | 含义 |
| --- | --- | --- | --- |
| ≥ 80 | 真龙 dragon | 可看 | 八个因子同时成立，仍只是「值得自己核一遍」 |
| 70 至 79 | 龙头候选 candidate | 可看 | 结构完整，个别因子偏弱 |
| 60 至 69 | 潜龙 latent | 待复核 | 有资金流入迹象，尚未启动 |
| 45 至 59 | 观察 watch | 数据不足 | 因子样本太少或窗口未成熟 |
| < 45 | 假龙 trash | 别碰 | 追高、抽池、深度过薄或买盘背离 |

两个防噪声设计，读分时需要知道：

- **小样本收缩。** 买盘因子按 `n / (n + 25)` 向中性收缩，避免「2 笔成交 100% 买盘」
  这类噪声直接拿满分。
- **量能限幅。** 倍数带饱和度上限，并按实测成交额封顶（实测成交额 ÷ 100），
  防止几笔小额单刷出天量倍数。

## 三之二、四维体检（安全 / 叙事 / 筹码 / 位置）

龙分只回答「量价结构健不健康」，回答不了另外四件事：合约能不能碰、这个故事还有没有人传、
筹码在谁手里、现在这个位置该不该进、该进多少。这四块由四维体检补上，输出的是可执行的结论，
不是形容词。

在任意卡片或龙虎榜展开行点「四维体检」按需触发。综合分与结论：

```
综合分 = 安全 × 0.40 + 筹码 × 0.30 + 叙事 × 0.30
```

位置维度不参与加权，它是执行环节：先判断能不能碰，再决定下多少注。

### 3b.1 安全：合约能不能碰

安全维度是一票否决。命中硬红线直接放弃，不参与加权，避免「合约随时能跑路但量价很漂亮
所以总分 82」这种荒唐结论。

硬红线（命中任意一条即结论为「直接放弃」）：

| 硬红线 | 说明 |
| --- | --- |
| 蜜罐 | 模拟判定买入后无法卖出 |
| 禁止买入 / 不能全额卖出 | 合约层面限制卖出 |
| 买入税或卖出税超 10% | 超过 10% 已无法正常交易 |
| 代币不可转让 | 买到手也转不出去 |
| 转账税超 10% | 同上 |
| 发行方仍持有冻结权限 | 可冻结任意持币账户 |
| 账户可被关闭 | 持仓可被清零 |
| 合约可自毁且所有权未放弃 | 逻辑随时消失 |
| owner 可改持币余额且所有权未放弃 | 余额可被任意改写 |
| 未开源且是代理合约且所有权未放弃 | 逻辑可随时被替换 |
| 同一创建者已发过蜜罐 | 惯犯 |
| LP 可随时撤走 | LP 只由不超过 3 个地址持有、锁定率低于 30%，且持币地址少于 2000 |
| 仿盘 | 存在同符号且体量在 50 倍以上的标的，而自己不是那个龙头 |

扣分项（不判死，但会压低分数与结论）：未开源 25 分、代理合约 20 分、可增发 25 分、
可暂停转账 20 分、可改税或滑点 20 分、可找回所有权 18 分、隐藏 owner 18 分、
元数据可改 12 分、余额权限 12 分、转账钩子 15 分、交易冷却 8 分、可拉黑 10 分、
反鲸 5 分、买卖税合计超 5% 扣 10 分。LP 锁定率与持币地址数按退出通道宽窄加权。

两条容易踩错的口径，这里明确写出来：

- **「有后门函数」不等于「后门能被调用」。** owner 地址是黑洞地址时所有权已放弃，
  owner 类风险实际不可触发。这类项会降级为说明文字，只记录不扣分，否则会把
  PEPE 这类成熟标的直接判死。
- **LP 锁定率这个字段不可尽信。** 接口对「LP 由合约托管」的情形常记为未锁定。
  所以它只做扣分参考，不单独构成致命判定，报告里也会提示在链上自行复核。

缺数据一律不判绿：拿不到任何合约数据时安全维度得 0 分、结论为「数据不足」，不给中性分。

### 3b.2 叙事：故事还传不传得动

公开接口拿得到「传得动传不动」的代理量，拿不到「故事本身讲了什么」。所以这一维度只给
传播强度，故事内容必须人工判断，报告里会把这一点显式写出来，不用机器猜测冒充结论。

传播阶段判定：

| 阶段 | 触发条件 | 含义 |
| --- | --- | --- |
| 萌芽期 seed | 池龄不足 6 小时、参与广度超 3 倍、市值低于 200 万美元 | 赔率高，失败率也最高 |
| 传播期 spread | 参与广度超 1.5 倍、24 小时涨幅低于 80% | 四档里风险收益比最好的一段 |
| 常态 neutral | 以上都不满足 | 没有明确阶段特征 |
| 高潮期 peak | 24 小时涨幅 80% 以上、参与广度低于 1.2 倍 | 价格已走完大部分，参与度衰减 |
| 退潮期 ebb | 1 小时跌幅超 15%、参与广度低于 0.8 倍 | 价格与参与度同时在退 |

参与广度 = 近 1 小时成交笔数 ÷ 24 小时均速。打分构成：参与广度最高 35 分、瞬时加速度
最高 14 分、传播载体每个 8 分（上限 24 分，载体含官网、X / Twitter、Telegram、Discord、
付费推广位、官方代币资料、持币地址数）、持币地址增量最高 25 分（未取到两次体检快照时
按中性偏低给 8 分，不当作好消息）。量价背离扣 20 分，高潮期扣 10 分，退潮期扣 30 分。

未取到成交流水数据时阶段标记为「未知」，本维度封顶 30 分，不假报「常态」。

### 3b.3 筹码：筹码在谁手里

集中度先做一次重算，这是这一维度最关键的口径：

- **剔除池子地址**：它持有的是 AMM 储备，不是某个人的筹码。
- **剔除池子储备账户**：Solana 上前排名单给的是代币账户地址，池子的储备账户 `owner`
  才是池子本身。两个字段都要比对——只比地址永远匹配不上，会把一个刚开盘的池子里
  76% 的储备当成巨鲸，直接误判致命。
- **剔除黑洞与销毁地址**：永久不可流通。
- **剔除已锁仓地址**：短期砸不出来。

池子地址不只取 DexScreener 给出的那一个最活跃交易对，还会并入 RugCheck 报告里
`markets[].pubkey` 的全部市场地址——一个代币往往有几十上百个市场，前排储备落在哪个市场
是不确定的，只认一个池子会漏。

不剔除这些，前十大占比会系统性虚高，大量正常标的会被直接判死。可用前排名单不足 5 个时
退回接口原始值，并在报告里标注口径；剔除了哪几个地址、各占多少，都会写在报告里供复核。

风险不是单看集中度，而是「集中度 × 退出通道宽窄」：

```
退出通道：持币 < 500 狭窄 / < 5000 一般 / >= 5000 宽
集中度：前十大 >= 60% 高危 / >= 45% 偏高 / >= 30% 中等
集中度与抛压比两项扣分按通道加权：狭窄 1.0 / 一般 0.75 / 宽 0.5
```

之所以要这样算：大市值标的的前排往往是交易所热钱包，它们出货走的是 CEX 订单簿，
不是 DEX 池子，池子深度对它没有约束力。只有「集中度高」且「持有人少、池子是唯一出口」
同时成立，才是真正能被一次性砸穿的结构。PEPE、BONK 这类标的的实测结论就是「老资格但
不值得重仓」，而不是「筹码致命」。

剔除口径本身就是校准的一部分：某 Solana 新池的池子储备账户持有 76.72% 供应量，
按原始前十大算是 89.31%、持币 952 个，会被判成致命；按 `owner` 把储备剔掉后
前十大只剩 14.51%，该标的的正确结论是「小仓试错」。这类误判正是筹码维度要先重算
集中度的原因。

致命项（判为筹码致命，结论直接放弃）：前十大持有 60% 以上且通道不宽；前十大持有 45%
以上且通道狭窄；通道狭窄且前十大抛压是池子深度的 5 倍以上；DEV 自留 10% 以上；
捆绑地址网络关联地址合计持有 15% 以上。

持币地址数未取得时不判致命（硬红线必须建立在证据上，不能建立在「没查到」上），
但本维度不给通过分，分数封顶 55。

### 3b.4 位置：该不该进、该进多少

仓位由风险预算倒推，不由感觉决定：

```
单笔可承受亏损 = 总资金 × 2%
仓位 = min(单笔可承受亏损 / 止损距离, 池子深度 × 0.5%, 总资金 × 5%)
       × 四维质量系数 × 阶段系数
四维质量系数 = (安全 × 0.45 + 筹码 × 0.35 + 叙事 × 0.20) / 100
```

止损距离按阶段变化，阶段越晚止损越紧：

| 阶段 | 止损距离 | 阶段系数 |
| --- | --- | --- |
| 萌芽期 seed | 50% | 0.5 |
| 传播期 spread | 40% | 1.0 |
| 常态 neutral | 45% | 0.7 |
| 高潮期 peak | 30% | 0.25 |
| 退潮期 ebb | 30% | 0 |

总资金在页面工具条里填（默认 10000 美元），只存在本机浏览器，不发送到任何第三方。
市值为 0 或池子深度为 0 时不倒推仓位，直接标注「未取到市值与池子深度」，而不是给一个
看起来合理的数字。

四维存在致命项时给 0，而不是给一个「小仓位」——小仓位解决不了致命结构。有仓位时同时给出
三档分批计划（首仓 50%、回踩加仓 30%、确认加仓 20%）与四条离场条件（止损、池子变化、
筹码变化、叙事变化），先写清楚再进场。

### 3b.5 结论阶梯

| 结论 | 触发条件 |
| --- | --- |
| 数据不足 | 合约安全数据完全取不到 |
| 直接放弃 | 安全命中硬红线；或筹码致命；或安全分低于 50；或进入退潮期 |
| 不追 | 进入高潮期 |
| 小仓试错 | 安全分 65 以上；筹码缺数据时最高只给到这一档 |
| 可参与 | 安全分 75 以上且筹码 65 以上且叙事 60 以上 |
| 观察 | 其余情况 |

### 3b.6 调用策略与数据源

| 数据源 | 用途 | 约束 |
| --- | --- | --- |
| GoPlus | EVM 与 Solana 合约安全标志、持有人分布 | 免费档一次只受理一个地址，不支持 comma 批量 |
| honeypot.is | EVM 真实买卖模拟，比静态标志更接近真机 | 只覆盖部分 EVM 链 |
| RugCheck | Solana 风险报告，含发行方、insider 网络、逐市场 LP 锁定率与池子地址清单 | 全量报告单币可达数 MB |
| DexScreener 同名检索 | 仿盘识别（同符号但小几个数量级的新盘） | 仅按符号检索 |

因为 GoPlus 免费档不能批量，体检不能对全池逐轮调用，只能按需触发并长缓存：普通结果缓存
6 小时，深检结果缓存 24 小时。GoPlus 对 Solana 新币不返回持有人数据，Solana 侧改由
RugCheck 全量报告补齐持币地址数、前 20 持有人与 insider 标记。

三个风控接口都返回 CORS 允许头，纯静态部署（GitHub Pages）可以在浏览器里直接调用，
不需要服务端代理。因此体检在本地服务形态与静态形态下的行为一致。

## 四、环境要求

- **Node.js 18 或以上**（推荐 20 LTS）。低版本没有全局 `fetch`，服务与浏览器端引擎都无法运行。
- 运行期**零第三方依赖**：只用 Node 内置的 `http`、`fs`、`path`、`fetch`。
- 可选：`jsdom`（仅用于跑前端与静态站冒烟测试，属 `devDependencies`）。
- 网络能访问 `https://api.dexscreener.com`。中国大陆网络环境下该项目不走任何 CDN，
  页面样式与脚本全部本地化，不依赖外网静态资源。
- 现代浏览器（Chrome / Edge / Firefox / Safari 近两年版本均可）。

## 五、安装与启动

克隆仓库：

```bash
git clone https://github.com/kfat77/dragon-radar.git
cd dragon-radar
```

无需 `npm install` 就能跑（运行期零依赖）。

### 5.1 本地服务形态

```bash
npm start
# 等价于 node server.js
```

打开 <http://127.0.0.1:8791/> 。服务启动后立即执行一轮扫描，之后按间隔自动重复。

可用环境变量：

```bash
PORT=8792 node server.js            # 换端口，默认 8791
SCAN_INTERVAL_MS=120000 node server.js   # 换扫描间隔，默认 60000（60 秒）
MAX_TOKENS=200 node server.js        # 限制每轮处理的标的数，默认 420
```

### 5.2 纯静态形态（本地预览部署产物）

```bash
npm run build:static     # 把 lib/ src/ public/ 组装成 docs/
npm run serve:static     # 起一个只读静态服务，默认 8080
```

打开 <http://localhost:8080/> 。这个形态没有 `/api/*`，页面由浏览器端引擎自己扫描。

### 5.3 分开跑测试

```bash
npm test                 # 零依赖单测（打分模型 + 四维体检 + 浏览器端引擎），不需要网络
npm run test:checkup     # 只跑四维体检模型单测
npm run test:frontend    # 前端冒烟，需要先在 127.0.0.1:8791 起服务
node test/static.smoke.js  # 静态站冒烟，需要 jsdom
npm run test:live        # 线上产物验证，需要联网与 jsdom，交付前跑
```

`npm run test:live` 会把线上实际发布的那份文件下载下来，用真实网络跑一遍扫描与四维体检。
默认指向 GitHub Pages 地址，可用 `DR_LIVE_BASE` 指定自定义域名。它依赖外网与第三方接口，
不适合放进 CI。

## 六、日常使用说明

1. **看第一屏。** 打开页面先读状态行与倒计时。状态行会明确写出本轮取了多少个交易对、
   通过了多少个标的；倒计时显示下一轮还有多久。
2. **先划掉，再细看。** 用「只看深度 ≥ 30K」把浅池过滤掉，再用判定筛选器直接切到
   「别碰」，把命中追高、抽池、深度过薄的标的先排除掉。
3. **按链看。** 点扫描链 chips 切换 Solana / Base / BNB Chain / Ethereum 等，
   chips 上的数字是该链本轮的标的数。
4. **按榜看。** 爆发榜用于找量能刚起来的；潜伏榜用于找行情还没动但资金已进的；
   新池榜只看 24 小时内创建、池龄最短的。
5. **展开明细。** 卡片里的「展开评分明细」会列出八个因子的得分、权重与文案，
   以及风险项与数据缺口。龙虎榜里点任意一行也会展开同样的明细。
6. **跑一次体检。** 看中的标的点「四维体检」：安全命不命中硬红线，故事在哪个传播阶段，
   筹码集中在谁手里，按你填的总资金应该给多少仓位。体检调外部风控接口，首次约 1 至 3 秒，
   结果缓存 6 小时。
7. **加自选。** 卡片右下角「加入自选」后，该标的每轮固定进候选池，不受质量地板限制。
   自选存在浏览器本地，换浏览器就没了。
8. **记持仓。** 到「追踪 / 抄作业」页填合约地址、成本价、数量，页面用实时报价算浮动盈亏。
   成本价用美元计价，数量留空按 1 计算。
9. **看模型说明。** 「龙分模型」页列出四个读法与完整因子权重表，以及四维体检的口径，
   方便核对页面上的分数与结论是怎么来的。

自动更新默认开启。关闭后页面不再定时重取，需要手动点「刷新这一轮」。

## 七、目录结构

```
dragon-radar/
├── .gitattributes         统一换行符为 LF
├── .gitignore             排除本地依赖、运行数据、日志与环境变量
├── server.js              本地服务形态入口：扫描编排、快照落盘、/api/* 路由、静态托管
├── lib/
│   ├── score.js           龙分模型（同构模块：Node require / 浏览器 window.DragonScore）
│   ├── sources.js         行情数据源封装（同上，window.DragonSources）
│   ├── security.js        合约安全 / 筹码 / 仿盘数据层（window.DragonSecurity）
│   └── checkup.js         四维体检模型，纯函数（window.DragonCheckup）
├── src/
│   ├── engine.js          浏览器端引擎：静态形态下的扫描编排（window.DragonEngine）
│   └── static-api.js      把 /api/* 翻译成引擎调用（window.DragonApi）
├── public/                前端源文件
│   ├── index.html         页面骨架
│   ├── style.css          样式
│   └── app.js             渲染层，两种形态共用
├── docs/                  GitHub Pages 静态站（构建产物，由 tools/build-static.js 生成）
├── tools/
│   ├── build-static.js    组装 docs/
│   └── serve-static.js    本地预览 docs/
├── test/
│   ├── score.test.js      打分模型单测（零依赖）
│   ├── checkup.test.js    四维体检模型单测（零依赖）
│   ├── engine.test.js     浏览器端引擎 + 适配层集成测试（零依赖）
│   ├── frontend.smoke.js  服务形态前端冒烟（需服务在跑 + jsdom）
│   ├── static.smoke.js    静态站冒烟（需 jsdom）
│   └── live.verify.js     线上产物验证（需联网 + jsdom）
├── cname.example          自定义域名配置示例与 DNS 记录说明
├── LICENSE                MIT
└── package.json
```

`docs/` 是构建产物，但必须提交进仓库，因为 GitHub Pages 直接从仓库目录发布。
任何时候都不要手改 `docs/` 里的文件，改源文件后重新执行 `npm run build:static`。

## 八、仓库文件清单

| 文件 | 作用 |
| --- | --- |
| `.gitattributes` | 统一换行符为 LF，避免跨平台反复改行尾 |
| `.gitignore` | 排除 `node_modules/`、`data/`、日志、`cname.txt`、环境变量等本地文件 |
| `LICENSE` | MIT 许可 |
| `README.md` | 本文档，中英双语 |
| `cname.example` | 自定义域名配置示例（子域名 CNAME、裸域名 A/AAAA 记录写法） |
| `package.json` | 零运行时依赖，脚本入口 |
| `server.js` | 本地服务形态入口 |
| `lib/score.js` | 龙分模型与全部分因子函数 |
| `lib/sources.js` | DexScreener / GeckoTerminal / fomo.family 数据源封装 |
| `lib/security.js` | GoPlus / honeypot.is / RugCheck 合约安全与筹码数据层 |
| `lib/checkup.js` | 四维体检模型（安全 / 叙事 / 筹码 / 位置），纯函数，不联网 |
| `src/engine.js` | 浏览器端扫描引擎 |
| `src/static-api.js` | 静态形态的 `/api/*` 适配层 |
| `public/index.html` | 页面骨架（含 `build:scripts` 脚本注入位） |
| `public/style.css` | 样式（浅色主题，无外部字体与 CDN） |
| `public/app.js` | 渲染层，服务形态与静态形态共用 |
| `docs/index.html` | 构建产物：静态入口页 |
| `docs/app.js` | 构建产物：渲染层副本 |
| `docs/style.css` | 构建产物：样式副本 |
| `docs/engine.js` | 构建产物：浏览器端引擎 |
| `docs/api-static.js` | 构建产物：适配层 |
| `docs/lib/score.js` | 构建产物：龙分模型 |
| `docs/lib/sources.js` | 构建产物：数据源封装 |
| `docs/lib/security.js` | 构建产物：合约安全与筹码数据层 |
| `docs/lib/checkup.js` | 构建产物：四维体检模型 |
| `docs/.nojekyll` | 让 GitHub Pages 跳过 Jekyll 处理 |
| `tools/build-static.js` | 静态站构建脚本 |
| `tools/serve-static.js` | 静态站本地预览服务 |
| `test/score.test.js` | 打分模型单测 |
| `test/checkup.test.js` | 四维体检模型单测 |
| `test/engine.test.js` | 引擎与适配层集成测试 |
| `test/frontend.smoke.js` | 服务形态前端冒烟测试 |
| `test/static.smoke.js` | 静态站冒烟测试 |
| `test/live.verify.js` | 线上产物验证（联网） |

## 九、接口一览

服务形态（`server.js`）提供以下只读接口。静态形态由 `src/static-api.js` 实现同一批路径，
因此前端代码无需分支。唯一实质差异是 `/api/fomo/:handle`：静态形态没有服务端代理，
无法携带令牌直连 fomo.family，会如实返回 `needsAuth: true` 与官方公开名片地址。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 运行状态：扫描次数、标的数、数据源统计、错误信息 |
| GET | `/api/meta` | 链清单、默认链、因子权重、分级口径、扫描间隔 |
| GET | `/api/radar` | 榜单。参数 `chain`、`view`、`sort`、`q`、`minLiq`、`limit` |
| GET | `/api/token/:chainId/:address` | 单币详情；榜单里没有则现拉一次行情并单独打分 |
| GET | `/api/checkup/:chainId/:address` | 四维体检。参数 `capital`（用于仓位倒推，默认 10000）、`force=1` 绕过缓存。结果缓存 6 小时（深检 24 小时） |
| GET | `/api/price?address=` | 单币实时报价，缓存 30 秒 |
| GET | `/api/watchlist` | 读取自选清单 |
| POST | `/api/watchlist` | 加入自选，JSON 体 `{ tokenAddress, chainId, symbol }` |
| DELETE | `/api/watchlist?address=&chainId=` | 移出自选 |
| POST | `/api/scan` | 手动触发一轮扫描 |
| GET | `/api/fomo/:handle` | 拉取 fomo.family 用户资料，需令牌；无令牌返回 `needsAuth` |

## 十、测试

```bash
npm test
```

结果（本机实测）：

- `test/score.test.js`：12 项通过。覆盖分级映射连续性、分数恒为 0 至 100 的整数且无 NaN、
  深度与市值比单调性、未成熟窗口不影响风险判定等。
- `test/checkup.test.js`：49 项通过。覆盖四维体检模型：安全硬红线与「所有权已放弃则
  owner 类风险降级」的对照、仿盘与「自己就是龙头」的区分、缺失合约数据按最高风险处理；
  五个传播阶段的判定与持币地址增量的方向性；集中度剔除池子与销毁地址前后的差异、
  Solana 池子储备账户（地址不是池子但 owner 是池子）的剔除、真实巨鲸不得被误剔的
  反向护栏、「人少且池子是唯一出口」判死与「大市值高集中」不判死的对照；仓位取三者
  最小值、止损距离随阶段变化、阶段系数与致命项归零；缺数据时数值字段必须显式置空
  （不能留成 undefined，那会被渲染成「前十大 undefined%」这种像结论的东西）；
  以及任意夹具组合下不产生 NaN 或越界值。
- `test/engine.test.js`：76 项通过。在进程内伪造 `self` / `localStorage` / `fetch`，
  加载真实的 `lib/` 与 `src/`，跑完整链路：建候选池、取行情、打分、落盘、
  第二轮用真实区间增量重算量能、榜单筛选、自选豁免质量地板、适配层全部端点。
  不需要网络。

另外两个冒烟测试（需要 `jsdom`）：

- `npm run test:frontend`：40 项通过。先用 `npm start` 起服务，再用 jsdom 跑真实
  `public/app.js`，断言卡片、龙虎榜、筛选、追踪页、模型页都真的渲染出来了。
  **注意**：端口 8791 的请求不要走系统代理。若本机设有 `http_proxy` / `https_proxy`，
  请先清掉或把 `127.0.0.1` 加进 `no_proxy`，否则 Node 会把回环请求发给代理，
  报 `ECONNREFUSED`（详见 Q13 第 4 条与注意事项）。
- `node test/static.smoke.js`：93 项通过。直接用 `docs/` 里构建出来的那一整套脚本，
  不需要后端、不需要网络，断言「真正会部署上去的那份产物」能自己扫描、自己算分、
  自己渲染，并覆盖链筛选、搜索、行展开、手动刷新、四维体检（含 Solana 池子储备剔除）、
  面板跨轮重绘保持展开，以及风控源未收录该合约时的缺数据渲染（不出现 undefined，
  不把缺数据假报成「常态」）等交互。
- `npm run test:live`：14 项通过（随线上标的略有浮动）。把线上实际发布的那份文件下载到
  临时目录，用真实网络跑一遍：断言线上版本能完成首轮扫描、渲染卡片、并对首个标的跑通
  四维体检、给出结论与仓位、交代集中度重算口径。验的是「用户浏览器实际拿到的东西」，
  依赖外网与第三方接口，只作为交付前的线上核对，不进 CI。

`test/static.smoke.js`、`test/frontend.smoke.js` 与 `test/live.verify.js` 都需要 `jsdom`。安装方式：

```bash
npm i -D jsdom
```

也可以用环境变量 `WB_NODE_MODULES` 指向任意已有的 `node_modules` 目录。

## 十一、部署方式与访问地址

### 11.1 当前线上地址

<https://kfat77.github.io/dragon-radar/>

由 GitHub Pages 从 `main` 分支的 `/docs` 目录发布。

### 11.2 方式 A：GitHub Pages（默认地址，已配置）

仓库已经包含 Pages 所需的一切，不需要额外配置文件：

- `docs/` 目录：整站静态文件，全部使用相对路径引用资源，因此在
  `https://kfat77.github.io/dragon-radar/` 这样的子路径下也能正常加载。
- `docs/.nojekyll`：让 Pages 跳过 Jekyll 处理。
- 不使用任何 CDN 或外部字体，页面全部资源随仓库分发。

开启步骤（新克隆的仓库需要做一次）：

1. 推送代码到 GitHub（见 11.5）。
2. 打开仓库 `Settings` → `Pages`。
3. `Source` 选择 `Deploy from a branch`，`Branch` 选 `main`，目录选 `/docs`，保存。
4. 等一两分钟，访问 `https://<用户名>.github.io/<仓库名>/`。

### 11.3 方式 B：绑定自定义域名

`cname.example` 里写了完整的 DNS 记录写法与两种情形（子域名用 CNAME、裸域名用 A/AAAA）。
`docs/CNAME` 不随仓库分发，由构建脚本按本地开关生成。操作流程：

1. 仓库根目录新建 `cname.txt`，内容只写一行裸域名，例如：

   ```
   radar.example.com
   ```

2. 在域名服务商处按 `cname.example` 的说明配置解析。子域名指向
   `kfat77.github.io`；裸域名配四条 A 记录与四条 AAAA 记录。
3. 重新构建，生成 `docs/CNAME`：

   ```bash
   npm run build:static
   git add docs/CNAME && git commit -m "chore: bind custom domain" && git push
   ```

   也可以不写文件，直接用环境变量：

   ```bash
   DR_CUSTOM_DOMAIN=radar.example.com npm run build:static
   ```

4. 回到仓库 `Settings` → `Pages` → `Custom domain` 填入同一个域名并保存。
5. 等 DNS check 通过后勾选 `Enforce HTTPS`。证书签发通常需要几分钟到一小时。

绑定成功后访问地址变为 `https://radar.example.com/`，
`https://kfat77.github.io/dragon-radar/` 会自动 301 跳转到自定义域名。

需要注意：`cname.txt` 已写进 `.gitignore`，属于本地开关，不会污染仓库。若要撤掉自定义域名，
删除 `docs/CNAME` 并清空 Pages 设置里的 `Custom domain` 即可。

### 11.4 方式 C：自建服务（完整功能）

静态托管跑不了 Node 进程，因此 GitHub Pages 版没有服务端代理，追踪页拿不到 fomo 的
实时持仓。需要完整功能就自己跑服务形态：

```bash
git clone https://github.com/kfat77/dragon-radar.git
cd dragon-radar
PORT=8080 SCAN_INTERVAL_MS=60000 node server.js
```

放在服务器上用 `systemd`、`pm2` 或 `nohup` 常驻即可。
反向代理（Nginx / Caddy）指向该端口，注意 WebSocket 不需要，纯 HTTP 即可。
如果要暴露在公网，建议加一层访问控制：这个页面本身不含鉴权。

### 11.5 推送代码到 GitHub

仓库尚未创建时，先在 GitHub 网页或命令行建一个空的公开仓库，然后：

```bash
cd dragon-radar
git init
git add .
git commit -m "feat: 抓龙雷达首次开源发布

- 龙分模型：8 因子加权 + 风险扣分 + 置信度，五档分级
- 四维体检：安全（一票否决）/ 叙事 / 筹码 / 位置，含仓位倒推
- 两种运行形态共用同一份打分口径与前端代码
- 本地服务形态：Node 编排 + /api/* + 快照落盘
- 纯静态形态：浏览器端引擎，可直接部署到 GitHub Pages
- 测试：打分单测 12 项、体检单测 49 项、引擎集成 76 项、静态站冒烟 93 项"
git branch -M main
git remote add origin https://github.com/kfat77/dragon-radar.git
git push -u origin main
```

用 `gh` 命令行一句话建库并推送：

```bash
gh repo create kfat77/dragon-radar --public --source=. --remote=origin --push
```

开启 Pages：

```bash
gh api -X POST repos/kfat77/dragon-radar/pages \
  -f 'source[branch]=main' -f 'source[path]=/docs'
```

查看 Pages 状态：

```bash
gh api repos/kfat77/dragon-radar/pages
```

首次发布后域名生效大约需要一到两分钟。

## 十二、常见问题

**Q1：页面一直显示「正在扫描候选池…」，或者统计数字全是「—」，卡片是空的。**

首轮扫描要连续拉 13 至 20 次公开接口，通常 3 至 8 秒。超过 30 秒仍无结果，按下面
顺序排查：

1. 打开浏览器控制台（F12）的 Network 面板，筛 `dexscreener`。
   - 请求**根本没发出去**：多半是浏览器代理问题。本机若在用 `127.0.0.1` 这类本地代理，
     代理进程没启动、或浏览器未继承系统代理时，跨域请求会静默失败。见 Q13。
   - 请求发出但**状态 0 / blocked / CORS 报错**：跨域被拦。`api.dexscreener.com`
     返回 `access-control-allow-origin: *`，正常浏览器不会拦，出现这种情况通常是
     代理或扩展改写了响应头。
   - 请求返回 **429**：触发了上游限流，等下一轮即可。
2. 看状态行 `[data-radar-status]` 是否提示「扫描出错」，并看 Console 面板里
   `ERR_PROXY_CONNECTION_FAILED`、`ERR_NAME_NOT_RESOLVED`、`ERR_INTERNET_DISCONNECTED`
   这类网络层错误码。
3. 直接访问 <https://api.dexscreener.com/token-boosts/top/v1> 验证浏览器本身能不能通。
   能打开 JSON 说明网络没问题，问题在前端执行；打不开就是网络或代理。

页面**不会**用缓存或演示数据撑场面：拿不到数据就是拿不到，统计栏显示「—」。
详见 Q13 的排查表。

**Q2：为什么 GitHub Pages 版的「追踪 / 抄作业」页拿不到实时持仓？**

fomo.family 的官方接口需要登录态令牌，且不允许浏览器跨域直连。服务形态由
`server.js` 代持令牌请求，静态形态没有服务端进程，所以页面会如实说明这一点并只展示
官方公开名片。需要实时持仓请用服务形态，并在追踪页填入令牌。

**Q3：令牌存在哪里？会被人拿到吗？**

只存在你自己浏览器的 `localStorage`，键名 `dr.fomoToken`，不会上传到任何地方。
服务形态下它随请求头发给本机 `server.js`，由 `server.js` 转发给 fomo.family。
清空输入框再点「保存令牌」即可删除。

**Q4：为什么有些币涨了很多，龙分却很低？**

龙分衡量的是量价结构是否健康，不是涨幅预测。已经被拉高很多的标的，在「空间」与
「量能饱和度」两个因子上会先扣分；深度过薄、买卖背离、单笔抽池也会触发风险扣分。
分数低不代表它不会继续涨，只代表以这套口径看，追进去的结构不划算。

**Q5：为什么会有标的被判成「别碰」？**

常见触发条件：5 分钟涨幅远超 1 小时均速（追高）、深度与市值比过低（薄池）、
买盘占比为负（有人持续出货）、池龄过短且窗口未成熟（数据不足但风险项先命中）。
被划成「别碰」不是断言它会跌，是提示这个位置的风险收益比不成立。

**Q6：候选池为什么只有一百多个，不是全市场？**

DexScreener 没有提供「全市场新池」的公开列表接口。候选池只能由推广榜、新代币资料、
关键词检索、自选与上轮强势标的合成。想扩大覆盖，可以修改
`lib/sources.js` 里的 `KEYWORDS` 与 `DEFAULT_CHAINS`，或调大
`MAX_TOKENS` 环境变量。

**Q7：怎么自己加一条链？**

在 `lib/sources.js` 的 `CHAIN_LABEL` 里补一行 `链ID: 显示名`，需要默认扫描就再加进
`DEFAULT_CHAINS`。链 ID 必须与 DexScreener 的 `chainId` 一致。

**Q8：能改扫描间隔和端口吗？**

能。`PORT`、`SCAN_INTERVAL_MS`、`MAX_TOKENS` 三个环境变量见第 5.1 节。
纯静态形态的间隔固定在 `src/engine.js` 的 `SCAN_INTERVAL_MS`，
改完需要重新执行 `npm run build:static`。

**Q9：提示 429 或者某条链一直没有数据怎么办？**

DexScreener 的公开接口限流约每分钟 300 次，本项目每轮请求数远低于这个量级。
GeckoTerminal 的免费档限流极紧（约每 15 秒 1 次），因此它在项目里只是机会性来源，
失败就降级，不影响主流程。遇到限流等下一轮即可，页面不会用旧数据假装是新数据。

**Q10：`docs/` 里的文件能直接改吗？**

不要。那是 `tools/build-static.js` 的产物，下次构建会被覆盖。改 `lib/`、`src/`、
`public/` 下的源文件，然后重新构建。

**Q11：数据存在哪？会越存越大吗？**

服务形态存 `data/state.json` 与 `data/radar.json`（已在 `.gitignore` 里，不随仓库分发）。
静态形态存浏览器 `localStorage`，键名 `dr.static.v1`。两边都给价格序列设了 90 个点的
上限，超过 24 小时未再出现的标的会被清理。`localStorage` 配额写满时会自动降级为
只保留自选与快照，并在下一轮继续算区间增量。

**Q12：为什么第一次打开静态站，量能因子显示的是 m5 折算而不是区间增量？**

量能因子优先用相邻两次快照的真实增量。第一次打开时还没有上一轮快照，只能退回按
5 分钟成交额折算。挂着不动，第二轮起就会用真实区间增量。

**Q13：页面一直没数据，怎么判断是网络问题还是前端问题？**

先分清两种现象，两者的成因完全不同：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| 状态行停在「正在读取公开行情接口…」，统计栏全「—」 | 脚本没跑起来，或首轮扫描尚未返回 | 看 Console 是否有报错；首轮正常需 3 至 8 秒 |
| 状态行显示「扫描出错：…」 | 请求发出去了但失败 | 按下方清单逐项排除 |
| 状态行「本轮已完成」但卡片为空 | 扫描成功，没有标的通过质量地板 | 正常现象，放宽筛选或等下一轮 |

按以下顺序定位：

1. **Console 面板找错误码。** `ERR_PROXY_CONNECTION_FAILED` 指向本地代理不可用；
   `ERR_NAME_NOT_RESOLVED` 指向 DNS；`ERR_INTERNET_DISCONNECTED` 指向断网。
2. **Network 面板看请求列表。** 筛选 `api.dexscreener.com`。列表里一条都没有，
   说明请求根本没发出去，属于脚本或代理层面的问题；有请求但标红，看状态码。
3. **验证浏览器直连能力。** 在新标签页打开
   <https://api.dexscreener.com/token-boosts/top/v1>。返回一大段 JSON 说明网络通，
   问题在前端；转圈或报错说明网络或代理不通。
4. **临时关掉代理复测。** 若在用本地代理软件（Clash、V2Ray 等），完全退出该进程
   后再刷新页面。很多本地代理只处理系统代理流量，浏览器扩展或 PAC 规则会把
   非白名单域名静默丢弃，现象正是「请求一条都不发」。
5. **换一个网络复测。** 用手机热点或另一台机器打开同一地址。能出数据说明是
   当前机器的网络环境问题，与代码无关。

如果以上都通过，用本机的命令行对照验证数据源是否可用：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.dexscreener.com/token-boosts/top/v1
# 期望输出 200
```

命令行返回 200 而浏览器不出数据，问题一定在浏览器这一侧（代理、扩展、DNS 或
企业网络策略），与页面代码无关。本项目的数据链路在 Node 侧有完整测试，见第 10 节。

**Q14：四维体检为什么要点一下才出结果？为什么不跟着扫描一起算？**

因为体力不允许。体检要调 GoPlus 的合约安全接口，而它的免费档**一次请求只受理一个地址**，
comma 批量实测无效；Solana 侧还要取 RugCheck 的全量报告，单币响应可达数 MB。
对每轮 100 至 160 个候选池逐个调用，会立刻触发限流，也会把上游打疼。

所以策略是按需触发加长缓存：点开某个标的才跑一次，普通结果缓存 6 小时，深检结果 24 小时。
同一个标的在缓存期内的重复点击不会重新打接口。想看最新数据点「重跑体检」。
接口是 `GET /api/checkup/:chainId/:address`，也可以直接调。

**Q15：体检里的仓位，我照着买就行吗？**

不行。那个数字回答的是「按你填的总资金、按 2% 的单笔风险预算、按这个阶段该用的止损距离，
这个标的最多能承载多少仓位」，它是**风险口径下的上限**，不是建议下单金额，更不代表
本工具认为该买。它同时还会受池子深度和单币上限压制，所以经常比你想的小得多——
市值小、池子浅、阶段晚的标的本来就不该重仓。

真正要不要开仓、开多大，取决于你自己的判断与承受能力。总资金只存在本机浏览器，不上传。

## 十三、注意事项

- 本项目不连接钱包、不请求签名、不需要私钥、不发起任何交易。
- 页面上的分数、分级、判定与四维体检结论都是对公开数据的机械计算，**不是投资建议**。
  「可看」的意思是「值得你自己核一遍」，不是「可以买」。体检给出的仓位是风险预算倒推出来的
  可承受上限，不是建议下单金额。
- 四维体检的安全维度会一票否决，但**否决不了它读不到的东西**：合约之外的骗局、貔貅式
  手动拉黑、社交层面的假冒、以及「技术上完全干净但就是没人接盘」，这些都不在接口字段里。
- 体检按需触发、不做全池逐轮扫描，是上游免费档的限制，不是省事。需要看最新数据时点「重跑体检」。
- 数据缺口一律不判绿：拿不到合约数据时安全维度给 0 分并标记「数据不足」，不会给中性分。
  反过来，第三方接口对 LP 托管、捆绑地址这类字段经常记错，关键标的请在链上自行复核。
- 仓位里的总资金只存在本机浏览器，不上传。不要用「能承受的亏损」以外的钱去做实验。
- 页面会定时请求第三方公开接口。请自觉控制刷新频率与自建服务的并发，不要干扰上游服务。
- 候选人池里的链上标的绝大多数是 meme 币，归零是常态。任何仓位决策请自行判断并承担风险。
- 页面按 A 股习惯着色：涨为红、跌为绿。这不是笔误。
- 请勿把 `data/` 目录或任何令牌提交进仓库。`.gitignore` 已覆盖这两类文件。
- 主分支只跑零依赖测试。`jsdom` 相关的冒烟测试是可选脚本，不要为了它在 CI 里引入重依赖。
- 若本机设有系统级代理（`http_proxy` / `https_proxy`），跑前端冒烟测试或本地调服务时，
  请把 `127.0.0.1`、`localhost` 加入 `no_proxy`。否则回环请求会被送到代理，
  表现为 `ECONNREFUSED` 或代理返回 502，看起来像服务没起来，实际是请求走错了路。

## 十四、免责声明

免责声明：以上内容基于公开数据和量化分析，仅供参考，不构成投资建议。市场有风险，
投资需谨慎。任何投资决策应结合个人风险承受能力、资金状况和投资目标独立判断，
必要时咨询持牌专业机构。过往表现不预示未来收益。

关于数据与金融信息的附加说明：本项目是公开数据的统计工具，不连接钱包、不需要任何密钥、
不代客下单，其输出不构成投资建议。全部行情读自第三方公开接口（主要为 DexScreener），
合约安全、持有人分布与仿盘对照读自另外三家第三方公开接口（GoPlus、honeypot.is、RugCheck），
这些数据均可能延迟、缺失或错误。龙分、分级与四维体检结论只是对这些数据的机械加权计算，
不是推荐，也不是对任何标的的安全性背书。四维体检里的仓位是风险预算倒推出来的可承受上限，
不是建议下单金额。任何依据本项目做出的决策及其风险由使用者自行承担。

---

# English Documentation

## 1. Introduction

Dragon Radar is an on-chain scanning tool built entirely on public data. It assembles a
candidate pool from DexScreener's public read-only endpoints, scores and grades each pool,
and lays the volume and price structure out on one page so you can strike out the
candidates that do not deserve a second look. On top of that it adds a four-dimension checkup:
can the contract be touched, is the story still spreading, who holds the supply, and is this a
sensible place to enter and how much. The reasons to stay away are put on the table too.

Four design rules:

1. **Never fake data.** Fields that cannot be read are reported as explicit data gaps.
   They are not filled with zero, not filled with a neutral value, and never replaced by
   demo data. When an upstream rate-limits or fails, the page says so instead of falling
   back to stale numbers.
2. **Never make the decision for you.** Scores and checkup conclusions are mechanical weighted
   arithmetic, not recommendations. The disclaimer sits in a fixed place on every view.
3. **Never touch your assets.** No wallet connection, no signature request, no order
   placement, no API keys.
4. **Never veto without evidence.** A hard red line must rest on an actual API field. When data
   is missing the model downgrades and labels it rather than treating "we could not read it" as
   "something is wrong".

There are two runtime modes. Both share the same scoring model and the same frontend code.

| Mode | Entry point | Where data comes from | Good for |
| --- | --- | --- | --- |
| Local server | `server.js` | A server process scans on a timer; the page calls `/api/*` | Running it yourself, long-lived deployments, using a fomo token |
| Static only | `docs/` | A browser-side engine scans every 60 seconds | Static hosting such as GitHub Pages, no backend |

## 2. Core Features

- **Universe building.** Each round the candidate pool is composed from four sources:
  DexScreener's boost lists (`token-boosts/top` and `latest`), the latest token profiles
  (`token-profiles/latest`), rotating keyword searches (`latest/dex/search`), plus your
  watchlist and the previous round's strongest tokens. Roughly 100 to 160 tokens per round.
- **Quality floor.** Pools with less than 8,000 USD liquidity or less than 3,000 USD in
  24 hour volume never reach the board (watchlist entries are exempt). Such pools simply
  are not readable.
- **Dragon Score.** Eight explainable factors produce a direction score. A risk penalty
  and a confidence score are reported separately. The result maps to five grades, which
  map to four verdicts: tradable, needs review, insufficient data, avoid.
- **Six board views.** All, burst (volume times acceleration), latent (money moving in
  before price), hot (social completeness times volume), new (pools under 24 hours), and
  deep (by liquidity).
- **Card view and table view.** Cards include a Canvas-drawn sparkline and a collapsible
  factor breakdown. The table lets you click any row to expand the same detail.
- **Four-dimension checkup.** Triggered on demand from any card or leaderboard row, it covers
  the four questions the Dragon Score cannot answer: can the contract be touched (safety, veto
  gated), is the story still spreading (narrative, five propagation stages), who holds the
  supply (concentration times exit-channel width), and whether to enter and how much (position,
  size derived from a risk budget). Each checkup returns a composite score, one of six verdicts,
  a tranche plan and four exit conditions. See section 3b.
- **Watchlist.** Watchlisted tokens stay in the candidate pool every round regardless of
  the quality floor. Stored in browser local storage.
- **Manual position ledger.** Enter contract address, cost basis and size; the page marks
  your PnL to market with live quotes (red for up, green for down).
- **Copy-trade panel.** Mirrors a fomo.family profile layout. Their live positions and
  trades require an authenticated token, so without one the page only shows the official
  public card. Nothing is fabricated.
- **Degenerate-statistics disclosure.** For pools younger than the window, DexScreener
  returns the same value for the 24h, 6h, 1h and 5m fields. The model detects this and only
  normalizes over windows that are genuinely mature.
- **First-paint self check.** If the first scan has not produced a single token after 20
  seconds, the page probes the upstream endpoint once and writes the conclusion straight
  into the status line: reachable means "not here yet, wait one more round"; unreachable
  means "the browser could not send a cross-origin request, check your proxy or network".
  No need to open the console and guess.

## 3. The Dragon Score

Direction score = sum of (factor score times weight), out of 100. The risk penalty is
capped at 60 and reported on its own. Confidence is reported on its own.

| Factor | Weight | What it measures | Full marks when |
| --- | --- | --- | --- |
| volBurst | 0.18 | Current volume rate divided by baseline rate | Capped at 15x for mature pools, 40x for new pools |
| buyPressure | 0.16 | Share of taker buys | Net buying at or above +31% |
| accel | 0.14 | Short-window excess momentum | 5m change minus the 1h average rate |
| resonance | 0.13 | Agreement across 5m / 1h / 6h / 24h | Normalized only over mature windows |
| liquidity | 0.12 | Absolute depth plus depth to market cap ratio | 600K USD depth and at least 15% of market cap |
| headroom | 0.11 | Remaining multiple on market cap | Best between 200K and 2M USD |
| freshness | 0.08 | Pool age | Freshest between 1 hour and 1 day |
| social | 0.08 | Socials, website, boost, profile completeness | All fields present |

Grades and verdicts:

| Score | Grade | Verdict | Meaning |
| --- | --- | --- | --- |
| 80 and above | dragon | tradable | All eight factors line up; still only worth your own verification |
| 70 to 79 | candidate | tradable | Structure intact, one or two factors weak |
| 60 to 69 | latent | needs review | Signs of inflows, price has not moved yet |
| 45 to 59 | watch | insufficient data | Too few samples, or windows not yet mature |
| Below 45 | trash | avoid | Chase risk, depth pulled, depth too thin, or buying divergence |

Two anti-noise mechanisms you should know before reading a score:

- **Small-sample shrinkage.** The buy-pressure factor shrinks toward neutral by
  `n / (n + 25)`, so something like "2 trades, 100% buys" cannot take full marks.
- **Volume rate clamping.** Multiples carry a saturation ceiling and are additionally
  capped by measured volume divided by 100, so a handful of tiny orders cannot print an
  astronomical multiple.

## 3b. Four-Dimension Checkup (Safety / Narrative / Chips / Position)

The Dragon Score only answers "is the price and volume structure healthy". It cannot answer
four other questions: can the contract be touched, is anyone still spreading the story,
who holds the supply, and is this a sensible place to enter and how much. The four-dimension
checkup covers those and returns actionable conclusions rather than adjectives.

Open it from any card or from a Dragon Leaderboard row via the "四维体检" button. It runs
on demand. Composite score and verdict:

```
composite = safety x 0.40 + chips x 0.30 + narrative x 0.30
```

Position does not enter the weighting. It is the execution step: first decide whether the
token can be touched, then decide the stake.

### 3b.1 Safety: can the contract be touched

Safety is veto-gated. Hitting a hard red line means an immediate pass, with no contribution
to the weighted score, so that "the contract can rug at any moment but the tape looks great,
therefore 82 out of 100" is impossible.

Hard red lines (any single one yields the verdict "直接放弃" / pass):

| Red line | Why |
| --- | --- |
| Honeypot | Simulation shows you cannot sell after buying |
| Buying banned / not fully sellable | The contract restricts selling |
| Buy or sell tax above 10% | Above 10% normal trading is impossible |
| Non-transferable token | You cannot move it after buying |
| Transfer tax above 10% | Same as above |
| Issuer still holds freeze authority | Any holder balance can be frozen |
| Account can be closed | Holdings can be zeroed |
| Self-destruct with ownership intact | The logic can disappear |
| Owner can rewrite holder balances with ownership intact | Balances can be arbitrary |
| Not open source, is a proxy, ownership intact | Logic can be swapped at will |
| Same creator previously shipped honeypots | Repeat offender |
| LP can be pulled at any time | LP held by at most 3 addresses, below 30% locked, and fewer than 2000 holders |
| Copycat | A same-symbol token exists that is 50x larger while this is not the leader |

Deductions (not fatal, but they pull the score and verdict down): not open source 25,
proxy contract 20, mintable 25, pausable transfers 20, modifiable tax or slippage 20,
can reclaim ownership 18, hidden owner 18, mutable metadata 12, balance authority 12,
transfer hook 15, trading cooldown 8, blacklistable 10, anti-whale 5, combined tax above 5%
10. LP lock rate and holder count are weighted by how narrow the exit channel is.

Two calibration rules that are easy to get wrong:

- **"A backdoor function exists" is not "the backdoor can be called".** When the owner
  address is a burn address, ownership has been renounced and owner-gated risks cannot be
  triggered. Those items are downgraded to notes and no points are deducted, otherwise mature
  tokens such as PEPE would be killed outright.
- **The LP lock field cannot be fully trusted.** Third-party APIs often report "unlocked" for
  LP held by a contract. It is therefore only a deduction reference, never a fatal finding on
  its own, and the report tells you to verify on chain.

Missing data never scores green: when no contract data can be retrieved, safety scores 0 and
the verdict is "数据不足" (insufficient data) rather than a neutral score.

### 3b.2 Narrative: is the story still spreading

Public APIs can measure whether something is spreading, but not what the story is. This
dimension therefore reports propagation strength only; the story itself must be judged by a
human, and the report says so explicitly instead of passing a machine guess off as a conclusion.

Propagation stages:

| Stage | Trigger | Meaning |
| --- | --- | --- |
| seed | pool younger than 6h, participation breadth above 3x, market cap below $2M | high payoff, highest failure rate |
| spread | participation breadth above 1.5x, 24h gain below 80% | the best risk-reward window of the four |
| neutral | none of the above | no distinct stage signature |
| peak | 24h gain 80% or more, breadth below 1.2x | most of the move is done, participation decaying |
| ebb | 1h drop beyond 15%, breadth below 0.8x | price and participation falling together |

Participation breadth = trades in the last hour divided by the 24h average rate. Scoring:
breadth up to 35, burst up to 14, bearish channels 8 each capped at 24 (website, X/Twitter,
Telegram, Discord, paid promotion, official token profile, holder count), holder growth up to
25 (when only one snapshot exists it contributes 8 as neutral-low, not as good news).
Divergence deducts 20, peak deducts 10, ebb deducts 30.

When no trade-flow data is available the stage is marked unknown and the dimension is capped
at 30, so it cannot falsely report "neutral".

### 3b.3 Chips: who holds the supply

Concentration is recomputed first, which is the single most important detail here:

- **Exclude the pool address**: it holds AMM reserves, not someone's position.
- **Exclude pool reserve accounts**: on Solana the top-holder list gives token account
  addresses, and the reserve account's `owner` is the pool itself. Both fields must be
  compared; matching the address alone never fires and turns a 76% reserve balance in a
  freshly opened pool into a whale, producing a false fatal verdict.
- **Exclude burn and dead addresses**: permanently non-circulating.
- **Exclude locked addresses**: they cannot dump short term.

Pool addresses are not limited to the single most active pair reported by DexScreener: every
market address in `markets[].pubkey` from the RugCheck report is merged in. A token often has
dozens or hundreds of markets and it is not predictable which one holds the top reserve, so
recognising only one pool would miss it.

Without these exclusions top-10 concentration is systematically inflated and many healthy
tokens get killed. When fewer than 5 usable entries remain, the raw API value is used and the
report labels the basis; which addresses were excluded and how much each held is always
written into the report so the conclusion can be audited.

Risk is not concentration alone, but concentration times how narrow the exit is:

```
exit channel: holders < 500 narrow / < 5000 moderate / >= 5000 wide
concentration: top-10 >= 60% severe / >= 45% high / >= 30% moderate
concentration and dump-ratio penalties are weighted by channel: narrow 1.0 / moderate 0.75 / wide 0.5
```

The reason: for large caps the top holders are often exchange hot wallets that exit through
CEX order books rather than the DEX pool, so pool depth does not constrain them. Only when
high concentration and few holders with the pool as the sole exit coincide is the structure
genuinely breakable in one go. Measured on live data, tokens such as PEPE and BONK come out as
"established but not worth a large stake" rather than "fatal chips".

The exclusion rule is itself part of that calibration: the pool reserve account of one freshly
opened Solana pool held 76.72% of supply, which a raw top-10 reading turns into 89.31% with 952
holders and a fatal verdict. Excluding it by `owner` leaves a top-10 of 14.51%, and the correct
verdict for that token is "small probe position". Recomputing concentration before judging is
what prevents exactly this class of error.

Fatal findings (verdict becomes pass): top-10 above 60% with a non-wide channel; top-10 above
45% with a narrow channel; narrow channel with top-10 dump pressure at 5x pool depth or more;
DEV holding 10% or more; bundler network addresses holding 15% or more in aggregate.

When holder count is unavailable the dimension does not declare anything fatal, because hard
red lines must rest on evidence rather than on "we could not find it". It does refuse to pass
the token, capping the score at 55.

### 3b.4 Position: whether to enter and how much

Position sizing is derived from a risk budget, not from feeling:

```
risk per trade = total capital x 2%
size = min(risk per trade / stop distance, pool depth x 0.5%, total capital x 5%)
       x quality factor x stage multiplier
quality factor = (safety x 0.45 + chips x 0.35 + narrative x 0.20) / 100
```

Stop distance tightens as the stage advances:

| Stage | Stop distance | Stage multiplier |
| --- | --- | --- |
| seed | 50% | 0.5 |
| spread | 40% | 1.0 |
| neutral | 45% | 0.7 |
| peak | 30% | 0.25 |
| ebb | 30% | 0 |

Total capital is entered in the toolbar (default 10000 USD), stored only in the local browser
and never sent to any third party. When market cap or pool depth is zero, no size is derived
and the report states "market cap and pool depth unavailable" rather than printing a
plausible-looking number.

A fatal finding yields zero rather than a "small position", because a small position does not
fix a fatal structure. When a size exists, the report also gives a three-tranche plan (initial
50%, add on pullback 30%, add on confirmation 20%) and four exit conditions (stop loss, pool
change, chip change, narrative change), written down before entry.

### 3b.5 Verdict ladder

| Verdict | Trigger |
| --- | --- |
| Insufficient data | No contract safety data at all |
| Pass | Safety hard red line; or fatal chips; or safety below 50; or ebb stage |
| Do not chase | Peak stage |
| Small exploratory position | Safety 65 or above; also the ceiling when chip data is missing |
| Participable | Safety 75+ and chips 65+ and narrative 60+ |
| Watch | Everything else |

### 3b.6 Call strategy and data sources

| Source | Use | Constraint |
| --- | --- | --- |
| GoPlus | EVM and Solana contract safety flags, holder distribution | The free tier accepts one address per request, no comma batching |
| honeypot.is | Real buy and sell simulation on EVM, closer to live behaviour than static flags | Only covers some EVM chains |
| RugCheck | Solana risk report with issuer, insider network, per-market LP lock rate and pool address list | A full report can exceed several MB per token |
| DexScreener symbol search | Copycat detection (same symbol but orders of magnitude smaller) | Symbol search only |

Because the GoPlus free tier cannot batch, checkups are never run across the whole pool every
round. They run on demand and cache for a long time: 6 hours normally, 24 hours for deep
checks. GoPlus returns no holder data for new Solana tokens, so on Solana the RugCheck full
report supplies holder count, top-20 holders and insider flags instead.

All three risk APIs return permissive CORS headers, so the pure static deployment on GitHub
Pages calls them directly from the browser without a server-side proxy. The checkup therefore
behaves identically in local server mode and static mode.

## 4. Requirements

- **Node.js 18 or newer** (20 LTS recommended). Older versions lack a global `fetch`, so
  neither the server nor the browser-side engine can run.
- **Zero third-party runtime dependencies.** Only Node's built-in `http`, `fs`, `path` and
  `fetch` are used.
- Optional: `jsdom`, only for the frontend and static smoke tests, listed under
  `devDependencies`.
- Network access to `https://api.dexscreener.com`. The project loads no CDN assets and no
  external fonts, so it works under restricted network conditions once the API is reachable.
- A modern browser (any Chrome, Edge, Firefox or Safari from the last two years).

## 5. Install and Run

Clone the repository:

```bash
git clone https://github.com/kfat77/dragon-radar.git
cd dragon-radar
```

No `npm install` is needed to run it, because there are no runtime dependencies.

### 5.1 Local server mode

```bash
npm start
# same as: node server.js
```

Open <http://127.0.0.1:8791/>. The server runs one scan immediately on boot and then
repeats on the configured interval.

Environment variables:

```bash
PORT=8792 node server.js                 # port, default 8791
SCAN_INTERVAL_MS=120000 node server.js   # scan interval, default 60000
MAX_TOKENS=200 node server.js            # cap tokens per round, default 420
```

### 5.2 Static mode (preview the deployable artifact locally)

```bash
npm run build:static     # assemble docs/ from lib/, src/ and public/
npm run serve:static     # read-only static server, default port 8080
```

Open <http://localhost:8080/>. There is no `/api/*` in this mode; the browser-side engine
does the scanning itself.

### 5.3 Running tests separately

```bash
npm test                    # zero-dependency unit tests (score model + checkup + browser engine)
npm run test:checkup        # checkup model unit tests only
npm run test:frontend       # frontend smoke test, needs a server on 127.0.0.1:8791
node test/static.smoke.js   # static site smoke test, needs jsdom
npm run test:live           # live artifact verification, needs network and jsdom, run before delivery
```

`npm run test:live` downloads the files actually published on the live site and runs a real
scan plus a real checkup over the network. It points at the GitHub Pages address by default and
accepts `DR_LIVE_BASE` for a custom domain. It depends on the internet and third-party APIs, so
it is not meant for CI.

## 6. Daily Usage

1. **Read the first screen.** The status line states how many pairs were fetched and how
   many tokens passed the floor. The countdown shows when the next round lands.
2. **Strike out first, analyse second.** Use "depth at or above 30K" to drop shallow pools,
   then switch the verdict filter straight to "avoid" to clear out chase risk, pulled depth
   and thin liquidity.
3. **Filter by chain.** The chain chips switch between Solana, Base, BNB Chain, Ethereum and
   others. The number on each chip is that chain's token count for the current round.
4. **Filter by board.** Burst finds volume that just picked up, latent finds money moving in
   before price, new only shows pools created within 24 hours.
5. **Expand the detail.** The collapsible factor breakdown lists each factor's score, weight
   and one-line explanation, plus risk items and data gaps. Clicking a table row opens the
   same detail.
6. **Run a checkup.** For a token you care about, click the checkup button: whether safety hits
   a hard red line, which propagation stage the story is in, who holds the supply, and what
   position size your capital implies. Checkups call third-party risk APIs, take roughly 1 to 3
   seconds the first time, and cache for 6 hours.
7. **Add to watchlist.** Watchlisted tokens enter the pool every round regardless of the
   quality floor. The list lives in browser local storage.
8. **Track positions.** On the tracking view, enter contract address, cost basis and size;
   PnL is marked to market with live quotes. Cost basis is in USD; an empty size means 1.
9. **Read the model page.** It documents the four reading rules, the full factor weight table
   and the checkup methodology, so you can check where a score or a verdict came from.

Auto refresh is on by default. Turn it off and the page stops re-fetching; use the manual
refresh button instead.

## 7. Project Layout

```
dragon-radar/
├── server.js              Server mode entry: scan orchestration, snapshots, /api/* routes, static hosting
├── lib/
│   ├── score.js           Dragon Score model (isomorphic: Node require / browser window.DragonScore)
│   ├── sources.js         Market data source wrappers (same, window.DragonSources)
│   ├── security.js        Contract safety / chips / copycat data layer (window.DragonSecurity)
│   └── checkup.js         Four-dimension checkup model, pure functions (window.DragonCheckup)
├── src/
│   ├── engine.js          Browser-side scanning engine for static mode (window.DragonEngine)
│   └── static-api.js      Translates /api/* into engine calls (window.DragonApi)
├── public/                Frontend sources
│   ├── index.html         Page skeleton
│   ├── style.css          Styles
│   └── app.js             Rendering layer, shared by both modes
├── docs/                  GitHub Pages static site (build output from tools/build-static.js)
├── tools/
│   ├── build-static.js    Assembles docs/
│   └── serve-static.js    Local preview server for docs/
├── test/
│   ├── score.test.js      Scoring model unit tests (zero dependency)
│   ├── checkup.test.js    Checkup model unit tests (zero dependency)
│   ├── engine.test.js     Engine plus adapter integration tests (zero dependency)
│   ├── frontend.smoke.js  Frontend smoke test for server mode (needs a running server and jsdom)
│   ├── static.smoke.js    Static site smoke test (needs jsdom)
│   └── live.verify.js     Live artifact verification (needs network and jsdom)
├── cname.example          Custom domain example with DNS records
├── LICENSE                MIT
└── package.json
```

`docs/` is build output, but it must be committed because GitHub Pages publishes directly
from a repository directory. Never edit files inside `docs/` by hand. Edit the sources and
re-run `npm run build:static`.

## 8. Repository File List

| File | Purpose |
| --- | --- |
| `.gitattributes` | Normalizes line endings to LF across platforms |
| `.gitignore` | Excludes `node_modules/`, `data/`, logs, `cname.txt`, environment files |
| `LICENSE` | MIT license |
| `README.md` | This document, bilingual |
| `cname.example` | Custom domain example, with CNAME and A/AAAA record layouts |
| `package.json` | Zero runtime dependencies, script entry points |
| `server.js` | Server mode entry point |
| `lib/score.js` | Dragon Score model and every factor function |
| `lib/sources.js` | DexScreener, GeckoTerminal and fomo.family data source wrappers |
| `lib/security.js` | GoPlus, honeypot.is and RugCheck contract safety and chips data layer |
| `lib/checkup.js` | Four-dimension checkup model (safety / narrative / chips / position), pure functions, no network |
| `src/engine.js` | Browser-side scanning engine |
| `src/static-api.js` | `/api/*` adapter for static mode |
| `public/index.html` | Page skeleton (contains the `build:scripts` injection point) |
| `public/style.css` | Styles, light theme, no external fonts or CDN |
| `public/app.js` | Rendering layer shared by both modes |
| `docs/index.html` | Build output: static entry page |
| `docs/app.js` | Build output: rendering layer copy |
| `docs/style.css` | Build output: style copy |
| `docs/engine.js` | Build output: browser-side engine |
| `docs/api-static.js` | Build output: adapter |
| `docs/lib/score.js` | Build output: Dragon Score model |
| `docs/lib/sources.js` | Build output: data source wrappers |
| `docs/lib/security.js` | Build output: contract safety and chips data layer |
| `docs/lib/checkup.js` | Build output: checkup model |
| `docs/.nojekyll` | Tells GitHub Pages to skip Jekyll processing |
| `tools/build-static.js` | Static site build script |
| `tools/serve-static.js` | Local preview server for the static site |
| `test/score.test.js` | Scoring model unit tests |
| `test/checkup.test.js` | Checkup model unit tests |
| `test/engine.test.js` | Engine and adapter integration tests |
| `test/frontend.smoke.js` | Frontend smoke test for server mode |
| `test/static.smoke.js` | Static site smoke test |
| `test/live.verify.js` | Live artifact verification (network) |

## 9. API Reference

Server mode (`server.js`) exposes the read-only endpoints below. Static mode implements the
same paths in `src/static-api.js`, so the frontend needs no branching. The one real
difference is `/api/fomo/:handle`: static mode has no server-side proxy and cannot attach a
token to a direct cross-origin call, so it honestly returns `needsAuth: true` together with
the official public card URL.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Runtime status: scan count, token count, source stats, error |
| GET | `/api/meta` | Chain list, default chains, factor weights, grade bands, scan interval |
| GET | `/api/radar` | The board. Query: `chain`, `view`, `sort`, `q`, `minLiq`, `limit` |
| GET | `/api/token/:chainId/:address` | Single token detail; fetches and scores fresh if not on the board |
| GET | `/api/checkup/:chainId/:address` | Four-dimension checkup. Query: `capital` (used to derive position size, default 10000), `force=1` to bypass the cache. Results cache for 6 hours, 24 hours for deep checks |
| GET | `/api/price?address=` | Live quote for one token, cached 30 seconds |
| GET | `/api/watchlist` | Read the watchlist |
| POST | `/api/watchlist` | Add to watchlist, JSON body `{ tokenAddress, chainId, symbol }` |
| DELETE | `/api/watchlist?address=&chainId=` | Remove from watchlist |
| POST | `/api/scan` | Trigger one scan manually |
| GET | `/api/fomo/:handle` | Fetch a fomo.family profile; requires a token, otherwise `needsAuth` |

## 10. Tests

```bash
npm test
```

Results measured on the development machine:

- `test/score.test.js`: 12 assertions pass. Covers grade band continuity, scores always
  being integers from 0 to 100 with no NaN, depth to market cap monotonicity, and immature
  windows not affecting the risk decision.
- `test/checkup.test.js`: 49 assertions pass. Covers the checkup model: safety hard red lines
  and the contrast with "ownership renounced so owner-gated risks are downgraded", copycat
  detection versus "this is the leader itself", and missing contract data being treated as
  maximum risk; all five propagation stages plus the directional regression on holder growth;
  concentration recomputation before and after excluding pool and burn addresses, exclusion of
  Solana pool reserve accounts (address is not the pool but `owner` is), an inverse guard so a
  genuine whale is never mistakenly excluded, and the contrast between "few holders with the
  pool as the only exit" (fatal) and "large cap with high concentration" (not fatal); position
  sizing taking the minimum of three caps, stop distance varying by stage, stage multipliers,
  and fatal findings forcing size to zero; numeric fields being explicitly null rather than
  undefined when data is missing (an undefined would render as "top-10 undefined%", which reads
  like a conclusion); plus no NaN or out-of-range output across arbitrary fixture combinations.
- `test/engine.test.js`: 76 assertions pass. Fakes `self`, `localStorage` and `fetch` in
  process, loads the real `lib/` and `src/`, and runs the whole pipeline: universe building,
  quote fetching, scoring, persistence, a second round recomputing volume from a real
  interval delta, board filtering, watchlist exemption from the quality floor, and every
  adapter endpoint. No network needed.

Two smoke tests and one live check require `jsdom`:

- `npm run test:frontend`: 40 assertions pass. Start the server with `npm start`, then run
  the real `public/app.js` under jsdom and assert that cards, the table, filters, the
  tracking view and the model view actually render.
  **Note**: requests to port 8791 must not go through a system proxy. If `http_proxy` or
  `https_proxy` is set on the machine, clear it or add `127.0.0.1` to `no_proxy`, otherwise
  Node sends the loopback request to the proxy and fails with `ECONNREFUSED` (see Q13 item 4
  and the Caveats section).
- `node test/static.smoke.js`: 93 assertions pass. Runs the exact set of scripts built into
  `docs/`, with no backend, and asserts that the artifact that actually ships can scan, score
  and render by itself. It also covers chain filtering, search, row expansion, manual refresh,
  and the full checkup path against stubbed GoPlus / honeypot.is / RugCheck responses on both
  an EVM and a Solana token, including RugCheck backfilling the holder data GoPlus omits and
  Solana pool reserves being excluded from concentration by their `owner`. It also covers the
  missing-data path when the risk source has no record of the contract: no `undefined` may
  appear in the panel and a missing feed may not be reported as a neutral stage.
- `npm run test:live`: 14 assertions pass (varies slightly with the live universe). Downloads
  the files actually published on the live site, then over the real network asserts that the
  deployed build completes its first scan, renders cards, and runs a full checkup on the first
  token, producing a verdict, a position size and an explicit concentration basis. It verifies
  what the user's browser literally receives; because it depends on the internet and
  third-party APIs it is a pre-delivery check rather than a CI job.

All three need `jsdom`:

```bash
npm i -D jsdom
```

You can also point `WB_NODE_MODULES` at any existing `node_modules` directory.

## 11. Deployment and URLs

### 11.1 Current live URL

<https://kfat77.github.io/dragon-radar/>

Published by GitHub Pages from the `/docs` directory on the `main` branch.

### 11.2 Option A: GitHub Pages with the default URL (already configured)

The repository ships everything Pages needs, with no extra configuration files:

- The `docs/` directory holds the whole static site. Every asset reference is relative, so
  it works correctly under a subpath such as `https://kfat77.github.io/dragon-radar/`.
- `docs/.nojekyll` tells Pages to skip Jekyll processing.
- No CDN and no external fonts; all assets ship with the repository.

Enabling it on a fresh clone:

1. Push the code to GitHub (see 11.5).
2. Open `Settings` then `Pages` in the repository.
3. Set `Source` to `Deploy from a branch`, pick `main` and the `/docs` folder, then save.
4. Wait a minute or two and open `https://<user>.github.io/<repo>/`.

### 11.3 Option B: Binding a custom domain

`cname.example` documents the full DNS record layout for both cases (CNAME for a subdomain,
A/AAAA for an apex domain). `docs/CNAME` is not distributed with the repository; the build
script generates it from a local switch. The workflow:

1. Create `cname.txt` in the repository root containing a single bare domain, for example:

   ```
   radar.example.com
   ```

2. Configure DNS at your provider following `cname.example`. A subdomain points at
   `kfat77.github.io`; an apex domain needs four A records and four AAAA records.
3. Rebuild to generate `docs/CNAME`:

   ```bash
   npm run build:static
   git add docs/CNAME && git commit -m "chore: bind custom domain" && git push
   ```

   Alternatively, skip the file and use the environment variable:

   ```bash
   DR_CUSTOM_DOMAIN=radar.example.com npm run build:static
   ```

4. Back in the repository, open `Settings` then `Pages`, fill in the same domain under
   `Custom domain` and save.
5. Once the DNS check passes, tick `Enforce HTTPS`. Certificate issuance usually takes a few
   minutes to an hour.

After binding, the site is served from `https://radar.example.com/`, and
`https://kfat77.github.io/dragon-radar/` redirects to it with a 301.

Note that `cname.txt` is listed in `.gitignore` because it is a local switch. To remove the
custom domain, delete `docs/CNAME` and clear `Custom domain` in the Pages settings.

### 11.4 Option C: Self-hosting the full feature set

Static hosting cannot run a Node process, so the GitHub Pages build has no server-side proxy
and the tracking view cannot read live fomo positions. For the full feature set, run the
server mode yourself:

```bash
git clone https://github.com/kfat77/dragon-radar.git
cd dragon-radar
PORT=8080 SCAN_INTERVAL_MS=60000 node server.js
```

Keep it alive with `systemd`, `pm2` or `nohup`. Point a reverse proxy (Nginx or Caddy) at the
port. No WebSocket support is needed, plain HTTP is enough. If you expose it to the public
internet, add your own access control: the page itself has no authentication.

### 11.5 Pushing the code to GitHub

If the repository does not exist yet, create an empty public repository on GitHub first, then:

```bash
cd dragon-radar
git init
git add .
git commit -m "feat: initial open-source release of Dragon Radar

- Dragon Score: 8 weighted factors plus a risk penalty and a confidence score, five grades
- Two runtime modes sharing one scoring model and one frontend codebase
- Server mode: Node orchestration, /api/*, snapshot persistence
- Static mode: browser-side engine, deployable straight to GitHub Pages
- Tests: 12 scoring, 76 engine, 37 frontend smoke, 55 static smoke"
git branch -M main
git remote add origin https://github.com/kfat77/dragon-radar.git
git push -u origin main
```

With the `gh` CLI, create the repository and push in one command:

```bash
gh repo create kfat77/dragon-radar --public --source=. --remote=origin --push
```

Enable Pages:

```bash
gh api -X POST repos/kfat77/dragon-radar/pages \
  -f 'source[branch]=main' -f 'source[path]=/docs'
```

Check the Pages status:

```bash
gh api repos/kfat77/dragon-radar/pages
```

The site is usually reachable one to two minutes after the first deployment.

## 12. FAQ

**Q1: The page is stuck on "scanning the candidate pool", or every statistic shows "-" with no cards.**

The first scan makes 13 to 20 consecutive public API calls and normally takes 3 to 8 seconds.
If there is still nothing after 30 seconds, work through this order:

1. Open the browser console (F12), Network tab, filter by `dexscreener`.
   - **No request appears at all**: almost always a browser proxy problem. If the machine runs
     a local proxy such as `127.0.0.1`, a dead proxy process or a browser that does not inherit
     the system proxy makes cross-origin calls fail silently. See Q13.
   - **Requests appear but show status 0 / blocked / CORS errors**: cross-origin blocking.
     `api.dexscreener.com` returns `access-control-allow-origin: *`, so a normal browser will
     not block it; this usually means a proxy or extension rewrote the response headers.
   - **Requests return 429**: upstream rate limiting. Wait for the next round.
2. Check whether the status line `[data-radar-status]` reports a scan error, and look for
   network-level codes such as `ERR_PROXY_CONNECTION_FAILED`, `ERR_NAME_NOT_RESOLVED` or
   `ERR_INTERNET_DISCONNECTED` in the Console panel.
3. Open <https://api.dexscreener.com/token-boosts/top/v1> directly to verify whether the
   browser itself can reach the endpoint. A JSON response means the network is fine and the
   problem is in the front end; a hang or error means it is a network or proxy issue.

The page never falls back to cache or demo data: if the data cannot be read, it is not shown,
and the statistics read "-". See the triage table in Q13.

**Q2: Why can the GitHub Pages build not read live positions on the tracking view?**

The fomo.family API requires an authenticated token and does not allow direct cross-origin
browser calls. In server mode, `server.js` holds the token and makes the request on your
behalf. Static mode has no server process, so the page says so honestly and only shows the
official public card. Use server mode and enter a token to get live positions.

**Q3: Where is the token stored? Can someone else get it?**

Only in your own browser's `localStorage` under the key `dr.fomoToken`. It is never uploaded
anywhere. In server mode it is sent as a request header to your local `server.js`, which
forwards it to fomo.family. Clear the input and save again to delete it.

**Q4: A token pumped hard, why is its Dragon Score low?**

The score measures whether the volume and price structure is healthy, not future returns.
Something already pumped loses points on headroom and volume saturation first; thin depth,
buying divergence and single-order depth pulls add risk penalties. A low score does not mean
it cannot keep rising, only that on this lens the structure is not worth chasing.

**Q5: Why does a token get graded "avoid"?**

Typical triggers: the 5 minute change far exceeds the 1 hour average rate (chase risk), a
depth to market cap ratio that is too low (thin pool), negative net buying (someone is
distributing), or a pool too young for the windows to be mature combined with risk items
already firing. "Avoid" is not a prediction that it will fall; it says the risk-reward at
this point does not work.

**Q6: Why only around a hundred candidates instead of the whole market?**

DexScreener does not publish an endpoint that lists all new pools. The pool can only be
composed from the boost lists, new token profiles, keyword searches, your watchlist and the
previous round's strong tokens. To widen coverage, edit `KEYWORDS` and `DEFAULT_CHAINS` in
`lib/sources.js`, or raise the `MAX_TOKENS` environment variable.

**Q7: How do I add a chain?**

Add one line `chainId: Display Name` to `CHAIN_LABEL` in `lib/sources.js`, and add it to
`DEFAULT_CHAINS` if you want it scanned by default. The chain ID must match DexScreener's
`chainId`.

**Q8: Can I change the scan interval and the port?**

Yes. See section 5.1 for `PORT`, `SCAN_INTERVAL_MS` and `MAX_TOKENS`. In static mode the
interval is fixed at `SCAN_INTERVAL_MS` in `src/engine.js`; rebuild with
`npm run build:static` after changing it.

**Q9: What if I see a 429, or one chain has no data?**

DexScreener's public endpoints allow roughly 300 requests per minute, and this project makes
far fewer than that each round. GeckoTerminal's free tier is extremely tight (about one
request every 15 seconds), which is why it is only an opportunistic source here: it degrades
gracefully on failure and never blocks the main flow. If you do get rate limited, wait for
the next round. The page never dresses stale data up as fresh.

**Q10: Can I edit files inside `docs/` directly?**

No. That directory is the output of `tools/build-static.js` and will be overwritten on the
next build. Edit the sources under `lib/`, `src/` and `public/`, then rebuild.

**Q11: Where is the data kept? Will it grow without bound?**

Server mode keeps `data/state.json` and `data/radar.json`, both listed in `.gitignore` and
therefore not distributed with the repository. Static mode keeps everything in browser
`localStorage` under the key `dr.static.v1`. Both cap the price series at 90 points and purge
tokens that have not reappeared for 24 hours. When the `localStorage` quota is exhausted it
degrades to keeping only the watchlist and snapshots, and keeps computing interval deltas on
the next round.

**Q12: Why does the volume factor show an m5-derived value the first time I open the static site?**

The volume factor prefers the real delta between two adjacent snapshots. On the very first
open there is no previous snapshot, so it falls back to a 5 minute volume extrapolation.
Leave the page open and from the second round onward it uses real interval deltas.

**Q13: The page shows no data at all. How do I tell a network problem from a front-end problem?**

Separate the symptom first; the causes are completely different:

| Symptom | Meaning | Action |
| --- | --- | --- |
| Status stuck on "reading public market endpoints", stats all "-" | Scripts never ran, or the first scan has not returned yet | Check the Console for errors; a normal first scan takes 3 to 8 seconds |
| Status shows "scan error: ..." | Requests were sent and failed | Work through the checklist below |
| Status shows "round complete" but no cards | The scan succeeded and nothing passed the quality floor | Expected; relax the filters or wait for the next round |

Locate the cause in this order:

1. **Look for an error code in the Console panel.** `ERR_PROXY_CONNECTION_FAILED` points at an
   unavailable local proxy; `ERR_NAME_NOT_RESOLVED` points at DNS; `ERR_INTERNET_DISCONNECTED`
   points at a dead connection.
2. **Look at the request list in the Network panel.** Filter by `api.dexscreener.com`. An empty
   list means no request was ever sent, which is a script or proxy level problem; requests that
   are present but marked red should be read by status code.
3. **Verify the browser can reach the endpoint.** Open
   <https://api.dexscreener.com/token-boosts/top/v1> in a new tab. A large JSON body means the
   network is fine and the problem is in the front end; a spinner or an error means the network
   or proxy is at fault.
4. **Temporarily disable the proxy and retest.** If a local proxy client is running (Clash,
   V2Ray and similar), quit the process entirely and reload the page. Many local proxies only
   handle system proxy traffic, while a browser extension or PAC rule silently drops
   non-allowlisted domains, which produces exactly the "not a single request" symptom.
5. **Test on another network.** Open the same URL on a phone hotspot or another machine. If it
   produces data, the problem is this machine's network environment, not the code.

If all of the above pass, verify the data source from the command line on the same machine:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.dexscreener.com/token-boosts/top/v1
# expected output: 200
```

A 200 from the command line while the browser shows nothing means the problem is on the browser
side (proxy, extension, DNS or a corporate network policy) and unrelated to the page code. The
data pipeline is covered by the Node-side tests listed in section 10.

**Q14: Why does the checkup need a click instead of running with every scan?**

Because the upstream APIs will not allow it. The GoPlus free tier accepts **only one address per
request**; comma-joined batching was measured and does not work. On Solana the checkup also needs
the RugCheck full report, which can exceed several MB per token. Calling both for each of the 100
to 160 candidates every round would hit rate limits immediately and burden the upstream services.

The strategy is therefore on-demand plus long caching: a checkup runs when you open a token, with
normal results cached for 6 hours and deep checks for 24. Repeat clicks within the cache window do
not re-hit the APIs. Click "re-run checkup" for fresh data. The endpoint is
`GET /api/checkup/:chainId/:address` and can be called directly.

**Q15: Can I just buy the position size the checkup prints?**

No. That number answers a narrower question: given the total capital you entered, a 2% risk budget
per trade and the stop distance appropriate to this stage, how much can this token carry. It is an
**upper bound under a risk framework**, not a suggested order size, and it does not mean the tool
thinks you should buy. It is also suppressed by pool depth and the per-token cap, so it is often
much smaller than people expect: small caps, shallow pools and late stages genuinely do not deserve
a large position.

Whether to open a position at all, and how large, is your call and your risk. Total capital is
stored only in your local browser and is never uploaded.

## 13. Caveats

- This project does not connect to a wallet, does not request signatures, does not need
  private keys and does not place any orders.
- Every score, grade, verdict and checkup conclusion is mechanical arithmetic over public data and
  is **not investment advice**. "Tradable" means "worth verifying yourself", not "safe to buy".
  The checkup's position size is a risk-derived upper bound, not a suggested order size.
- The safety dimension vetoes hard, but it **cannot veto what it cannot read**: fraud outside the
  contract, manually blacklisting a seller, impersonation at the social layer, and "technically
  clean but nobody is buying". None of those are fields in any API.
- Checkups are on demand rather than run over the whole pool every round because of upstream free
  tier limits, not for convenience. Click "re-run checkup" when you need fresh numbers.
- Missing data never scores green: with no contract data the safety dimension scores 0 and the
  verdict becomes "insufficient data", never a neutral score. Conversely, third-party APIs often
  misreport LP custody and bundler addresses, so verify anything important on chain yourself.
- The total capital used for position sizing stays in your local browser and is never uploaded.
  Only risk money you can afford to lose.
- The page polls third-party public endpoints on a timer. Keep your refresh rate and any
  self-hosted concurrency reasonable and do not burden the upstream services.
- The overwhelming majority of tokens in the candidate pool are meme coins, and going to zero
  is the norm. Any position sizing decision is yours, and so is the risk.
- Colors follow the Chinese market convention: up is red, down is green. This is not a bug.
- Never commit the `data/` directory or any token into the repository. `.gitignore` already
  covers both.
- CI on the main branch runs only the zero-dependency tests. The `jsdom` smoke tests are
  optional scripts; do not pull heavy dependencies into CI for their sake.
- If the machine has a system-wide proxy (`http_proxy` / `https_proxy`), add `127.0.0.1` and
  `localhost` to `no_proxy` before running the front-end smoke test or hitting the local
  server. Otherwise loopback requests are handed to the proxy and surface as `ECONNREFUSED`
  or a 502 from the proxy, which looks like the server failed to start when in fact the
  request simply took the wrong route.

## 14. Disclaimer

This project is based on public data and quantitative analysis. It is provided for reference
only and does not constitute investment advice. Markets carry risk; invest with caution. Any
investment decision should be made independently in light of your own risk tolerance,
financial situation and objectives, and you should consult a licensed professional where
appropriate. Past performance does not indicate future results.

Additional notice on data and financial information: this project is a public-data
statistics tool. It does not connect to any wallet, does not require API keys and does not
place orders. Nothing it outputs is investment advice. All market data is read from
third-party public interfaces, primarily DexScreener; contract safety, holder distribution and
copycat comparison are read from three further third-party public interfaces (GoPlus,
honeypot.is, RugCheck). All of that data may be delayed, incomplete or wrong. Scores, grades
and checkup conclusions are mechanical arithmetic over that data, not recommendations, and not
an endorsement of any token's safety. The position size in a checkup is a risk-derived upper
bound, not a suggested order size. Any decision you make on the basis of this software is your
own, and you bear its risk.

---

## License

MIT. See [LICENSE](./LICENSE).
