# PPXY API 使用说明

接口域名：

`https://plus.iceaix.com`

API 模式走新版开通核心，不需要 CDK，不受前台访问 token 开关影响。客户只需要使用分配到的 `API Key` 调用 `/api/v1/...`。

## 鉴权

所有客户接口都必须带 API Key：

API Key 由管理员在后台创建客户或补发 Key 时生成，格式类似 `api_xxx`。它和前台访问 token、CDK 都不是同一种东西，不能混用。

```http
Authorization: Bearer 你的API_KEY
Content-Type: application/json
```

也兼容：

```http
X-API-Key: 你的API_KEY
Content-Type: application/json
```

## 1. 查询账户

`GET /api/v1/account`

```bash
curl https://plus.iceaix.com/api/v1/account \
  -H "Authorization: Bearer 你的API_KEY"
```

返回示例：

```json
{
  "client_id": "cli_xxx",
  "name": "client-a",
  "status": "active",
  "quota_total": 100,
  "quota_used": 20,
  "quota_reserved": 1,
  "quota_remaining": 79,
  "concurrency_limit": 2,
  "job_cost_units": 1,
  "created_at": "2026-06-12T09:00:00Z",
  "updated_at": "2026-06-12T09:00:00Z"
}
```

额度规则：

- 创建任务时先预占 `job_cost_units` 个额度，当前默认是 `1`
- 任务成功后正式扣除额度，`billing_status=charged`
- 任务失败后释放预占额度，`billing_status=released`
- 超过并发限制会返回 `429`
- 额度不足会返回 `402`

## 2. 试用检测

`POST /api/v1/trial/check`

这个接口只检测 ChatGPT token 的试用资格，需要 API Key，但不预占额度、不扣费。

```bash
curl -X POST https://plus.iceaix.com/api/v1/trial/check \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "你的 ChatGPT token"
  }'
```

可选自定义 JP 代理：

```json
{
  "token": "你的 ChatGPT token",
  "proxy_jp": "http://user:pass@host:port"
}
```

返回示例：

```json
{
  "ok": true,
  "amount_cents": 0,
  "currency": "JPY",
  "eligible": true,
  "blocked": false,
  "status": "eligible",
  "result_code": "ELIGIBLE",
  "message": "该号有试用资格",
  "resource_mode": "builtin_trial_jp",
  "uses_quota": false
}
```

没有试用资格时仍返回 `ok: true`，但 `eligible` 为 `false`：

```json
{
  "ok": true,
  "amount_cents": 1999,
  "currency": "JPY",
  "eligible": false,
  "blocked": false,
  "status": "no_trial",
  "result_code": "NO_TRIAL",
  "message": "该号没有试用资格",
  "resource_mode": "builtin_trial_jp",
  "uses_quota": false
}
```

`resource_mode`：

- `builtin_trial_jp`：使用服务端默认 JP 代理
- `custom_trial_jp`：使用你传入的 `proxy_jp`

## 3. 创建开通任务

`POST /api/v1/jobs`

API 模式不使用 CDK。`phone` 必填；`sms_api` 可选，不传时任务会等待你通过 API 手动提交 PayPal OTP。服务端不再提供内置接码池。

自动接码调用：

```bash
curl -X POST https://plus.iceaix.com/api/v1/jobs \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001" \
  -d '{
    "input": "你的 ChatGPT token / PayPal 链接 / BA-xxx",
    "client_ref": "order-1001",
    "phone": "08012345678",
    "sms_api": "https://sms.example.com/getcode?order_no=xxx"
  }'
```

手动 OTP 调用：

```bash
curl -X POST https://plus.iceaix.com/api/v1/jobs \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1002" \
  -d '{
    "input": "你的 ChatGPT token / PayPal 链接 / BA-xxx",
    "client_ref": "order-1002",
    "phone": "08012345678"
  }'
```

如果验证码已经在手上，也可以创建任务时直接传：

```json
{
  "input": "你的 ChatGPT token / PayPal 链接 / BA-xxx",
  "client_ref": "order-1003",
  "phone": "08012345678",
  "otp": "123456"
}
```

返回示例：

```json
{
  "job_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "client_ref": "order-1001",
  "cost_units": 1,
  "resource_mode": "builtin_custom",
  "sms_slot_id": ""
}
```

### 请求参数

| 字段 | 必填 | 说明 |
|------|------|------|
| `input` | 是 | ChatGPT access token、`pm-redirects` URL、PayPal URL 或 `BA-xxx` |
| `phone` | 是 | PayPal 注册/验证手机号 |
| `sms_api` | 否 | 接码 API URL；传入后 PPXY 会直接 GET 这个 URL 轮询验证码 |
| `otp` | 否 | 已知 PayPal OTP，可创建任务时直接传；也可以等 `otp_pending` 后再提交 |
| `client_ref` | 否 | 你的订单号或备注，原样返回 |
| `callback_url` | 否 | 任务结束后回调的公网 HTTP/HTTPS 地址 |
| `proxy` | 否 | 自定义 US 代理，不传则走服务端默认 US 代理 |
| `proxy_jp` | 否 | 自定义 JP 代理，不传则走服务端默认 JP 代理 |
| `email` | 否 | 指定注册邮箱；不传则随机生成 |
| `cookies` | 否 | 特殊场景下传入的 PayPal cookie |
| `pplink_retry` | 否 | pplink 重试次数，默认 `3` |
| `otp_timeout` | 否 | 等待短信验证码超时秒数，默认 `30` |

取码方式：

- 传 `sms_api`：自动轮询接码 API。
- 不传 `sms_api`：任务到 PayPal 短信验证阶段会进入 `otp_pending`，最长等待约 10 分钟。
- 传 `otp`：直接使用该验证码，不再轮询 `sms_api`。

### 接码 API 返回格式

PPXY 会对 `sms_api` 发起 HTTP GET，请返回 JSON。当前解析规则：

- 短信列表路径：`data.sms_content`
- 每条短信需要有 `recv_time` 和 `content`
- `recv_time` 格式建议为 `YYYY-MM-DD HH:MM:SS`
- PPXY 会先取一次 baseline，然后只接受 baseline 之后的新短信
- `content` 里需要包含 `paypal` 关键字，并且能匹配到 6 位数字验证码

示例：

```json
{
  "data": {
    "sms_content": [
      {
        "recv_time": "2026-06-12 17:30:01",
        "content": "PayPal: your code is 123456"
      }
    ]
  }
}
```

### 资源模式

任务接口的 `resource_mode` 由代理来源和接码来源组成：

- `builtin_custom`：使用服务端默认代理 + 你传入的接码 API
- `custom_custom`：使用你传入的代理 + 你传入的接码 API
- `builtin_manual_otp`：使用服务端默认代理 + 手动提交 OTP
- `custom_manual_otp`：使用你传入的代理 + 手动提交 OTP

内置接码池已停用；自动接码时 API 客户必须自行传入 `sms_api`。

### 幂等提交

建议每个订单都带唯一的 `Idempotency-Key`：

```http
Idempotency-Key: 你的唯一订单ID
```

同一个客户使用同一个 `Idempotency-Key` 重复提交时，会返回原任务，不会重复创建。

## 4. 查询任务

`GET /api/v1/jobs/{job_id}`

```bash
curl https://plus.iceaix.com/api/v1/jobs/你的job_id \
  -H "Authorization: Bearer 你的API_KEY"
```

返回示例：

```json
{
  "job_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "success",
  "product": "plus_sale",
  "resource_mode": "builtin_custom",
  "result_code": "SUCCESS",
  "error_message": "",
  "client_ref": "order-1001",
  "callback_status": "delivered",
  "callback_attempts": 1,
  "billing_status": "charged",
  "cost_units": 1,
  "created_at": "2026-06-12T09:00:00Z",
  "updated_at": "2026-06-12T09:01:00Z",
  "finished_at": "2026-06-12T09:01:00Z",
  "done": true,
  "otp_pending": false,
  "result": {
    "success": true,
    "return_url": "https://..."
  }
}
```

### `status`

- `queued`：已创建，等待执行
- `running`：执行中
- `otp_pending`：等待短信验证码
- `success`：任务成功
- `failed`：任务失败

### `result_code`

常见值：

- `SUCCESS`
- `FAILED`
- `BLOCKED`
- `ALREADY_PAID`
- `NO_TRIAL`
- `INVALID_INPUT`
- `TIMEOUT`
- `INTERNAL_ERROR`

### `billing_status`

- `reserved`：已预占额度
- `charged`：成功后已扣额度
- `released`：失败后已释放额度

## 5. 提交手动 OTP

`POST /api/v1/jobs/{job_id}/otp`

当创建任务时未传 `sms_api`，查询任务返回 `status: "otp_pending"` 或 `otp_pending: true` 后，提交 PayPal 短信验证码：

```bash
curl -X POST https://plus.iceaix.com/api/v1/jobs/你的job_id/otp \
  -H "Authorization: Bearer 你的API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pin":"123456"}'
```

也兼容字段名 `otp`：

```json
{
  "otp": "123456"
}
```

返回：

```json
{
  "ok": true,
  "job_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "running"
}
```

注意：只能提交当前 API Key 所属客户自己的任务；任务完成、停止或已提交过 OTP 时会返回 `409`。

## 6. 回调

创建任务时传 `callback_url` 后，任务结束会 POST 一次结果到你的地址。

`callback_url` 要求：

- 必须是公网 `http://` 或 `https://`
- 不能是 localhost、内网地址、保留地址
- 不支持 URL 里带账号密码
- 域名必须能解析到公网 IP

固定回调请求头：

```http
Content-Type: application/json
```

如果你的客户配置了 `webhook_secret`，回调会额外带签名头：

```http
X-Signature-SHA256: <hex hmac>
```

签名用原始请求 body 做校验：

```text
HMAC_SHA256(raw_body, webhook_secret)
```

回调 body 示例：

```json
{
  "job_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "client_id": "cli_xxx",
  "status": "success",
  "result_code": "SUCCESS",
  "client_ref": "order-1001",
  "error_message": "",
  "created_at": "2026-06-12T09:00:00Z",
  "finished_at": "2026-06-12T09:01:00Z",
  "result": {
    "success": true,
    "return_url": "https://..."
  }
}
```

系统会重试回调。查询任务时可通过 `callback_status` 和 `callback_attempts` 查看投递情况。

## 6. 常见错误

| HTTP | 含义 |
|------|------|
| `400` | 参数错误，例如缺少 `input`、`phone`、`sms_api` |
| `401` | API Key 无效或缺失 |
| `402` | 额度不足 |
| `403` | 客户被禁用，或 callback URL 不允许 |
| `429` | 并发任务达到上限 |
| `503` | 服务维护中，或默认代理未配置 |

错误返回示例：

```json
{
  "detail": "额度不足"
}
```

## 7. 注意事项

- API Key 请妥善保管，不要放到前端页面或公开仓库
- API 模式不需要 CDK
- API 模式必须传 `phone + sms_api`
- API 模式没有手动 OTP 入口，验证码必须通过 `sms_api` 自动获取
- 内置接码池已停用，服务端不会自动分配号码或接码 API
- 不传代理时会使用服务端默认 US/JP 代理
- 自定义代理时，`proxy` 是 US 代理，`proxy_jp` 是 JP 代理
- 任务成功才扣额度，失败不扣
- 建议每个订单都传 `Idempotency-Key`
