# ERP 与本地采集端 API 文档

更新时间：2026-06-02

本文档描述当前正式版 ERP 与本地采集器的接口。系统已经不再使用旧的外部写入链路，中央服务器只负责账号、权限、店铺、订单、报表和采集诊断；淘宝/京东登录与订单采集始终由本地 Windows EXE 内的 WebView2 采集器完成。

## 1. 地址与模式

中央服务器：

```text
http://111.228.63.217:3001
```

本地一体化 EXE 内部 ERP：

```text
http://127.0.0.1:3001
```

本地采集器：

```text
http://127.0.0.1:5069
```

正式服务器必须关闭采集控制：

```bash
ERP_ENABLE_LOCAL_COLLECTOR_CONTROLS=0
```

本地 EXE 通过 `server-url.txt` 或启动器环境变量进入桥接模式：

```text
ERP_REMOTE_BASE_URL=http://111.228.63.217:3001
```

桥接模式下：

- EXE 内 WebView2 优先打开中央服务器页面，普通 ERP 数据接口直接请求中央服务器。
- 启动器向页面注入 `window.__AIXIATIAN_LOCAL_API_BASE__ = http://127.0.0.1:{port}/api`。
- 前端只有 `collectorApi` 在检测到该变量时改走本机 `/api/collector/*`，用来控制本机采集器。
- 本地桥接后端仍保留 `/api/auth`、`/api/orders`、`/api/reports` 等代理能力，用于服务器页面不可用时回退到本地内置页面。
- 采集完成后，本机桥接后端调用中央服务器 `/api/collector/ingest/*` 同步数据。
- 淘宝/京东看到的 IP 是运行 EXE 的本地电脑或云电脑 IP，不是中央服务器 IP。

## 2. 通用请求头

ERP API 需要登录令牌：

```http
Authorization: Bearer {token}
Accept: application/json
Content-Type: application/json
```

本地采集器裸接口默认只监听 `127.0.0.1:5069`，由本地 ERP 桥接后端调用；不建议直接暴露公网。

## 3. 认证接口

### 3.1 登录

```http
POST /api/auth/login
Content-Type: application/json
```

请求：

```json
{
  "username": "admin",
  "password": "admin123456"
}
```

返回：

```json
{
  "token": "jwt token",
  "user": {
    "id": 1,
    "username": "admin",
    "nickname": "管理员",
    "role": "admin"
  }
}
```

### 3.2 当前用户

```http
GET /api/auth/me
Authorization: Bearer {token}
```

### 3.3 修改密码

```http
POST /api/auth/change-password
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "oldPassword": "old-pass",
  "newPassword": "new-pass"
}
```

## 4. 用户接口

以下接口仅管理员可用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/users` | 用户列表 |
| `POST` | `/api/users` | 新增用户 |
| `PUT` | `/api/users/{id}` | 修改昵称、角色、状态或密码 |
| `DELETE` | `/api/users/{id}` | 删除用户，不能删除当前登录用户 |

用户角色：

```text
admin     管理员，可看采集诊断、用户、设置和全部数据
operator  录入员，只处理自己权限范围内的数据
```

## 5. 店铺接口

### 5.1 ERP 店铺列表

```http
GET /api/shops
Authorization: Bearer {token}
```

返回字段包含：

```text
id, name, platform, real_name, collector_shop_id,
collector_status, last_login_check_at, last_collect_at, status, created_at
```

### 5.2 手工新增 ERP 店铺

```http
POST /api/shops
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "name": "店铺名称",
  "platform": "taobao"
}
```

正常新增淘宝/京东登录店铺时，前端应优先使用 `POST /api/collector/shops`，因为它会创建本地采集器会话并打开扫码登录窗口。

### 5.3 修改店铺

```http
PUT /api/shops/{id}
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "name": "店铺名称",
  "platform": "jd",
  "status": 1
}
```

### 5.4 删除店铺

```http
DELETE /api/shops/{id}
Authorization: Bearer {token}
```

删除规则：

- 店铺下已有订单时拒绝删除。
- 绑定了 `collector_shop_id` 时，会请求本地采集器删除该店铺会话。
- 删除后会写入 `collector_shop_deletions` 墓碑记录，避免下次同步时被采集器旧会话重新带回。

## 6. 订单接口

### 6.1 订单列表

```http
GET /api/orders?shop_id=&status=&delivery_status=&handler_id=&keyword=&start_date=2026-06-01&end_date=2026-06-30&page=1&pageSize=20
Authorization: Bearer {token}
```

说明：

- 管理员可看全部订单。
- 录入员默认只看自己负责的订单。
- `start_date`、`end_date` 按订单时间 `created_at` 过滤。
- `keyword` 匹配订单号、商品名、快递单号。
- `delivery_status=unshipped|due_soon|overdue` 用于筛选未发货、6 小时内到期、发货已超时。
- 发货风险筛选会排除未付款、取消、交易关闭、作废、退款售后、已发货、已完成，以及 ERP 处理状态 `completed`。

订单汇总：

```http
GET /api/orders/summary
Authorization: Bearer {token}
```

返回：

```json
{
  "total_count": 379,
  "unpaid_count": 2,
  "not_completed_count": 297,
  "unshipped_count": 51,
  "shipping_overdue_count": 47,
  "shipping_due_soon_count": 0
}
```

### 6.2 新增订单

```http
POST /api/orders
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "order_no": "5114049984537618037",
  "product_name": "商品标题",
  "quantity": 1,
  "shop_id": 1,
  "price": 99.9,
  "cost": 45,
  "tracking_no": "",
  "status": "unprocessed",
  "note": ""
}
```

`cost` 是总成本，不再按数量相乘。

### 6.3 修改订单

```http
PUT /api/orders/{id}
Authorization: Bearer {token}
Content-Type: application/json
```

可更新字段：

```text
order_no, product_name, quantity, shop_id, price, cost,
tracking_no, status, refund_amount, refund_note, note
```

### 6.4 批量修改处理状态

```http
PATCH /api/orders/batch/status
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "ids": [101, 102, 103],
  "status": "ordered_not_uploaded"
}
```

说明：

- `status` 必须是订单状态枚举之一。
- 管理员可以批量修改所有订单。
- 录入员只能批量修改自己负责的订单。
- 返回 `updated` 和 `skipped`，用于判断实际更新数量。

### 6.5 删除订单

```http
DELETE /api/orders/{id}
Authorization: Bearer {token}
```

如果删除的是采集器同步订单，会写入 `order_sync_ignores`。之后平台再次采集到同一个 `order_no + collector_shop_id` 时不会自动恢复，符合“ERP 删除后就不再需要该订单”的规则。

### 6.6 订单状态

| 状态 | 含义 | 报表处理 |
| --- | --- | --- |
| `unpaid` | 未付款/待支付 | 不计入销售额、成本、利润，也不计入未处理压力 |
| `unprocessed` | 未处理 | 计入未完成处理压力 |
| `ordered_not_uploaded` | 已拍单未上传安抚单 | 计入未完成处理压力 |
| `ordered_waiting_tracking` | 已拍单等待同步单号 | 计入未完成处理压力 |
| `completed` | 处理完成 | 计入处理完成 |

只有 ERP 状态为 `completed` 的订单叫处理完成订单。`unpaid` 只表示平台未付款，不需要人工处理；除 `completed` 和 `unpaid` 以外的 ERP 状态都计入未完成处理压力。

采集同步状态规则：

- 平台返回未付款/待支付时，ERP 状态写入 `unpaid`。
- 同一订单下次同步时如果平台已付款，且 ERP 状态仍是 `unpaid` 或 `unprocessed`，自动转为 `unprocessed`。
- 如果 ERP 状态已经被人工推进到 `ordered_not_uploaded`、`ordered_waiting_tracking` 或 `completed`，后续同步不会覆盖人工状态。
- 平台状态原文保存在 `platform_status`、`status_description`，用于报表排除未付款、取消、关闭、作废订单。

发货时限口径：

- 前端与报表统一按真实下单时间 `platform_created_at || created_at` 加 48 小时计算，不再依赖平台返回的发货承诺字段。
- 未付款、待支付、买家未付款、取消、交易关闭、作废、退款、售后不显示发货时限，也不进入未发货、临近到期或超时统计。
- 已发货、已出库、待收货、交易成功、已完成、已签收只显示已发货/已完成，不显示倒计时。
- ERP 状态 `completed` 视为已处理完成，不显示或统计发货超时。

## 7. 报表接口

### 7.1 总览

```http
GET /api/reports/overview?start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

返回：

```text
order_count, total_sales, total_cost, total_refund, total_expenses, total_profit,
completed_order_count, unprocessed_order_count,
ordered_not_uploaded_count, ordered_waiting_tracking_count, unpaid_order_count
```

未付款、取消、关闭、作废订单不计入销售额、成本和利润。

### 7.2 店铺汇总

```http
GET /api/reports/by-shop?start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

### 7.3 店铺每日数据

```http
GET /api/reports/shop-daily?group_by=shop&start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

`group_by=shop` 返回店铺维度，适合“每个店铺卖了多少单、成交多少单、多少没发货、多少未处理”。

核心字段：

```text
sold_order_count                    卖出单数，不含未付款/取消/关闭/作废
unpaid_order_count                  未付款订单数，不计销售额、成本、利润
completed_order_count               处理完成订单数
ordered_not_uploaded_count          已拍单未上传安抚单
ordered_waiting_tracking_count      已拍单等待同步单号
unshipped_order_count               未发货订单数
unprocessed_order_count             未完成处理订单数，不含未付款
total_sales                         销售额，不含未付款/取消/关闭/作废
last_order_at                       最近订单时间
```

按日期查看：

```http
GET /api/reports/shop-daily?group_by=date&shop_id=1&start_date=2026-06-01&end_date=2026-06-30
```

### 7.4 录入员汇总

```http
GET /api/reports/by-handler?start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

仅管理员可用。

### 7.5 每日趋势

```http
GET /api/reports/daily?start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

## 8. 开支接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/expenses` | 开支列表，支持 `shop_id`、`category`、日期和分页 |
| `POST` | `/api/expenses` | 新增开支 |
| `PUT` | `/api/expenses/{id}` | 修改开支 |
| `DELETE` | `/api/expenses/{id}` | 删除开支 |

新增示例：

```json
{
  "shop_id": 1,
  "category": "shipping",
  "amount": 12.5,
  "description": "运费"
}
```

## 9. 设置与 OCR

### 9.1 系统设置

```http
GET /api/settings
POST /api/settings
Authorization: Bearer {token}
```

允许保存的键前缀：

```text
ocr_*
system_*
collector_*
```

### 9.2 Token 用量

```http
GET /api/settings/token-usage?start_date=2026-06-01&end_date=2026-06-30
Authorization: Bearer {token}
```

### 9.3 OCR 识别

```http
POST /api/ocr/analyze
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "image": "data:image/png;base64,..."
}
```

返回：

```text
order_no, product_name, price, cost, quantity, tracking_no
```

## 10. 中央服务器采集接收接口

这些接口用于本地 EXE 向中央服务器同步数据。

### 10.1 同步店铺

```http
POST /api/collector/ingest/shops
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "shops": [
    {
      "shop_id": "local-collector-shop-id",
      "platform": "taobao",
      "shop_name": "真实店铺名",
      "session_valid": true,
      "security_paused": false,
      "updated_at": "2026-06-01T00:00:00.000Z",
      "last_collect_at": "2026-06-01T00:00:00.000Z"
    }
  ]
}
```

规则：

- `shop_id` 对应 ERP 的 `collector_shop_id`。
- 已在 ERP 删除的 `collector_shop_id` 会被跳过。
- 捕获到真实 `shop_name` 时会覆盖旧的账号名或平台壳名称。

### 10.2 同步订单

```http
POST /api/collector/ingest/orders
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "collector_shop_id": "local-collector-shop-id",
  "platform": "taobao",
  "shop_name": "真实店铺名",
  "full": false,
  "collected_at": "2026-06-01T00:00:00.000Z",
  "orders": [
    {
      "OrderId": "5114049984537618037",
      "Status": "交易成功",
      "StatusDescription": "交易成功",
      "CreatedAt": "2026-06-01 10:00:00",
      "Amount": 99.9,
      "BuyerNick": "买家昵称",
      "ReceiverName": "张三",
      "ReceiverPhone": "165********",
      "ReceiverAddress": "脱敏地址",
      "MainImageUrl": "https://img.alicdn.com/...",
      "ShipDeadlineText": "24小时内发货",
      "Items": [
        {
          "Title": "商品标题",
          "Quantity": 1,
          "MainImageUrl": "https://img.alicdn.com/..."
        }
      ]
    }
  ],
  "collector": {
    "ok": true,
    "mode": "incremental",
    "collect_all_pages": false
  }
}
```

同步规则：

- `order_no + shop_id` 已存在则更新平台字段、金额、图片、发货时限和原始 JSON。
- 采集新订单默认进入 ERP 处理流程：未付款写 `unpaid`，其他可处理订单写 `unprocessed`。
- 已存在订单只会在 `unpaid` 和 `unprocessed` 之间自动流转；人工状态不会被采集同步覆盖。
- `order_sync_ignores` 中存在的订单会跳过。
- `collector.security_paused` 或返回内容包含滑块、验证码、安全验证时，不写订单，改为写诊断问题并暂停该店铺。

### 10.3 上报采集问题

```http
POST /api/collector/ingest/issues
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "level": "warning",
  "source": "collect_orders",
  "title": "店铺出现安全验证，轮询已暂停",
  "message": "平台出现安全验证或滑块，需要人工处理后再恢复采集",
  "collector_shop_id": "local-collector-shop-id",
  "platform": "taobao",
  "details": {
    "current_url": "https://...x5sec..."
  }
}
```

## 11. 管理员采集诊断接口

录入员访问会返回 `403`。

```http
GET /api/collector/issues?resolved=0&page=1&pageSize=20
PATCH /api/collector/issues/{id}/resolve
DELETE /api/collector/issues/{id}
Authorization: Bearer {token}
```

查询参数：

```text
resolved: 0 | 1 | all
level: info | warning | error
collector_shop_id: 本地店铺会话 ID
```

### 11.1 上传本机运行日志

管理员可在“采集诊断”页面点击上传本机日志，也可以直接调用：

```http
GET /api/collector/logs/upload
POST /api/collector/logs/upload
Authorization: Bearer {token}
Content-Type: application/json
```

`GET` 返回本地采集器日志上传配置状态。`POST` 会代理到本机采集器，采集器随后把运行摘要和日志尾部上传到服务器：

```http
POST /api/collector/ingest/logs
Authorization: Bearer {token}
Content-Type: application/json
```

采集器上传内容：

```text
client_id, machine_name, collector_version, memory, active_sessions, shop summaries, logs[]
```

安全边界：

- 只上传 `collector/logs` 和启动器 `logs` 目录下日志文件的尾部。
- 不上传 WebView2 profile、Cookie 数据库、LocalStorage、SessionStorage、raw captures、导出订单文件。
- 上传前会脱敏 `Authorization`、`Bearer`、`Cookie`、`Set-Cookie`、`token`、`password` 等常见敏感值。
- 单次最多 30 个日志文件，单文件尾部最多 48KB，整体上传控制在约 768KB 内。
- 服务器会把上传摘要写入 `collector_issues`，只有管理员可以查看。

## 12. 本地采集控制接口

这些接口只应在本地 EXE 或本地桥接模式使用。中央服务器设置 `ERP_ENABLE_LOCAL_COLLECTOR_CONTROLS=0` 后会返回 `409`。

### 12.1 采集器配置

```http
GET /api/collector/config
POST /api/collector/config
Authorization: Bearer {token}
```

返回会包含：

```text
collector_base_url, default_collector_base_url,
remote_erp_base_url, bridge_mode, collector_control_enabled
```

### 12.2 采集器状态

```http
GET /api/collector/status
Authorization: Bearer {token}
```

本地代理到采集器：

```http
GET http://127.0.0.1:5069/api/collector/status
```

### 12.3 本地店铺列表

```http
GET /api/collector/shops
Authorization: Bearer {token}
```

### 12.4 同步本地店铺到 ERP

```http
POST /api/collector/shops/sync
Authorization: Bearer {token}
```

### 12.5 新增店铺并打开扫码登录

```http
POST /api/collector/shops
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "platform": "taobao"
}
```

`platform` 可选：

```text
taobao
jd
```

### 12.6 唤起店铺页面

```http
POST /api/collector/shops/{collectorShopId}/open
Authorization: Bearer {token}
```

### 12.7 删除本地店铺会话

```http
DELETE /api/collector/shops/{collectorShopId}
Authorization: Bearer {token}
```

会请求采集器：

```http
DELETE /api/shops/{shopId}?purge=true
```

并写入 ERP 删除墓碑，避免旧会话重新同步回来。

### 12.8 登录检查

```http
POST /api/collector/shops/{collectorShopId}/login-check
Authorization: Bearer {token}
```

登录有效规则：

- 当前 URL 不在 `login`、`verify`、`x5sec`、`passport`、`captcha` 等页面。
- 能捕获真实店铺名称。
- 页面处于平台后台有效区域。

### 12.9 采集订单

增量或首次自动全量：

```http
POST /api/collector/shops/{collectorShopId}/collect-orders
Authorization: Bearer {token}
```

强制全量：

```http
POST /api/collector/shops/{collectorShopId}/collect-orders?full=1
Authorization: Bearer {token}
```

规则：

- 本地采集器发现 `captures/{shopId}/exports/orders-latest.json` 不存在时，普通采集会自动执行 `initial_full`。
- 已有最新导出时，普通采集执行 `incremental`。
- `?full=1` 始终执行 `full`，用于人工补采或低频对账。
- 全量采集会翻页到最后一页，耗时较长，不参与高频轮询。

### 12.10 轮询

```http
GET /api/collector/polling
POST /api/collector/polling
POST /api/collector/polling/run-once
POST /api/collector/polling/schedule-test
Authorization: Bearer {token}
```

开启：

```json
{
  "enabled": true,
  "interval_minutes": 30
}
```

可选间隔：

```text
30
60
```

机制：

- 轮询只选择 `collector_status IN ('online', 'synced')` 且启用的店铺。
- 店铺按队列错峰执行，每 10 秒心跳检查一次到期店铺。
- 每家店铺按 `最近采集时间 + 轮询间隔` 判断是否到期。
- 已到期店铺会尽快进入队列，但仍会按短间隔错峰，避免几十家店铺同时请求平台。
- 未到期店铺会在到期时间后加入最多约 5 分钟随机延迟。
- 新增店铺登录成功并同步为 `online` 或 `synced` 后，会自动进入轮询队列。
- `security_paused` 店铺会从队列移除，直到人工处理后重新登录检查。

返回包含：

```text
enabled, running, interval_minutes, eligible_shop_count,
paused_shop_count, unresolved_issue_count, server_time,
next_runs, last_check, last_run, last_error
```

轮询自检：

```json
{
  "force": true
}
```

`force=true` 会走同一套轮询采集代码，立即选择一个可轮询店铺执行一次，用于确认本地轮询链路是否真实可用。自检结果会更新 `last_check` 和 `last_run`，前端会显示“最近检查”和“最近轮询”。

定时实测：

```json
{
  "delay_seconds": 60,
  "collector_shop_id": "可选，不填则选择下次最早轮询的店铺"
}
```

该接口不会立即采集，只会把一个可轮询店铺排到指定秒数之后。之后必须由后台 10 秒心跳自动触发采集。如果到点后 `last_run.reason` 显示 `timer` 且店铺最近采集时间更新，说明定时轮询真实有效。
```

### 12.11 读取最新导出与日志

```http
GET /api/collector/shops/{collectorShopId}/export/latest
GET /api/collector/shops/{collectorShopId}/logs?limit=100
Authorization: Bearer {token}
```

### 12.12 敏感信息辅助查看

```http
POST /api/collector/shops/{collectorShopId}/reveal-sensitive
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "orderId": "3514475006418559",
  "selector": ".optional-selector",
  "clickX": null,
  "clickY": null,
  "waitMs": 8000
}
```

该接口只做按钮级辅助点击。成功标准是出现新的网络响应或导出刷新，不以“按钮点了”作为成功依据。

## 13. 本地采集器裸接口

默认地址：

```text
http://127.0.0.1:5069
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/collector/status` | 采集器状态 |
| `GET` | `/api/shops` | 本地店铺会话列表 |
| `POST` | `/api/shops` | 创建店铺并打开登录页 |
| `POST` | `/api/shops/{shopId}/open` | 打开或唤起店铺页面 |
| `DELETE` | `/api/shops/{shopId}?purge=true` | 删除店铺；`purge=true` 同时清理 profile、captures、日志、cookie 快照 |
| `DELETE` | `/api/collector/data?purge=true` | 清空全部本地店铺资料 |
| `POST` | `/api/shops/{shopId}/login-check` | 登录检查 |
| `POST` | `/api/shops/{shopId}/navigate` | 打开指定页面 |
| `POST` | `/api/shops/{shopId}/collect/probe` | 会话探测 |
| `POST` | `/api/shops/{shopId}/collect/orders` | 普通采集，首次自动全量，之后增量 |
| `POST` | `/api/shops/{shopId}/collect/orders/full` | 强制全量采集 |
| `POST` | `/api/shops/{shopId}/orders/reveal-sensitive` | 敏感信息辅助点击 |
| `GET` | `/api/shops/{shopId}/captures/candidates?task=orders&limit=50` | 候选响应 |
| `GET` | `/api/shops/{shopId}/captures/parsed?task=orders&limit=50` | parser 调试输出 |
| `GET` | `/api/shops/{shopId}/exports/latest?task=orders` | 最新标准订单导出 |
| `POST` | `/api/shops/{shopId}/dom/snapshot` | DOM 截图和候选元素 |
| `POST` | `/api/shops/{shopId}/dom/click` | DOM 点击辅助 |
| `GET` | `/api/shops/{shopId}/captures?limit=50` | 原始响应列表 |
| `GET` | `/api/shops/{shopId}/logs?limit=100` | 店铺采集日志 |
| `GET` | `/api/collector/storage/policy` | 存储清理策略 |
| `POST` | `/api/collector/storage/cleanup` | 全部店铺存储清理 |
| `POST` | `/api/shops/{shopId}/storage/cleanup` | 单店铺存储清理 |
| `POST` | `/api/collector/shutdown` | 关闭采集器 |

## 14. 采集器输出字段

最新导出：

```http
GET /api/shops/{shopId}/exports/latest?task=orders
```

返回核心结构：

```json
{
  "ok": true,
  "shop_id": "91b3b31b-7ef8-4e43-8cb3-de90807d61d9",
  "platform": "taobao",
  "shop_name": "真实店铺名",
  "task": "orders",
  "order_count": 134,
  "orders": [
    {
      "Platform": "taobao",
      "OrderId": "5114049984537618037",
      "Status": "交易成功",
      "StatusDescription": "交易成功",
      "CreatedAt": "2026-05-05 13:59:26",
      "Amount": 0.01,
      "BuyerNick": "旭**",
      "ReceiverName": "张*",
      "ReceiverPhone": "165********",
      "ReceiverAddress": "脱敏地址",
      "ItemCount": 6,
      "MainImageUrl": "https://img.alicdn.com/...",
      "ShipDeadlineText": "24小时内发货",
      "Items": []
    }
  ]
}
```

图片字段优先级：

```text
Order.MainImageUrl
Items[].MainImageUrl
Items[].ImageUrl
```

发货时限字段：

```text
ShipDeadlineText
ShipDeadlineAt
PromiseShipText
PromiseShipAt
```

这些字段只作为采集原始字段保存和排查使用。ERP 页面、订单汇总、报表发货风险按“下单时间 +48 小时”自行计算。

## 15. 客户端自动更新接口

### 15.1 更新清单

```http
GET /api/updates/manifest?channel=stable&platform=win-x64&current=1.0.0
```

该接口不需要登录，用于本地一体化 EXE 启动后检查是否有新版本。

有更新时返回：

```json
{
  "ok": true,
  "update_available": true,
  "version": "1.2.5",
  "download_url": "/updates/ErpCollectorAllInOne-1.2.5.zip",
  "sha256": "发布包 SHA256",
  "notes": "修复隐藏 WebView 长时间占用内存；新增客户端运行日志脱敏上传；管理员可在采集诊断页手动上传本机日志。",
  "required": false,
  "published_at": "2026-06-01T23:26:22.334Z"
}
```

无更新清单时返回：

```json
{
  "ok": true,
  "update_available": false,
  "message": "暂无可用更新"
}
```

客户端流程：

1. 启动后请求 manifest。
2. 发现远端版本大于当前版本时提示用户。
3. 下载 `download_url` 指向的 zip。
4. 校验 `sha256`。
5. 调用 `updater/AixiatianUpdater.exe` 替换文件并重启主程序。

更新器必须保留 `data`、`server-url.txt`、采集器 `profiles/captures/logs/data`、ERP 本地数据库和所有 `.db/.db-wal/.db-shm` 文件。

## 16. 错误码约定

| 状态码 | 说明 |
| --- | --- |
| `400` | 参数错误 |
| `401` | 未登录或 token 失效 |
| `403` | 权限不足 |
| `404` | 资源不存在 |
| `409` | 当前运行模式不允许该操作，例如服务器端禁用采集控制 |
| `410` | 店铺已在 ERP 删除，拒绝采集器重新同步 |
| `503` | 本地采集器未启动或连接失败 |

安全验证返回通常包含：

```json
{
  "ok": false,
  "paused": true,
  "security_paused": true,
  "message": "平台出现安全验证或滑块，需要人工处理后再恢复采集"
}
```

前端应显示红色警告，管理员可在采集诊断里查看，轮询会跳过该店铺。
