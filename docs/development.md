# 爱夏天真的太好了 ERP + 采集器开发文档

更新时间：2026-06-02

本文档用于项目收尾、后续维护和二次开发。当前版本已经跑通“本地采集器登录淘宝/京东、本地采集订单、同步到中央 ERP、服务器报表展示、管理员诊断采集异常”的主流程。

## 1. 当前目标

系统拆成两个职责：

- 中央服务器：账号登录、权限、店铺、订单、开支、报表、采集问题诊断、数据长期保存。
- 本地一体化 EXE：启动本地 ERP 界面、隐藏 WebView2 采集器、保持店铺会话、打开淘宝/京东扫码登录、捕获网络响应、采集并同步订单。

核心原则：

- 淘宝/京东页面只在本地电脑或云电脑打开。
- 平台看到的 IP 永远是运行 EXE 的机器 IP。
- 服务器不打开平台页面，不直接控制店铺采集。
- 用户桌面只看到 `爱夏天真的太好了.exe` 对应的 ERP 界面，采集器窗口默认隐藏，只有新增登录、处理验证、手动唤起店铺页面时才显示。

## 2. 运行模式

### 2.1 中央服务器模式

用于公网 ERP：

```bash
PORT=3001
ERP_ENABLE_LOCAL_COLLECTOR_CONTROLS=0
ERP_DATA_DIR=/root/erp/server/data
ERP_DEFAULT_ADMIN_PASSWORD=自行设置
```

特点：

- 接收 `/api/collector/ingest/shops`、`/api/collector/ingest/orders`、`/api/collector/ingest/issues`。
- 采集控制接口返回 `409`，避免服务器公网 IP 触发平台风控。
- 前端“新增店铺/采集订单/轮询”只在本地 EXE 内可用，服务器页面主要用于看数据和诊断。

### 2.2 本地桥接模式

用于正式 Windows EXE：

```text
server-url.txt = http://111.228.63.217:3001
```

启动器会给本地 ERP 后端设置：

```bash
ERP_REMOTE_BASE_URL=http://111.228.63.217:3001
SHOP_COLLECTOR_HOME={发布包}/collector
SHOP_COLLECTOR_URLS=http://127.0.0.1:5069
```

特点：

- EXE 内 WebView2 优先打开中央服务器页面 `http://111.228.63.217:3001`，所以订单列表、报表、页面布局、按钮文案等前端更新可以主要通过服务器发布。
- 启动器仍会启动本地桥接后端和本机采集器，并向页面注入 `window.__AIXIATIAN_LOCAL_API_BASE__ = http://127.0.0.1:{port}/api`。
- 普通 ERP 数据接口直接请求中央服务器。
- 前端只有 `collectorApi` 会在检测到 EXE 注入的本地地址后，改走本机 `/api/collector/*`，用于控制本机采集器。
- 采集完成后通过中央服务器 ingest 接口同步。
- 淘宝/京东登录和订单采集仍然发生在运行 EXE 的机器上，平台看到的登录 IP 与采集 IP 始终一致。
- 如果中央服务器页面不可用，启动器会回退到本地内置页面，保持基本可用。

### 2.3 纯本地开发模式

不设置 `ERP_REMOTE_BASE_URL` 时，本地 ERP 使用本地 SQLite 数据库，适合开发调试。

## 3. 进程与端口

| 组件 | 默认端口 | 说明 |
| --- | --- | --- |
| ERP Node 后端 | `3001` | Express + SQLite，提供 ERP API 和静态前端 |
| WebView2 采集器 | `5069` | 本地 HTTP API，控制店铺会话和采集 |
| 一体化启动器 | 无固定端口 | 启动并托管 ERP 后端、采集器和主窗口 |

正式用户运行发布包根目录：

```text
爱夏天真的太好了.exe
```

## 4. 代码结构

ERP 源码：

```text
C:\Users\jxywx\Desktop\erp
  client/              React + Ant Design 前端
  server/              Express 后端
  docs/                当前 API 与开发文档
  一键部署.ps1          服务器部署脚本
```

采集器与一体化启动器源码：

```text
C:\Users\jxywx\Documents\Codex\2026-05-31\1-2-shop-id-uuid-3
  src/ShopCollector.WebView2/  WebView2 采集器
  src/UnifiedLauncher/         一体化 EXE 启动器
  docs/                        采集器/交付文档
  dist/ErpCollectorAllInOne/   当前发布包目录
```

关键模块注释：

| 文件 | 职责 |
| --- | --- |
| `server/src/app.js` | ERP 后端入口；根据 `ERP_REMOTE_BASE_URL` 决定本地数据模式还是桥接模式 |
| `server/src/db/init.js` | SQLite 初始化、迁移、管理员账号创建 |
| `server/src/routes/collector.js` | 采集器代理、中央 ingest、轮询队列、采集异常上报 |
| `server/src/routes/orders.js` | 订单增删改查；删除采集订单时写入忽略表 |
| `server/src/routes/reports.js` | 报表统计；未付款/取消/关闭不计入销售和利润 |
| `src/ShopCollector.WebView2/ApiHost.cs` | 本地采集器 HTTP API |
| `src/ShopCollector.WebView2/SessionManager.cs` | 店铺会话生命周期、首次全量判断、采集调度 |
| `src/ShopCollector.WebView2/ShopWindow.cs` | WebView2 窗口、网络捕获、DOM 辅助点击、安全验证检测 |
| `src/ShopCollector.WebView2/CaptureInspector.cs` | 原始响应解析、候选响应、标准订单导出 |
| `src/ShopCollector.WebView2/StorageMaintenance.cs` | raw、导出快照、日志、浏览器缓存清理策略 |
| `src/UnifiedLauncher/LauncherForm.cs` | 发布版一体化启动、本地端口和环境变量配置 |

## 5. 数据目录

本地 EXE 发布包运行后会产生：

| 数据 | 路径 |
| --- | --- |
| 本地 ERP 数据 | `data/erp/erp.db` |
| WebView2 运行数据 | `data/erp-webview2/` |
| 采集器店铺记录 | `collector/data/shops.webview2.json` |
| Cookie 快照 | `collector/data/cookies/{shopId}.cookies.json` |
| 浏览器 profile | `collector/profiles/webview2/{platform}/EBWebView/WV2Profile_*` |
| 原始响应 | `collector/captures/{shopId}/raw/` |
| DOM 截图与候选元素 | `collector/captures/{shopId}/dom/` |
| 最新订单导出 | `collector/captures/{shopId}/exports/orders-latest.json` |
| 采集日志 | `collector/logs/{shopId}.webview2.jsonl` |

服务器数据：

```text
/root/erp/server/data/erp.db
```

发布包不能自带用户数据。干净包里不应该有：

```text
data/
collector/data/
collector/profiles/
collector/captures/
collector/logs/
erp/server/data/erp.db
```

## 6. 店铺登录流程

1. 用户在 ERP 店铺页点击新增店铺。
2. 选择淘宝或京东。
3. 本地桥接后端调用 `POST /api/collector/shops`。
4. 本地采集器生成 UUID 作为 `shop_id`。
5. 为该店铺创建独立 WebView2 profile。
6. 打开平台登录页。
7. 用户扫码登录。
8. 自动或手动执行登录检查。
9. 捕获真实店铺名。
10. 本地桥接后端同步店铺到中央服务器。

登录入口：

```text
淘宝：https://myseller.taobao.com/
京东：https://passport.shop.jd.com/login/index.action/jdm?ReturnUrl=https%3A%2F%2Fshop.jd.com
```

真实店铺名优先级：

```text
接口字段 shopName/shop_name/storeName/store_name/mallName/venderName/vendorName/merchantName
DOM 属性 data-shop-name/data-store-name
页面中明确的店铺卡片名称
```

必须排除账号名和平台壳名称：

```text
nick, displayNick, sellerNick, sellerName, account, userName,
京麦, JDM京麦, 千牛, 千牛工作台, 淘宝卖家中心, 商家后台
```

后续捕获到真实 `shopName` 时，会覆盖之前误识别的账号名或平台名。

## 7. 订单采集流程

采集方式是 WebView2 DevTools Protocol 网络响应捕获，不是官方 API：

1. 打开平台订单页。
2. 监听 `Network.responseReceived`。
3. 等 `Network.loadingFinished` 后调用 `Network.getResponseBody`。
4. 保存原始响应到 `captures/{shopId}/raw/`。
5. JSONP 先剥离 callback，再进入平台 parser。
6. 输出标准订单到 `captures/{shopId}/exports/orders-latest.json`。
7. 本地桥接后端读取标准订单并同步中央 ERP。

ERP 处理状态与平台状态分离：

- `orders.status` 是 ERP 人工处理状态，不再直接等同淘宝/京东平台订单状态。
- 平台未付款/待支付订单写入 `unpaid`，不计销售额、成本、利润，也不进入未完成处理压力。
- 平台已付款或待处理订单写入 `unprocessed`，由人工推进到 `ordered_not_uploaded`、`ordered_waiting_tracking`、`completed`。
- 同一订单先采到未付款，后续同步发现已付款时，如果人工还没处理，会自动从 `unpaid` 转为 `unprocessed`。
- 人工已经推进到已拍单或处理完成的订单，后续采集只更新平台字段、金额、图片、发货时限和原始 JSON，不覆盖人工处理状态。

发货时限提醒口径：

- 不再依赖平台返回的“多久内发货”字段，统一按真实下单时间 `platform_created_at || created_at` 加 48 小时计算。
- 未付款、待支付、买家未付款不显示发货时限，也不计入未发货、临近到期或超时。
- 已取消、交易关闭、作废、退款、售后不显示发货时限，也不计入未发货、临近到期或超时。
- 已发货、已出库、待收货、交易成功、已完成、已签收不显示倒计时。
- ERP 人工状态为 `completed` 的订单视为处理完成，不再显示或统计发货超时。

平台入口：

```text
淘宝：https://myseller.taobao.com/home.htm/trade-platform/tp/pc
京东：https://porder.shop.jd.com/order/orderlist/allOrders
```

已验证的关键接口：

| 平台 | 响应 |
| --- | --- |
| 淘宝 | `trade.taobao.com/trade/itemlist/asyncSold.htm` |
| 淘宝 | `mtop.taobao.trade.order.nums.pc` |
| 淘宝 | `mtop.taobao.trade.order.xsd` |
| 京东 | `dsm.order.bff.orderListBffService.queryOrderPage` |
| 京东 | `dsm.order.bff.orderListBffService.queryOrderSkuComments` |
| 京东 | `dsm.order.bff.orderListBffService.queryOrderTags` |

## 8. 首次全量与增量规则

普通采集按钮调用：

```http
POST /api/collector/shops/{collectorShopId}/collect-orders
```

采集器内部判断：

- 如果 `captures/{shopId}/exports/orders-latest.json` 不存在，执行 `initial_full`，会自动翻页。
- 如果最新导出已存在，执行 `incremental`，只采最新页面/最新响应。

强制全量按钮调用：

```http
POST /api/collector/shops/{collectorShopId}/collect-orders?full=1
```

强制全量用于：

- 首次导入失败后人工补采。
- 低频对账。
- 用户手动打开店铺页面调整筛选条件后再补采。

全量不放进定时轮询，避免几十家店铺同时翻页触发平台风控。

## 9. 轮询机制

轮询入口：

```http
GET /api/collector/polling
POST /api/collector/polling
```

可选间隔：

```text
30 分钟
60 分钟
```

机制说明：

- 每 10 秒心跳一次，只执行到期的一个店铺。
- 每家店铺按 `最近采集时间 + 轮询间隔` 判断是否到期。
- 已到期店铺会尽快错峰进入队列；同一时间到期的多店铺会按短间隔串行执行。
- 未到期店铺会在到期时间后加入最多约 5 分钟随机延迟，避免大量店铺同时请求平台。
- 本地后端启动后会自动加载已保存的轮询设置，不需要先打开店铺页才初始化轮询。
- 新登录且同步成功的店铺，状态变成 `online` 或 `synced` 后自动进入队列。
- `security_paused`、禁用店铺、未绑定采集器 ID 的店铺不参与轮询。
- 桥接模式开启轮询时会保存当前登录 token；如果 token 缺失或失效，轮询会报错并在管理员诊断中展示。
- 店铺页提供“轮询自检”，会通过 `POST /api/collector/polling/run-once` 立即执行一次同样的轮询采集代码，并显示最近检查、最近轮询和错误信息。
- 店铺页还提供“1分钟实测”，会通过 `POST /api/collector/polling/schedule-test` 把一个店铺排到 1 分钟后，不立即采集；只有后台心跳自己触发后才会更新最近轮询，用来验证定时器真实性。

并发原则：

- 多店铺之间错峰。
- 同一店铺内翻页、点击、解密动作串行。
- 日常轮询只做增量。
- 全量、地址解密、敏感信息查看由人工按钮触发。

## 10. 安全验证与滑块

采集器会检测以下情况：

```text
x5sec, verify, captcha, security, 滑块, 验证码, 安全验证
```

检测到后：

1. 采集器返回 `paused/security_paused`。
2. ERP 将店铺 `collector_status` 更新为 `security_paused`。
3. 写入 `collector_issues`。
4. 前端管理员界面显示红色警告。
5. 定时轮询跳过该店铺。
6. 用户手动唤起店铺页面处理验证。
7. 处理后点击登录检查，恢复为 `online`。

这套机制是为了防止程序反复刷新验证页，导致风控进一步加重。

## 10.1 客户端日志上传

目的：当用户机器、云电脑或其他本地环境出现采集失败、内存异常、滑块暂停、接口异常时，管理员可以在服务器“采集诊断”页面直接看到运行摘要和日志尾部。

链路：

1. 一体化 EXE 登录 ERP 后，启动器从本地 WebView 读取当前 ERP token。
2. 启动器每隔约 30 秒尝试把 `serverBaseUrl` 和 token 配置给本地采集器。
3. 本地采集器默认每 10 分钟自动上传一次，也支持管理员在前端手动点击“上传本机日志”。
4. 服务器接收 `/api/collector/ingest/logs` 后写入 `collector_issues`。
5. 只有管理员能在“采集诊断”页面查看这些记录。

安全边界：

- 只上传采集器和启动器日志尾部，不上传店铺 profile、Cookie、LocalStorage、SessionStorage、raw captures 或订单导出文件。
- 上传前脱敏 `Authorization`、`Bearer`、`Cookie`、`Set-Cookie`、`token`、`password` 等常见敏感值。
- 单次最多 30 个文件，单文件最多 48KB 尾部，整体约 768KB。
- 日志路径会简化为 `$APP_ROOT/...` 或文件名，不暴露完整浏览器 profile 路径。
- 如果 ERP token 缺失或失效，自动上传会跳过，不影响正常采集。

相关本地环境变量：

```bash
SHOP_COLLECTOR_LOG_UPLOAD_INTERVAL_MINUTES=10
SHOP_COLLECTOR_EXTRA_LOG_DIRS=logs
```

## 11. 删除同步规则

店铺删除：

- ERP 删除绑定采集器的店铺时，写入 `collector_shop_deletions`。
- 后续采集器旧会话再同步该 `collector_shop_id` 时会被跳过或拒绝。

订单删除：

- 删除采集器同步的订单时，写入 `order_sync_ignores`。
- 后续平台再次采集到同一订单号，不会重新插入。

这是为了支持用户在 ERP 中明确丢弃不需要的订单或测试数据。

## 12. 存储清理策略

采集器每次采集后会执行：

- 清理浏览器缓存，不清理 Cookie、LocalStorage、SessionStorage。
- 清理超出保留策略的 raw 响应。
- 清理过多的导出快照。
- 控制单店铺日志文件大小。

环境变量：

```bash
SHOP_COLLECTOR_MAX_RAW_FILES_PER_SHOP=2000
SHOP_COLLECTOR_RAW_RETENTION_DAYS=30
SHOP_COLLECTOR_MAX_EXPORT_SNAPSHOTS_PER_SHOP=50
SHOP_COLLECTOR_EXPORT_RETENTION_DAYS=60
SHOP_COLLECTOR_MAX_LOG_MB=20
```

浏览器缓存清理不会破坏登录持久化；真正影响登录的是删除 profile、Cookie 快照或平台主动让会话失效。

## 13. 数据库表说明

| 表 | 说明 |
| --- | --- |
| `users` | 登录用户、角色、状态 |
| `shops` | ERP 店铺；包含 `collector_shop_id`、采集状态、最后登录检查、最后采集时间 |
| `orders` | ERP 订单；包含平台状态、真实订单时间、发货时限、主图、原始 JSON |
| `expenses` | 开支 |
| `settings` | OCR、系统、采集器配置 |
| `token_usage` | OCR/AI 调用用量 |
| `order_sync_ignores` | ERP 删除订单后的采集忽略记录 |
| `collector_shop_deletions` | ERP 删除店铺后的采集忽略记录 |
| `collector_issues` | 采集失败、滑块、安全验证、登录异常等诊断 |

报表口径：

- 未付款、取消、关闭、作废订单不计入销售额、成本和利润。
- 只有 ERP 状态 `completed` 计入处理完成。
- ERP 状态 `unpaid` 不进入未完成处理压力。
- 除 `completed` 和 `unpaid` 以外的 ERP 状态都算未完成处理。
- 未发货、临近到期、发货超时订单排除已发货、已完成、退款、取消、关闭、未付款，以及 ERP `completed`。

更新策略：

- 页面布局、订单状态、报表字段、提醒文案、接口返回字段优先通过 ERP 前端/后端更新完成。
- 本地 EXE 保持为稳定底座，负责启动本地 ERP、隐藏采集器、维持 WebView2 会话和本机采集 API。
- 只有采集底层能力变化时才需要发布 EXE，例如 WebView2 会话管理、平台页面自动化、网络响应解析、进程管理。
- 当前已接入在线更新机制：EXE 启动后请求服务器 `/api/updates/manifest`，发现新版本后提示用户下载，校验 SHA256，通过 `updater/AixiatianUpdater.exe` 替换程序并重启。
- 自动更新会保留 `data`、`server-url.txt`、采集器 `profiles/captures/logs/data`、ERP 本地数据库和所有 `.db/.db-wal/.db-shm` 文件。
- 更新包当前版本：`1.2.5`，服务器下载地址：`http://111.228.63.217:3001/updates/ErpCollectorAllInOne-1.2.5.zip`。

## 14. 发布与部署

服务器更新：

```powershell
C:\Users\jxywx\Desktop\erp\一键部署.ps1
```

本地发布包目录：

```text
C:\Users\jxywx\Documents\Codex\2026-05-31\1-2-shop-id-uuid-3\dist\ErpCollectorAllInOne
```

压缩包：

```text
C:\Users\jxywx\Documents\Codex\2026-05-31\1-2-shop-id-uuid-3\dist\ErpCollectorAllInOne.zip
```

发布包必需文件：

```text
爱夏天真的太好了.exe
server-url.txt
runtime/node/node.exe
collector/app/ShopCollector.WebView2.exe
collector/runtime/MicrosoftEdgeWebView2RuntimeInstallerX64.exe
erp/server/
erp/client/dist/
docs/
```

打包前检查：

- 不带任何真实店铺 profile。
- 不带 `erp.db`。
- 不带旧 captures、logs、cookies。
- `server-url.txt` 指向正式服务器。
- 启动后能登录服务器账号。
- 新增淘宝/京东能弹出扫码窗口。
- 首次普通采集可自动全量。
- 第二次普通采集为增量。
- 轮询只提供 30/60 分钟并错峰。
- 安全验证能暂停并上报给管理员。

## 15. 后续开发入口

优先级建议：

1. 完整收货信息解密接口：保留为人工按钮触发，不放进默认轮询。
2. 订单采集 parser 增强：优先扩展标准字段，不改已有字段语义。
3. 多节点采集管理：中央服务器只登记节点状态，不直接打开平台页面。
4. 更细报表：基于 `orders.raw_json` 和标准字段补充，不破坏当前报表口径。
5. 自动化测试：重点覆盖 ingest、删除忽略、报表口径、轮询状态。
