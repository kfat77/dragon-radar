# 抓龙雷达 / Dragon Radar

全链新池公开数据扫描器 + 可解释龙分模型 + 四维体检 + 抓龙胜率前瞻账本。零运行时依赖。
An on-chain new-pool scanner with an explainable Dragon Score model, a four-dimension checkup,
and a forward signal ledger that measures its own hit rate. Zero runtime dependencies.

在线访问 / Live site: <https://kfat77.github.io/dragon-radar/>

---

## 目录 / Table of Contents

- [中文文档](#中文文档)
  - [一、项目简介](#一项目简介)
  - [二、核心功能](#二核心功能)
  - [三、龙分模型](#三龙分模型)
  - [三之二、四维体检（安全 / 叙事 / 筹码 / 位置）](#三之二四维体检安全--叙事--筹码--位置)
  - [三之三、抓龙胜率（信号账本与前瞻回测）](#三之三抓龙胜率信号账本与前瞻回测)
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
  - [3c. Hit Rate (Signal Ledger and Forward Test)](#3c-hit-rate-signal-ledger-and-forward-test)
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
- **抓龙胜率（信号账本）。** 不做历史回放（八个因子里有四个在公开历史数据里根本不存在），
  改成前瞻记录加事后结算：标的首次上榜时记下当时的状态与价格，等 15 分钟 / 1 小时 / 6 小时 /
  24 小时候用真实价格结算。胜率、同期榜单指数基准、样本流失率三件事必须一起读。
  详见第三之三节。
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

## 三之三、抓龙胜率（信号账本与前瞻回测）

页面上的「抓龙胜率」回答一个问题：雷达给出的信号，事后到底赚不赚钱。

### 3c.1 为什么不做历史回放

先说清楚这一条，因为它决定了整个模块的形态。

龙分的八个因子里，只有量能爆发、价格加速度、池龄、市值这几项能从公开历史数据重建；
**买卖笔数分布、池子深度、持币地址数、社交与付费推广状态，在任何公开历史接口里都不存在。**
拿今天的值去回放昨天的价格，等于把「后来涨了才会变大的成交量」当成入场时的依据 ——
那不是回测，是把答案抄进题目。所以本项目不做历史回放，也不提供任何形式的
「过去一年信号收益」曲线。

替代方案是**前瞻记录 + 事后结算**：

1. 每个标的第一次出现在榜单上时，把那一刻的真实状态（龙分、八个因子分、市值、池子深度、
   池龄、置信度、风险扣分）连同当时的真实价格原样记下来，叫「首现信号」。
2. 当标的首次达到「龙头候选」及以上时，再记一条「档位升级信号」。两种信号分开统计，
   才能看出「雷达发现得早」和「雷达确认得准」哪一头更值钱。
3. 等 15 分钟 / 1 小时 / 6 小时 / 24 小时四个视界到点后，用那一刻的真实价格结算。
   **信号是先记的，价格是后取的**，没有前视偏差。

### 3c.2 三个必须同时给出的数

单独一个胜率数字是可以被做得很漂亮的，所以本模块把三件事绑在一起输出，页面上不给单独取用的机会。

| 指标 | 它回答什么 | 缺了它会怎样 |
| --- | --- | --- |
| 胜率 | 已结算样本里正收益的占比 | 那段时间全市场普涨时，闭着眼睛买也是高胜率 |
| 榜单指数基准 | 同一时段、同一榜单里所有连续在榜标的的等权收益（每轮再平衡）连乘成参考线 | 无法区分「雷达选得准」和「那阵子全市场在涨」 |
| 样本流失率 | 到点却补不到价格的信号数 | 掉出榜单的标的很可能就是归零那批，悄悄抹掉会让胜率系统性虚高 |

**超额收益 = 信号收益 − 同期榜单指数收益。** 这才回答「雷达选的比雷达池子的平均强吗」。

### 3c.3 五条不退让的口径

- **价格必须为正才结算。** `priceUsd <= 0` 一律拒绝结算，开仓时也不开。链上行情里的 0 与负数
  代表池子没了或取数出错，把它当成 0% 收益，等于把最危险的那一类结局记成「不亏不赚」。
- **缺基准必须显式缺。** 区间内没有指数采样点时，超额写成「无采样点」，绝不填 0。
  填 0 会被读成「与市场持平」，那是一个看起来像结论的假数字。
- **样本不足不给结论。** 已结算样本少于 30 笔时，页面只显示计数与「样本积累中」，
  不渲染胜率、中位收益与超额。
- **流失单独统计。** 到期后 48 小时仍补不到价格记流失，单独计数、单独显示，不并入胜率分母，
  也不当成中性收益。
- **观测序列按「窗口编号」累积，不按「距上一个点的间隔」。** 开仓后每 5 分钟留一个观测价，
  同一个 5 分钟窗口内只保留最新价。这一条看起来是实现细节，实际上是两条功能的命门：
  最大不利偏移与「掉榜后用本地观测补价」都依赖这条序列。如果按间隔判重，连扫时每一轮都落在
  5 分钟以内，每个点都会被就地覆盖，序列永远只有 1 个点，而表面上完全看不出来。

此外还会记录**最大不利偏移**（从开仓到结算之间出现过的最差浮亏）并给出分位分布。
只有收益数字没有回撤数字，胜率会显得比实际舒服得多 —— 赚 50% 的前提是先扛住 −60%。

### 3c.4 榜单指数怎么算

每一轮取「上一轮与这一轮都在榜」的标的，算各自的轮间收益，做 10% 截尾（首尾各去掉 10%，
标的少于 20 个时不截尾），取**等权平均**，再连乘成净值曲线。单轮涨跌超过 10 倍的点会被剔除
（数据源把价格单位换了会一次把整条线拉飞）。指数存 8 位小数：实测轮间波动常在 0.001% 量级，
按 4 位小数存会被整片抹成 0，指数线永远停在 1.0，基准就白算了。

**基准为什么是等权平均而不是中位数。** 第一版取的是每轮中位收益，跑起来发现净值永远贴在
1.0000。原因是这类新池子里有大量「一分钟内价格完全没动」的标的，只要过半标的没动，
当轮中位数就**精确等于 0**，连乘下来整条线是死的。基准恒为 0 之后，「跑赢基准」就退化成
「收益为正」，和胜率成了同一个数 —— 基准设了等于没设。改成等权平均后两个数才真正分开。
中位口径仍然记录，只作参照，它的含义是「中位标的其实没怎么动」，不是「大盘没涨」。

截尾的代价要说清楚：它丢掉尾部，如果行情确实只由少数标的拉起，基准会偏低、超额会偏高。
所以汇总里同时给出未截尾的均值供对照。反过来，不截尾的话一个「价格单位换了、又恰好没被
10 倍阈值拦住」的脏点就能把整条基准线抬起来。

已知口径限制，不藏：新进榜的标的当轮没有上一轮价格，不计入；掉出榜单的标的在最后一轮之后
不再计入。所以它偏向「活得久」的那批，与信号账本面对的是同一类幸存者问题 ——
但两者同向受影响，做比较仍然成立。

另有一条容易忽略的性质：**「每轮收益的连乘」不等于「每个标的在整个窗口上的收益」**。
前者是在「典型的一分钟」上反复取值，后者才是「典型的一个标的」。实测榜单每轮的收益中位数
经常正好是 0（大多数 meme 币一分钟内价格没动，过半数为 0 时中位数就是 0），
所以中位口径的指数在平静行情里就是一条水平线 —— 这正是它不能当基准的原因。
等权口径衡量的是「每分钟里池子整体的典型涨跌」，不是「典型标的的累计涨跌幅」。

### 3c.5 怎么用

账本是一门需要时间积累的账。数字是一点点攒出来的，**刚部署时它是空的，这是设计而不是故障**。

```bash
npm start                                # 服务跑起来后，每轮扫描自动记账
node tools/ledger-report.js              # 另开一个终端，随时看进度（离线读 data/ledger.json）
node tools/ledger-report.js --horizon=1h # 只看 1 小时视界
node tools/ledger-report.js --why=upgrade --chain=solana
```

页面侧：导航「抓龙胜率」，可切换视界（15 分钟 / 1 小时 / 6 小时 / 24 小时）与信号类型
（全部 / 首现 / 档位升级）。两者用的是同一个 `lib/ledger.js`，结论一致。

参考时间线：15 分钟视界在半小时内就能攒到足够样本；1 小时视界约 1 小时；
6 小时与 24 小时视界要按各自周期等待。24 小时视界要整整一天。

**纯静态部署的固有限制：** 静态形态只在页面打开时采集，关掉的时段没有观测点。
到期补不到价格的信号会计入流失，而不是被当成中性。要连续采集请用 Node 形态常驻运行。

### 3c.6 已知偏差

- 候选池由推广榜 / 最新代币资料 / 关键词扩样 / 自选合成，**不是全市场**。
  这份统计只说明「在这个池子里信号值不值」，不能外推到整个市场。
- 榜单指数偏向活得久的标的（见 3c.4）。
- 结算用的是 DexScreener 的公开报价，不是可成交价。真实成交还要扣滑点与手续费，
  所以这里报的是**信号的方向性收益**，不是可实现收益。
- 15 分钟视界的噪声最大；样本量相同时，越长的视界越可靠，但积样本也越慢。

### 3c.7 首次线上读数（实测，含不好看的数）

下面这一段是**真实跑出来的**，不是示意。口径修正提交后，服务在 2026-09-25 21:42 到 21:57
连续跑了 15 轮，攒到 116 个信号、68 笔 15 分钟视界结算样本。原始输出：

```text
抓龙胜率报告（前瞻记录 + 事后结算，不做历史回放）
开始记录：2026/9/25 21:42:22    最后推进：2026/9/25 21:57:36
扫描轮次：15    存续信号：116    累计开仓：116    完成结算：68    记流失：0
榜单指数：14 个采样点，等权净值 0.9943（中位口径参照 1.0000）

视界             已结算     待结算    流失       胜率       中位收益       基准收益       中位超额      跑赢基准
15 分钟           68      48     0    23.5%      -0.6%      +1.9%      -3.2%     42.6%
1 小时             0     116     0      积累中          —          —          —         —
6 小时             0     116     0      积累中          —          —          —         —
24 小时            0     116     0      积累中          —          —          —         —

按档位分层（15 分钟 · 全部信号）
  真龙               4   100.0%     +22.1%     +21.0%
  龙头候选             8    25.0%      -2.7%      -3.8%
  潜龙               6    33.3%      -0.9%      -5.2%
  观察              25    20.0%      -0.8%      -3.2%
  假龙              25    12.0%      -0.4%      -4.2%

平均最大浮亏 -4.3%（67 笔有观测序列）。
```

四条值得单独拎出来的观察：

1. **「胜率」和「跑赢基准」终于不是同一个数了**：23.5% 对 42.6%。口径修正前它们由构造决定
   必然相等，现在分开了 —— 这是本次修正最直接的验收点。
2. **基准不再贴 0**：同期等权榜单指数 +1.9%，而中位口径的净值是 1.0000。两个口径已经分开。
3. **这一段样本里，雷达没有跑赢自己的池子。** 中位超额 −3.2%，跑赢基准的比例 42.6%，
   低于一半。也就是说：15 分钟视界下，信号的中位表现比池子里的等权平均还差 3.2 个百分点。
   这个数不好看，但它是这个模块存在的理由 —— 如果只报「胜率 23.5%」，你不会知道
   同期闭着眼睛买池子里的平均标的反而更好。
4. **档位分层方向是对的**：真龙 4 笔全胜、中位 +22.1%、超额 +21.0%；
   往下逐档走低（潜龙 n=6 略高于龙头候选，样本太小不作数）。
   但真龙只有 4 笔 —— **4 笔不能证明任何事**，这里只是把它如实列出来，等样本攒够再谈。

必须说清的边界：这只是**单个 15 分钟窗口里的一轮采集**，68 笔，未跨行情、未跨日，
1 小时 / 6 小时 / 24 小时三个视界全部还在积累中。它说明的是「这套账本确实会记账、
会结算、会自己算出不好看的数」，**不是**对龙分长期有效性的判断。
真实成交还要扣滑点与手续费，这里的收益是方向性收益。

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
npm test                 # 零依赖单测（打分模型 + 四维体检 + 信号账本 + 浏览器端引擎），不需要网络
npm run test:checkup     # 只跑四维体检模型单测
npm run test:ledger      # 只跑信号账本与回测模型单测
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
10. **看抓龙胜率。** 「抓龙胜率」页读的是信号账本：标的首次上榜时记下当时的状态与价格，
    之后按 15 分钟 / 1 小时 / 6 小时 / 24 小时四个视界到点结算。可切视界与信号类型
    （全部 / 首现 / 档位升级）。**刚部署时这一页是空的，这是设计而不是故障** ——
    数字要一点点攒。不想开页面时，用一个离线命令看进度：

    ```bash
    node tools/ledger-report.js               # 读取 data/ledger.json 并打印全部视界
    node tools/ledger-report.js --horizon=1h  # 只看某个视界
    node tools/ledger-report.js --why=upgrade --chain=solana
    ```

    读这一页时必须三件事一起看：胜率、同期榜单指数基准、样本流失率。理由见第三之三节。
    另外，本页的胜率是**信号的方向性收益**，不含滑点与手续费，不是可实现收益。

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
│   ├── checkup.js         四维体检模型，纯函数（window.DragonCheckup）
│   └── ledger.js          信号账本与前瞻回测，纯函数（window.DragonLedger）
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
│   ├── serve-static.js    本地预览 docs/
│   └── ledger-report.js   离线读账本，打印抓龙胜率报告
├── test/
│   ├── score.test.js      打分模型单测（零依赖）
│   ├── checkup.test.js    四维体检模型单测（零依赖）
│   ├── ledger.test.js     信号账本与回测模型单测（零依赖）
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
| `lib/ledger.js` | 信号账本与前瞻回测模型（开仓快照 / 到点结算 / 榜单指数 / 统计），纯函数，不联网 |
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
| `docs/lib/ledger.js` | 构建产物：信号账本与回测模型 |
| `docs/.nojekyll` | 让 GitHub Pages 跳过 Jekyll 处理 |
| `tools/build-static.js` | 静态站构建脚本 |
| `tools/serve-static.js` | 静态站本地预览服务 |
| `tools/ledger-report.js` | 离线读 `data/ledger.json` 并打印抓龙胜率报告（只读） |
| `test/score.test.js` | 打分模型单测 |
| `test/checkup.test.js` | 四维体检模型单测 |
| `test/ledger.test.js` | 信号账本与回测模型单测 |
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
| GET | `/api/health` | 运行状态：扫描次数、标的数、数据源统计、账本计数、错误信息 |
| GET | `/api/meta` | 链清单、默认链、因子权重、分级口径、扫描间隔 |
| GET | `/api/radar` | 榜单。参数 `chain`、`view`、`sort`、`q`、`minLiq`、`limit` |
| GET | `/api/token/:chainId/:address` | 单币详情；榜单里没有则现拉一次行情并单独打分 |
| GET | `/api/checkup/:chainId/:address` | 四维体检。参数 `capital`（用于仓位倒推，默认 10000）、`force=1` 绕过缓存。结果缓存 6 小时（深检 24 小时） |
| GET | `/api/price?address=` | 单币实时报价，缓存 30 秒 |
| GET | `/api/backtest` | 抓龙胜率。参数 `horizon`（`15m` / `1h` / `6h` / `24h`，默认 `1h`）、`why`（`all` / `first` / `upgrade`）、`chain`、`limit`。返回汇总、样本明细、指数曲线与口径常量。基准在 `summary.benchmark`：`marketReturn` 是等权榜单指数（基准本体），`medianReturn` 是中位口径参照 |
| POST | `/api/backtest/reset` | 清空信号账本重新积累（不影响榜单与自选） |
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
- `test/ledger.test.js`：34 项通过。覆盖信号账本与前瞻回测：首现信号去重、档位升级信号只在
  龙头候选及以上开仓、价格 ≤ 0 拒绝开仓也拒绝结算、四个视界各自独立结算、掉榜后用本地观测
  序列回补、超过 48 小时记流失且不混进胜率分母、榜单指数只在单轮样本足够时记点并剔除
  单轮 10 倍以上的脏点、指数必须保留亚 0.01% 的轮间收益（否则整条线永远停在 1.0）、
  等权口径与中位口径必须同时记录、等权基准不得与胜率同义（中位为 0 而等权为正时
  「跑赢基准」必须真的低于胜率）、标的够多时单轮 10% 截尾必须挡得住脏点、
  观测序列必须按 5 分钟窗口累积（按间隔判重会让序列永远只有 1 个点，最大浮亏与掉榜回补
  一起失效）、旧版本账本必须重置（不能一条指数上混两种口径）、
  区间内无采样点时指数收益必须为 null、样本不足 30 笔时拒绝给结论、
  超额收益必须等于信号收益减同期指数收益、以及任意夹具组合下统计结果不出现 NaN 或 undefined。
- `test/engine.test.js`：111 项通过。在进程内伪造 `self` / `localStorage` / `fetch`，
  加载真实的 `lib/` 与 `src/`，跑完整链路：建候选池、取行情、打分、落盘、
  第二轮用真实区间增量重算量能、榜单筛选、自选豁免质量地板、适配层全部端点，
  以及账本在浏览器端的前瞻记账（开仓价必须是首次上榜那一刻的真实价格，不能是后来的价格）、
  账本独立落盘、`/api/backtest` 的视界与信号类型参数、非法视界回落、清空账本。
  不需要网络。

另外两个冒烟测试（需要 `jsdom`）：

- `npm run test:frontend`：56 项通过。先用 `npm start` 起服务，再用 jsdom 跑真实
  `public/app.js`，断言卡片、龙虎榜、筛选、追踪页、模型页、抓龙胜率页都真的渲染出来了，
  并核对服务端在空账本时返回的胜率与超额都为 `null` 而不是 0。
  **注意**：端口 8791 的请求不要走系统代理。若本机设有 `http_proxy` / `https_proxy`，
  请先清掉或把 `127.0.0.1` 加进 `no_proxy`，否则 Node 会把回环请求发给代理，
  报 `ECONNREFUSED`（详见 Q13 第 4 条与注意事项）。
- `node test/static.smoke.js`：117 项通过。直接用 `docs/` 里构建出来的那一整套脚本，
  不需要后端、不需要网络，断言「真正会部署上去的那份产物」能自己扫描、自己算分、
  自己渲染，并覆盖链筛选、搜索、行展开、手动刷新、四维体检（含 Solana 池子储备剔除）、
  面板跨轮重绘保持展开、风控源未收录该合约时的缺数据渲染（不出现 undefined，
  不把缺数据假报成「常态」），以及抓龙胜率页的渲染纪律（样本不足时只报计数不给胜率、
  切视界与切信号类型都不崩、账本确实落在独立的 localStorage 键上）。
- `npm run test:live`：本次实测 15 项通过（随线上标的略有浮动）。把线上实际发布的那份文件下载到
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

**Q16：打开「抓龙胜率」页，为什么什么都没有？**

因为账本是**前瞻记录**出来的，不是算出来的。标的第一次上榜时，模型把那一刻的状态与价格
记下来；等 15 分钟 / 1 小时 / 6 小时 / 24 小时候，再用那一刻的真实价格结算。
所以刚部署时账本是空的，这是设计而不是故障。

要看数字需要两件事：服务在跑，以及时间。15 分钟视界在半小时内就能攒到足够样本；
1 小时视界约 1 小时；6 小时与 24 小时要按各自周期等待。样本不足 30 笔时页面只显示
计数与「样本积累中」，不渲染胜率。

不想开页面也可以随时看进度：

```bash
node tools/ledger-report.js --horizon=15m
```

另外必须说清楚：**本页不做历史回放。** 八个因子里有四个（买卖笔数分布、池子深度、
持币地址数、社交与推广状态）在任何公开历史接口里都不存在，拿今天的值回放昨天的价格
等于把答案抄进题目。所以这里没有、也不会有「过去一年信号收益」这种曲线。
详见第三之三节。

**Q17：胜率写 60%，是不是就意味着照着买能赚钱？**

不是。这个数字至少有三个必须同时看的口径：

1. **同期榜单指数基准。** 如果那段时间整个榜单的等权收益比信号还高，说明赚钱的是行情
   不是模型。所以页面会同时给出「中位超额 ＝ 信号收益 − 同期指数收益」。
2. **样本流失率。** 掉出榜单的标的很可能就是归零那批，它们到了结算时间往往补不到价格。
   把这一批从分母里悄悄抹掉，胜率会系统性虚高。页面单独列出流失数，不混进胜率。
3. **最大不利偏移。** 赚 50% 的前提往往是先扛住 −60%。只有收益没有回撤，胜率会显得比实际舒服。

还有两层偏差要知道：账本只覆盖本工具的候选池（不是全市场），结算用的是公开报价
（不含滑点与手续费）。所以它衡量的是**信号的方向性**，不是可实现收益，也不预示未来。

**Q18：为什么「跑赢基准」和「胜率」不是同一个数？**

如果写成同一个数，那这个基准就是白设的。第一版基准取的是每轮**中位**收益，线上跑起来
净值永远停在 1.0000 —— 这类新池子里有大量「一分钟内价格完全没动」的标的，只要过半没动，
当轮中位数就精确等于 0，连乘下来整条线是死的。基准恒为 0 之后，「收益为正」就等于
「跑赢基准」，两个数自然就重合了。

现在基准改成**等权**（每轮再平衡、首尾各 10% 截尾）。这两个口径实测确实会分开：

```text
榜单指数：2 个采样点，等权净值 1.0121（中位口径参照 1.0000）
```

同一段行情、同一批标的，等权口径动了 1.21%，中位口径一动不动。这也是为什么页面上
照旧保留中位口径、但只把它当参照：它的含义是「中位标的其实没动」，不是「大盘没涨」。

顺带一句口径变更的代价：等权基准做 10% 截尾，是为了不被单价错乱这类脏点抬起来。
截尾会丢尾部，所以汇总里同时给出未截尾的均值，两边对着看。

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
- **抓龙胜率是前瞻记录的结果，不是历史回放，也不能预知未来。** 刚部署时账本是空的，
  数字要跑够时间才攒得出来；样本不足 30 笔时页面只报计数、不给胜率。
  读胜率时必须同时读「同期榜单指数基准」与「样本流失率」：前者区分「雷达选得准」和
  「那阵子全市场在涨」，后者防止归零掉榜的标的被悄悄从分母里抹掉。
- 胜率里的收益是**信号的方向性收益**，结算价取自 DexScreener 公开报价，不是可成交价。
  真实成交还要扣滑点与手续费，所以它不等于、也不预示可实现收益。
- 账本统计只覆盖本工具的候选池，不是全市场。它回答「在这个池子里信号值不值」，
  不能外推到整个市场。榜单指数本身偏向活得久的标的，这一层偏差已知且不藏。
- 榜单指数用每轮 10% 截尾的等权收益，这是拿「抗脏点」换来的：截尾会丢掉尾部，
  如果一段行情确实只由少数标的拉起，基准会偏低、超额会偏高。汇总里同时给出未截尾的均值，
  两边对着看，别只看好看的那个。
- 版本号是硬门槛：榜单指数口径变更过（每轮中位 → 每轮等权截尾），旧账本在加载时会被重置，
  而不是接着累。同一条指数上混着两种口径，比丢掉一段数据更糟。
- 纯静态部署（GitHub Pages）只在页面打开时采集，关掉的时段没有观测点；
  到期补不到价格的信号会计入流失。要连续采集请用 Node 形态常驻运行。
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
不是建议下单金额。「抓龙胜率」页报的是本项目自己记录并结算的前瞻样本，样本量有限、
口径覆盖的是本工具候选池而非全市场，且未计入滑点与手续费 —— 它是对本模型历史表现的
描述性统计，既不代表未来表现，也不构成任何形式的业绩承诺。任何依据本项目做出的决策
及其风险由使用者自行承担。

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
- **Hit rate (signal ledger).** No historical replay, because four of the eight factors do not
  exist in any public historical API. Instead the ledger records a token's state and price the
  first time it appears, then settles at the real price 15 minutes / 1 hour / 6 hours / 24 hours
  later. Win rate, the board index benchmark and the attrition rate are meant to be read together.
  See section 3c.
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

## 3c. Hit Rate (Signal Ledger and Forward Test)

The "Hit Rate" page answers one question: did the radar's signals actually make money afterwards.

### 3c.1 Why there is no historical replay

This comes first because it determines the shape of the whole module.

Of the dragon score's eight factors, only volume burst, price acceleration, pool age and market
cap can be rebuilt from public history. **Buy/sell transaction counts, pool depth, holder counts,
social presence and paid promotion do not exist in any public historical API.** Feeding today's
values back over yesterday's prices means treating "the volume that only grew because it pumped"
as the entry-time evidence. That is not a backtest, it is copying the answer into the question.
So this project does no historical replay and publishes no "signals earned X% over the past year"
curve of any kind.

The replacement is **prospective recording plus later settlement**:

1. The first time a token appears on the board, its real state at that moment (dragon score,
   all eight factor scores, market cap, pool depth, pool age, confidence, risk deduction) is
   recorded together with the real price then. This is a **first-sighting signal**.
2. When a token first reaches Candidate or better, an **upgrade signal** is recorded as well.
   The two tiers are reported separately, which is the only way to tell whether "the radar
   notices early" or "the radar confirms correctly" is worth more.
3. Once the 15-minute / 1-hour / 6-hour / 24-hour horizons come due, the signal is settled at the
   real price at that moment. **The signal is recorded first and the price is fetched afterwards**,
   so there is no look-ahead bias.

### 3c.2 Three numbers that must ship together

A win rate on its own can always be made to look good, so the module binds three things together
and the page gives you no way to take one without the others.

| Metric | What it answers | What goes wrong without it |
| --- | --- | --- |
| Win rate | Share of settled samples with positive return | In a broad rally, buying blind also gives a high win rate |
| Board index benchmark | Equal-weight round-over-round return of every continuously listed token (rebalanced each round), chained into a reference line | You cannot separate "the radar picks well" from "the whole market was pumping" |
| Attrition rate | Signals that came due but never got a price | Tokens that fell off the board are probably the ones that died; dropping them inflates the win rate |

**Excess return = signal return - board index return over the same window.** That is what answers
"does the radar beat the average of its own universe".

### 3c.3 Five non-negotiable rules

- **A price must be positive to settle.** `priceUsd <= 0` is refused at settlement and no signal is
  opened at such a price either. On chain data, 0 and negative values mean the pool is gone or the
  fetch failed. Recording that as a 0% return files the most dangerous outcome as "flat".
- **A missing benchmark stays missing.** When no index sample falls in the window, excess is shown
  as "no sample points" and never as 0. A 0 reads as "matched the market", which is a fake number
  that looks like a conclusion.
- **Too few samples means no conclusion.** Below 30 settled samples the page shows counts and
  "accumulating" only, and renders no win rate, median return or excess.
- **Attrition is counted separately.** A signal that still has no price 48 hours after coming due
  is recorded as lost, counted and displayed separately. It is not merged into the win-rate
  denominator and not treated as a neutral zero.
- **The observation series accumulates by bucket id, not by elapsed time since the last point.**
  After entry, one observation price is kept per 5-minute window, and within a window only the
  newest price survives. This looks like an implementation detail but it is the load-bearing part
  of two features: maximum adverse excursion and "backfill from local observations after a token
  leaves the board". Deduplicating by elapsed time instead means that during continuous scanning
  every round falls inside a 5-minute window, every point is overwritten in place, and the series
  never grows beyond one entry -- with nothing visible on the surface to show it.

The ledger also records the **maximum adverse excursion** (worst unrealised drawdown between entry
and settlement) and reports the quantile distribution. A return without a drawdown makes a high win
rate look far more comfortable than the trade actually was: earning 50% requires surviving -60% first.

### 3c.4 How the board index is computed

Each round takes every token present in both the previous and the current round, computes its
round-over-round return, applies a 10% trim (10% off each tail; no trim below 20 tokens), takes the
**equal-weighted mean**, and chains those into a net-value curve. Points beyond a 10x single-round
move are dropped, since a price-unit change at the data source would otherwise whip the whole line.
Index values are stored with 8 decimals: measured round-over-round moves are often around 0.001%,
and 4 decimals would flatten them all to 0, pinning the index at 1.0 and making the benchmark useless.

**Why the benchmark is an equal-weighted mean and not a median.** The first version used the median
round return, and the resulting net value sat pinned at 1.0000 forever. The cause: this pool contains
a large mass of tokens whose price does not move at all within a minute, so once more than half the
board is unchanged the round median is **exactly 0**, the chained product is flat, and "beat the
benchmark" collapses into "return is positive" -- the same number as the win rate. A benchmark pinned
at 0 is a benchmark that does not exist. Switching to the equal-weighted mean separates the two
numbers again. The median variant is still recorded, but only as a reference point: its meaning is
"the median token did not move", not "the market did not rise".

The cost of trimming has to be stated: it discards the tails, so if a rally really is driven by a
handful of tokens the benchmark will read low and excess will read high. The summary therefore also
reports the untrimmed mean for comparison. Leaving it untrimmed has the opposite failure mode: a
single dirty point -- a price-unit change that happens to slip under the 10x threshold -- would lift
the entire benchmark line.

Known limitation, stated openly: tokens entering the board have no previous price and do not count
for that round, and tokens leaving the board stop counting after their last round. The index is
therefore biased toward long-lived tokens, which is the same survivorship problem the signal ledger
faces. Both are affected in the same direction, so the comparison still holds.

One further property is easy to miss: **the chained product of per-round returns is not the return of
a typical token over the whole window.** The former samples "a typical minute", the latter "a typical
token". Measured on live data, the board's median round return is frequently exactly 0 (most meme
tokens do not move within a minute, and once more than half are unchanged the median is 0), so the
median variant of the index is a horizontal line in calm markets -- which is precisely why it cannot
serve as the benchmark. The equal-weighted variant measures "the typical move of the pool per minute",
not "the cumulative move of a typical token".

### 3c.5 How to use it

The ledger is an account that takes time to accumulate. The numbers build up gradually, and an
empty ledger right after deployment is by design, not a failure.

```bash
npm start                                 # the service records signals every scan while it runs
node tools/ledger-report.js               # in another terminal, offline read of data/ledger.json
node tools/ledger-report.js --horizon=1h  # one horizon only
node tools/ledger-report.js --why=upgrade --chain=solana
```

In the page: go to "Hit Rate" and switch horizon (15m / 1h / 6h / 24h) and signal type
(all / first sighting / upgrade). Both read the same `lib/ledger.js`, so the conclusions match.

Rough timeline: the 15-minute horizon reaches a usable sample within about half an hour; the
1-hour horizon takes about an hour; the 6-hour and 24-hour horizons need their own period, with
24 hours taking a full day.

**An inherent limit of pure static deployment:** static mode only collects while the page is open.
Periods with the page closed have no observations, and signals that cannot be priced when due count
as attrition rather than as neutral. For continuous collection, run the Node mode as a service.

### 3c.6 Known biases

- The candidate pool is built from boost feeds, latest token profiles, keyword expansion and your
  watchlist. It is **not the whole market**. This statistic only says whether the signal is worth
  anything inside that pool; it does not extrapolate to the market.
- The board index is biased toward long-lived tokens (see 3c.4).
- Settlement uses DexScreener's public quote, not an executable price. Real fills would also pay
  slippage and fees, so what is reported is the **directional return of the signal**, not a
  realisable return.
- The 15-minute horizon is the noisiest. At equal sample size, longer horizons are more reliable
  but take longer to accumulate.

### 3c.7 First live reading (measured, including the unflattering numbers)

What follows is **actually measured**, not an illustration. After the calibration fix the service
ran 15 consecutive rounds from 21:42 to 21:57 on 2026-09-25, accumulating 116 signals and 68 settled
15-minute samples. Raw output:

```text
Hit rate report (forward record + later settlement, no historical replay)
Started: 2026/9/25 21:42:22    Last advanced: 2026/9/25 21:57:36
Rounds: 15    Live signals: 116    Opened: 116    Settled: 68    Lost: 0
Board index: 14 sample points, equal-weighted net value 0.9943 (median variant reference 1.0000)

Horizon      Settled  Waiting  Lost   Win rate  Median ret  Benchmark  Median excess  Beat benchmark
15 minutes        68       48     0     23.5%       -0.6%      +1.9%          -3.2%          42.6%
1 hour             0      116     0   accumulating       --          --             --             --
6 hours            0      116     0   accumulating       --          --             --             --
24 hours           0      116     0   accumulating       --          --             --             --

By grade (15 minutes, all signals)
  Dragon              4   100.0%     +22.1%     +21.0%
  Candidate           8    25.0%      -2.7%      -3.8%
  Latent              6    33.3%      -0.9%      -5.2%
  Watch              25    20.0%      -0.8%      -3.2%
  Trash              25    12.0%      -0.4%      -4.2%

Average maximum adverse excursion -4.3% (67 signals had an observation series).
```

Four observations worth pulling out:

1. **"Win rate" and "beat the benchmark" are finally not the same number**: 23.5% versus 42.6%.
   Before the calibration fix they were identical by construction. This is the most direct
   acceptance check for the fix.
2. **The benchmark is no longer pinned at 0**: the equal-weighted board index over the same window
   was +1.9%, while the median variant's net value is 1.0000. The two definitions have separated.
3. **On this sample the radar did not beat its own pool.** Median excess is -3.2% and the share of
   signals beating the benchmark is 42.6%, below half. In other words, at the 15-minute horizon the
   median signal did 3.2 percentage points worse than the equal-weighted average of the pool. That
   number is unflattering, and it is exactly why this module exists: a report showing only
   "win rate 23.5%" would not tell you that buying the pool's average token blind did better.
4. **The grade layering points the right way**: Dragon, 4 signals, all winners, median +22.1%,
   excess +21.0%; the tiers decline from there (Latent at n=6 edges above Candidate; too small to
   read). But Dragon has only 4 signals -- **4 signals prove nothing**, and the table is shown
   simply because it is the honest output, not because it is a result.

The boundary has to be stated: this is **one collection run inside a single 15-minute window**,
68 samples, no cross-regime or multi-day coverage, and the 1-hour, 6-hour and 24-hour horizons are
still accumulating. What it demonstrates is that the ledger genuinely records, settles and produces
numbers it did not get to choose -- **not** that the dragon score works over the long run. Real fills
would also pay slippage and fees; the returns here are directional.

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
npm test                    # zero-dependency unit tests (score + checkup + ledger + browser engine)
npm run test:checkup        # checkup model unit tests only
npm run test:ledger         # signal ledger and backtest model unit tests only
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
10. **Read the hit rate.** The hit-rate view is backed by the signal ledger: the state and price
    of a token are recorded the first time it appears, then settled when the 15-minute / 1-hour /
    6-hour / 24-hour horizon comes due. You can switch horizon and signal type
    (all / first sighting / upgrade). **The page is empty right after deployment by design** --
    the numbers accumulate over time. To watch progress without a browser, use the offline tool:

    ```bash
    node tools/ledger-report.js               # read data/ledger.json, print every horizon
    node tools/ledger-report.js --horizon=1h  # one horizon only
    node tools/ledger-report.js --why=upgrade --chain=solana
    ```

    Read three things together on this page: the win rate, the board index benchmark and the
    attrition rate. Section 3c explains why. Note also that what is reported is the
    **directional return of the signal**, before slippage and fees, not a realisable return.

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
│   ├── checkup.js         Four-dimension checkup model, pure functions (window.DragonCheckup)
│   └── ledger.js          Signal ledger and forward test, pure functions (window.DragonLedger)
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
│   ├── serve-static.js    Local preview server for docs/
│   └── ledger-report.js   Offline read of the ledger, prints the hit-rate report
├── test/
│   ├── score.test.js      Scoring model unit tests (zero dependency)
│   ├── checkup.test.js    Checkup model unit tests (zero dependency)
│   ├── ledger.test.js     Signal ledger and backtest model unit tests (zero dependency)
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
| `lib/ledger.js` | Signal ledger and forward-test model (entry snapshots / due-date settlement / board index / statistics), pure functions, no network |
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
| `docs/lib/ledger.js` | Build output: signal ledger and forward-test model |
| `docs/.nojekyll` | Tells GitHub Pages to skip Jekyll processing |
| `tools/build-static.js` | Static site build script |
| `tools/serve-static.js` | Local preview server for the static site |
| `tools/ledger-report.js` | Offline read of `data/ledger.json`, prints the hit-rate report (read-only) |
| `test/score.test.js` | Scoring model unit tests |
| `test/checkup.test.js` | Checkup model unit tests |
| `test/ledger.test.js` | Signal ledger and backtest model unit tests |
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
| GET | `/api/health` | Runtime status: scan count, token count, source stats, ledger counters, error |
| GET | `/api/meta` | Chain list, default chains, factor weights, grade bands, scan interval |
| GET | `/api/radar` | The board. Query: `chain`, `view`, `sort`, `q`, `minLiq`, `limit` |
| GET | `/api/token/:chainId/:address` | Single token detail; fetches and scores fresh if not on the board |
| GET | `/api/checkup/:chainId/:address` | Four-dimension checkup. Query: `capital` (used to derive position size, default 10000), `force=1` to bypass the cache. Results cache for 6 hours, 24 hours for deep checks |
| GET | `/api/price?address=` | Live quote for one token, cached 30 seconds |
| GET | `/api/backtest` | Hit rate. Query: `horizon` (`15m` / `1h` / `6h` / `24h`, default `1h`), `why` (`all` / `first` / `upgrade`), `chain`, `limit`. Returns the summary, sample detail, index curve and the calibration constants. The benchmark lives in `summary.benchmark`: `marketReturn` is the equal-weighted board index (the benchmark proper), `medianReturn` is the median variant kept as a reference |
| POST | `/api/backtest/reset` | Clear the signal ledger and start accumulating again (does not touch the board or the watchlist) |
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
- `test/ledger.test.js`: 34 assertions pass. Covers the signal ledger and forward test:
  first-sighting dedup, upgrade signals only opening at Candidate or better, a price <= 0
  refusing both entry and settlement, the four horizons settling independently, backfilling
  from the local observation series after a token leaves the board, the 48-hour give-up being
  counted separately and never merged into the win-rate denominator, the board index only
  recording a point when a round has enough tokens and dropping dirty points beyond a 10x
  single-round move, the index retaining sub-0.01% round returns (otherwise the line would sit at
  1.0 forever), both the equal-weighted and the median variant being recorded, the equal-weighted
  benchmark never collapsing into the win rate (when the median is 0 and the equal-weighted mean is
  positive, "beat the benchmark" must genuinely fall below the win rate), the 10% per-round trim
  holding up against dirty points once there are enough tokens, the observation series
  accumulating by bucket (deduplicating by elapsed time would leave it at a single point and
  silently break both the drawdown and the backfill), a ledger written by an older version being
  reset rather than mixing two index definitions on one line, index return being `null` when no
  sample falls in the window, refusing to state a win rate below 30 samples, excess return
  equalling signal return minus index return, and no NaN or undefined in any statistic across
  arbitrary fixture combinations.
- `test/engine.test.js`: 111 assertions pass. Fakes `self`, `localStorage` and `fetch` in
  process, loads the real `lib/` and `src/`, and runs the whole pipeline: universe building,
  quote fetching, scoring, persistence, a second round recomputing volume from a real
  interval delta, board filtering, watchlist exemption from the quality floor, and every
  adapter endpoint. Also covers the ledger's browser-side recording (the entry price must be the
  real price at first appearance, never a later one), its separate localStorage key, the
  `/api/backtest` horizon and signal-type parameters, invalid-horizon fallback, and ledger reset.
  No network needed.

Three checks require `jsdom`:

- `npm run test:frontend`: 56 assertions pass. Start the server with `npm start`, then run
  the real `public/app.js` under jsdom and assert that cards, the table, filters, the
  tracking view, the model view and the hit-rate view actually render, and that the server
  returns `null` rather than 0 for win rate and excess while the ledger is empty.
  **Note**: requests to port 8791 must not go through a system proxy. If `http_proxy` or
  `https_proxy` is set on the machine, clear it or add `127.0.0.1` to `no_proxy`, otherwise
  Node sends the loopback request to the proxy and fails with `ECONNREFUSED` (see Q13 item 4
  and the Caveats section).
- `node test/static.smoke.js`: 117 assertions pass. Runs the exact set of scripts built into
  `docs/`, with no backend, and asserts that the artifact that actually ships can scan, score
  and render by itself. It also covers chain filtering, search, row expansion, manual refresh,
  and the full checkup path against stubbed GoPlus / honeypot.is / RugCheck responses on both
  an EVM and a Solana token, including RugCheck backfilling the holder data GoPlus omits and
  Solana pool reserves being excluded from concentration by their `owner`. It also covers the
  missing-data path when the risk source has no record of the contract: no `undefined` may
  appear in the panel and a missing feed may not be reported as a neutral stage. Finally it
  covers the hit-rate page's disclosure rules: counts but no win rate while the sample is
  short, no crash when switching horizon or signal type, and a ledger stored under its own
  localStorage key.
- `npm run test:live`: 15 assertions pass in the latest run (varies slightly with the live
  universe). Downloads
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

**Q16: I opened the hit-rate view and there is nothing there. Why?**

Because the ledger is built by **prospective recording**, not by computation. The first time a
token appears on the board, the model records its state and price at that moment; when the
15-minute / 1-hour / 6-hour / 24-hour horizon comes due, it settles at the real price then. So the
ledger is empty right after deployment. That is by design, not a failure.

Getting numbers needs two things: the service running, and time. The 15-minute horizon reaches a
usable sample within about half an hour, the 1-hour horizon takes about an hour, and the 6-hour and
24-hour horizons need their own periods. Below 30 samples the page shows counts and
"accumulating" only, with no win rate.

You can watch progress without opening the page:

```bash
node tools/ledger-report.js --horizon=15m
```

One more thing must be stated plainly: **this page does no historical replay.** Four of the eight
factors (buy/sell transaction counts, pool depth, holder counts, social and promotion state) do not
exist in any public historical API, and replaying today's values over yesterday's prices is just
copying the answer into the question. There is no, and never will be, a "signals earned X% over the
past year" curve here. See section 3c.

**Q17: If the win rate says 60%, does that mean I make money following it?**

No. That number has at least three qualifications that must be read with it:

1. **The board index benchmark.** If the equal-weighted return of the whole board over the same
   window is higher than the signal's, the market made the money, not the model. So the page also
   reports median excess = signal return - index return over the same window.
2. **The attrition rate.** Tokens that fell off the board are probably the ones that went to zero,
   and they often cannot be priced when settlement is due. Quietly dropping them out of the
   denominator inflates the win rate. The page lists attrition separately and never merges it in.
3. **Maximum adverse excursion.** Earning 50% often requires surviving -60% first. A return without
   a drawdown makes a win rate look far more comfortable than it was.

Two further biases to know: the ledger covers this tool's candidate pool rather than the whole
market, and settlement uses public quotes without slippage or fees. So it measures the **direction**
of the signal, not a realisable return, and does not predict the future.

**Q18: Why are "beat the benchmark" and the win rate not the same number?**

If they were the same number, the benchmark would not be doing anything. The first version used the
**median** round return, and on live data the net value sat pinned at 1.0000: this pool contains a
large mass of tokens whose price does not move at all within a minute, so once more than half the
board is unchanged the round median is exactly 0 and the chained line is dead. With the benchmark
pinned at 0, "return is positive" and "beat the benchmark" coincide -- hence the two identical numbers.

The benchmark is now **equal-weighted** (rebalanced each round, 10% trimmed off each tail). Measured
live, the two definitions genuinely separate:

```text
榜单指数：2 个采样点，等权净值 1.0121（中位口径参照 1.0000）
Board index: 2 sample points, equal-weighted net value 1.0121 (median variant reference 1.0000)
```

Same window, same set of tokens: the equal-weighted line moved 1.21% while the median variant did not
move at all. That is why the median variant is still recorded but kept strictly as a reference -- its
meaning is "the median token did not move", not "the market did not rise".

One cost of the change, stated plainly: the equal-weighted benchmark trims 10% so that dirty points
such as price-unit mix-ups cannot lift it. Trimming discards the tails, so the summary also reports
the untrimmed mean for comparison.

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
- **The hit rate is a forward record, not a historical replay, and it cannot predict the future.**
  The ledger is empty right after deployment and the numbers take time to accumulate. Below 30
  samples the page shows counts and no win rate at all. Always read the win rate together with
  the board index benchmark (which separates "the radar picks well" from "the whole market was
  pumping") and the attrition rate (which stops tokens that fell off the board from being quietly
  dropped out of the denominator).
- Returns in the hit rate are the **directional return of the signal**. Settlement uses
  DexScreener public quotes, not executable prices; a real fill would also pay slippage and fees,
  so it neither equals nor predicts a realisable return.
- Ledger statistics cover this tool's candidate pool only, not the whole market. They say whether
  the signal is worth anything inside that pool and do not extrapolate to the market. The board
  index itself is biased toward long-lived tokens; that bias is known and stated rather than hidden.
- The board index uses an equal-weighted return with a 10% trim per round. That is the price paid
  for robustness against dirty points: trimming discards the tails, so if a stretch of the market
  really is driven by a handful of tokens, the benchmark reads low and excess reads high. The
  summary also reports the untrimmed mean; read both rather than only the flattering one.
- The version number is a hard gate. The index definition changed (median per round to trimmed
  equal-weight per round), so a ledger written by an older version is reset on load rather than
  continued. Mixing two definitions on one index line is worse than losing a stretch of data.
- Pure static deployment on GitHub Pages only collects while the page is open, so periods with the
  page closed have no observations and signals that cannot be priced when due count as attrition.
  Run the Node mode as a service for continuous collection.
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
bound, not a suggested order size. The "Hit Rate" page reports forward samples that this
project records and settles itself: the sample size is limited, it covers this tool's candidate
pool rather than the whole market, and it does not account for slippage or fees. It is a
descriptive statistic about the model's past behaviour, not a statement about future results
and not a performance promise of any kind. Any decision you make on the basis of this software
is your own, and you bear its risk.

---

## License

MIT. See [LICENSE](./LICENSE).
