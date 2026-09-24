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
让使用者能快速把不值得看的标的划掉。

设计原则只有三条：

1. **不假装有数据。** 拿不到的字段明确标成「数据缺口」，不填 0、不填中性值、
   不用演示数据撑场面。上游限流或接口异常时，页面直说，不缓存凑数。
2. **不替你做决定。** 分数是机械加权的结果，不是推荐。页面固定位置放免责声明。
3. **不碰你的资产。** 不连接钱包、不请求签名、不下单、不需要任何密钥。

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
- **自选清单。** 加入自选的标的每轮固定进候选池，不受质量地板限制，存在浏览器本地。
- **手动持仓账本。** 填合约地址、成本价、数量，用实时报价算浮动盈亏（红涨绿跌）。
- **跟车监控。** 复刻 fomo.family 个人主页结构。该站的实时持仓与成交需要登录态令牌，
  未提供令牌时只展示其官方公开名片，不会伪造数据。
- **数据缺口披露。** 新池的 24 小时、6 小时、1 小时窗口尚未成熟时，
  DexScreener 会把几个周期的字段填成同一个值。模型能识别这种退化统计，
  只在真正成熟的窗口上做归一化，不硬凑共振数。

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
npm test                 # 零依赖单测（打分模型 + 浏览器端引擎），不需要网络
npm run test:frontend    # 前端冒烟，需要先在 127.0.0.1:8791 起服务
node test/static.smoke.js  # 静态站冒烟，需要 jsdom
```

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
6. **加自选。** 卡片右下角「加入自选」后，该标的每轮固定进候选池，不受质量地板限制。
   自选存在浏览器本地，换浏览器就没了。
7. **记持仓。** 到「追踪 / 抄作业」页填合约地址、成本价、数量，页面用实时报价算浮动盈亏。
   成本价用美元计价，数量留空按 1 计算。
8. **看模型说明。** 「龙分模型」页列出四个读法与完整因子权重表，方便核对页面上的分数是怎么来的。

自动更新默认开启。关闭后页面不再定时重取，需要手动点「刷新这一轮」。

## 七、目录结构

```
dragon-radar/
├── .gitattributes         统一换行符为 LF
├── .gitignore             排除本地依赖、运行数据、日志与环境变量
├── server.js              本地服务形态入口：扫描编排、快照落盘、/api/* 路由、静态托管
├── lib/
│   ├── score.js           龙分模型（同构模块：Node require / 浏览器 window.DragonScore）
│   └── sources.js         数据源封装（同上，window.DragonSources）
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
│   ├── engine.test.js     浏览器端引擎 + 适配层集成测试（零依赖）
│   ├── frontend.smoke.js  服务形态前端冒烟（需服务在跑 + jsdom）
│   └── static.smoke.js    静态站冒烟（需 jsdom）
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
| `docs/.nojekyll` | 让 GitHub Pages 跳过 Jekyll 处理 |
| `tools/build-static.js` | 静态站构建脚本 |
| `tools/serve-static.js` | 静态站本地预览服务 |
| `test/score.test.js` | 打分模型单测 |
| `test/engine.test.js` | 引擎与适配层集成测试 |
| `test/frontend.smoke.js` | 服务形态前端冒烟测试 |
| `test/static.smoke.js` | 静态站冒烟测试 |

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
- `test/engine.test.js`：76 项通过。在进程内伪造 `self` / `localStorage` / `fetch`，
  加载真实的 `lib/` 与 `src/`，跑完整链路：建候选池、取行情、打分、落盘、
  第二轮用真实区间增量重算量能、榜单筛选、自选豁免质量地板、适配层全部端点。
  不需要网络。

另外两个冒烟测试（需要 `jsdom`）：

- `npm run test:frontend`：37 项通过。先用 `npm start` 起服务，再用 jsdom 跑真实
  `public/app.js`，断言卡片、龙虎榜、筛选、追踪页、模型页都真的渲染出来了。
- `node test/static.smoke.js`：55 项通过。直接用 `docs/` 里构建出来的那一整套脚本，
  不需要后端、不需要网络，断言「真正会部署上去的那份产物」能自己扫描、自己算分、
  自己渲染，并覆盖链筛选、搜索、行展开、手动刷新等交互。

`test/static.smoke.js` 与 `test/frontend.smoke.js` 都需要 `jsdom`。安装方式：

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
- 两种运行形态共用同一份打分口径与前端代码
- 本地服务形态：Node 编排 + /api/* + 快照落盘
- 纯静态形态：浏览器端引擎，可直接部署到 GitHub Pages
- 测试：打分单测 12 项、引擎集成 76 项、前端冒烟 37 项、静态站冒烟 55 项"
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

**Q1：页面一直显示「正在扫描候选池…」，卡片是空的。**

首轮扫描要拉若干次公开接口，通常 3 至 8 秒。超过 30 秒还没有结果，看状态行是否提示
「扫描出错」，或打开浏览器控制台看请求是否被拦。常见原因是网络访问不到
`api.dexscreener.com`，或同一出口 IP 触发了限流。

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

## 十三、注意事项

- 本项目不连接钱包、不请求签名、不需要私钥、不发起任何交易。
- 页面上的分数、分级、判定都是对公开数据的机械计算，**不是投资建议**。
  「可看」的意思是「值得你自己核一遍」，不是「可以买」。
- 页面会定时请求第三方公开接口。请自觉控制刷新频率与自建服务的并发，不要干扰上游服务。
- 候选人池里的链上标的绝大多数是 meme 币，归零是常态。任何仓位决策请自行判断并承担风险。
- 页面按 A 股习惯着色：涨为红、跌为绿。这不是笔误。
- 请勿把 `data/` 目录或任何令牌提交进仓库。`.gitignore` 已覆盖这两类文件。
- 主分支只跑零依赖测试。`jsdom` 相关的冒烟测试是可选脚本，不要为了它在 CI 里引入重依赖。

## 十四、免责声明

免责声明：以上内容基于公开数据和量化分析，仅供参考，不构成投资建议。市场有风险，
投资需谨慎。任何投资决策应结合个人风险承受能力、资金状况和投资目标独立判断，
必要时咨询持牌专业机构。过往表现不预示未来收益。

关于数据与金融信息的附加说明：本项目是公开数据的统计工具，不连接钱包、不需要任何密钥、
不代客下单，其输出不构成投资建议。全部行情读自第三方公开接口（主要为 DexScreener），
可能延迟、缺失或错误。龙分与分级只是对这些数据的机械加权计算，不是推荐。
任何依据本项目做出的决策及其风险由使用者自行承担。

---

# English Documentation

## 1. Introduction

Dragon Radar is an on-chain scanning tool built entirely on public data. It assembles a
candidate pool from DexScreener's public read-only endpoints, scores and grades each pool,
and lays the volume and price structure out on one page so you can strike out the
candidates that do not deserve a second look.

Three design rules:

1. **Never fake data.** Fields that cannot be read are reported as explicit data gaps.
   They are not filled with zero, not filled with a neutral value, and never replaced by
   demo data. When an upstream rate-limits or fails, the page says so instead of falling
   back to stale numbers.
2. **Never make the decision for you.** The score is mechanical weighted arithmetic, not a
   recommendation. The disclaimer sits in a fixed place on every view.
3. **Never touch your assets.** No wallet connection, no signature request, no order
   placement, no API keys.

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
npm test                    # zero-dependency unit tests, no network needed
npm run test:frontend       # frontend smoke test, needs a server on 127.0.0.1:8791
node test/static.smoke.js   # static site smoke test, needs jsdom
```

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
6. **Add to watchlist.** Watchlisted tokens enter the pool every round regardless of the
   quality floor. The list lives in browser local storage.
7. **Track positions.** On the tracking view, enter contract address, cost basis and size;
   PnL is marked to market with live quotes. Cost basis is in USD; an empty size means 1.
8. **Read the model page.** It documents the four reading rules and the full factor weight
   table, so you can check where a score came from.

Auto refresh is on by default. Turn it off and the page stops re-fetching; use the manual
refresh button instead.

## 7. Project Layout

```
dragon-radar/
├── server.js              Server mode entry: scan orchestration, snapshots, /api/* routes, static hosting
├── lib/
│   ├── score.js           Dragon Score model (isomorphic: Node require / browser window.DragonScore)
│   └── sources.js         Data source wrappers (same, window.DragonSources)
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
│   ├── engine.test.js     Engine plus adapter integration tests (zero dependency)
│   ├── frontend.smoke.js  Frontend smoke test for server mode (needs a running server and jsdom)
│   └── static.smoke.js    Static site smoke test (needs jsdom)
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
| `docs/.nojekyll` | Tells GitHub Pages to skip Jekyll processing |
| `tools/build-static.js` | Static site build script |
| `tools/serve-static.js` | Local preview server for the static site |
| `test/score.test.js` | Scoring model unit tests |
| `test/engine.test.js` | Engine and adapter integration tests |
| `test/frontend.smoke.js` | Frontend smoke test for server mode |
| `test/static.smoke.js` | Static site smoke test |

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
- `test/engine.test.js`: 76 assertions pass. Fakes `self`, `localStorage` and `fetch` in
  process, loads the real `lib/` and `src/`, and runs the whole pipeline: universe building,
  quote fetching, scoring, persistence, a second round recomputing volume from a real
  interval delta, board filtering, watchlist exemption from the quality floor, and every
  adapter endpoint. No network needed.

Two smoke tests require `jsdom`:

- `npm run test:frontend`: 37 assertions pass. Start the server with `npm start`, then run
  the real `public/app.js` under jsdom and assert that cards, the table, filters, the
  tracking view and the model view actually render.
- `node test/static.smoke.js`: 55 assertions pass. Runs the exact set of scripts built into
  `docs/`, with no backend and no network, and asserts that the artifact that actually ships
  can scan, score and render by itself. It also covers chain filtering, search, row
  expansion and manual refresh.

Both smoke tests need `jsdom`:

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

**Q1: The page is stuck on "scanning the candidate pool" and no cards appear.**

The first scan makes several public API calls and normally takes 3 to 8 seconds. If there is
still nothing after 30 seconds, check whether the status line reports a scan error, and open
the browser console to see whether requests are being blocked. The usual causes are no route
to `api.dexscreener.com`, or rate limiting on the shared egress IP.

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

## 13. Caveats

- This project does not connect to a wallet, does not request signatures, does not need
  private keys and does not place any orders.
- Every score, grade and verdict is mechanical arithmetic over public data and is **not
  investment advice**. "Tradable" means "worth verifying yourself", not "safe to buy".
- The page polls third-party public endpoints on a timer. Keep your refresh rate and any
  self-hosted concurrency reasonable and do not burden the upstream services.
- The overwhelming majority of tokens in the candidate pool are meme coins, and going to zero
  is the norm. Any position sizing decision is yours, and so is the risk.
- Colors follow the Chinese market convention: up is red, down is green. This is not a bug.
- Never commit the `data/` directory or any token into the repository. `.gitignore` already
  covers both.
- CI on the main branch runs only the zero-dependency tests. The `jsdom` smoke tests are
  optional scripts; do not pull heavy dependencies into CI for their sake.

## 14. Disclaimer

This project is based on public data and quantitative analysis. It is provided for reference
only and does not constitute investment advice. Markets carry risk; invest with caution. Any
investment decision should be made independently in light of your own risk tolerance,
financial situation and objectives, and you should consult a licensed professional where
appropriate. Past performance does not indicate future results.

Additional notice on data and financial information: this project is a public-data
statistics tool. It does not connect to any wallet, does not require API keys and does not
place orders. Nothing it outputs is investment advice. All market data is read from
third-party public interfaces, primarily DexScreener, and may be delayed, incomplete or
wrong. Scores and grades are mechanical arithmetic over that data, not recommendations. Any
decision you make on the basis of this software is your own, and you bear its risk.

---

## License

MIT. See [LICENSE](./LICENSE).
