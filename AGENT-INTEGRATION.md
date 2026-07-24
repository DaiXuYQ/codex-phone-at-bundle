# Agent 接入手册：手机号注册 / AT 升级 / OA 接入

本文档面向外部智能体或自动化代理。目标是让 Agent 不依赖页面点击，直接通过本地 HTTP API 执行系统已有能力：

- 手机号注册并产出 ChatGPT access token，写入 AT 池。
- 管理 AT 池、检测试用资格、发起 Plus/AT 升级任务。
- 导入 OA 邮箱池，把已有手机号账号接入 SUB2API/OA。
- 查询、取消、删除任务，并读取日志。

> 推荐接入方式：启动本地 Web 服务后，全部通过 `http://127.0.0.1:<port>/api/...` 调用。

---

## 1. 运行入口

### 1.1 项目路径

默认项目根目录：

```text
F:\ai-work\codex-phone-at-bundle
```

核心子目录：

```text
F:\ai-work\codex-phone-at-bundle\codex_register
```

重要文件：

| 文件 | 作用 |
|---|---|
| `start-web.cmd` | Windows 启动本地 Web/API 服务 |
| `codex_register\config.json` | 注册、SMS、SUB2API、邮箱接码配置 |
| `ppxy-env.cmd` | PPXY Plus 升级配置与 AT 池路径 |
| `pool_tokens.txt` | 默认 AT 池，每行一个 access token |
| `.web-data\register-tasks.json` | 注册/OA 任务持久化状态 |
| `.web-data\plus-jobs.json` | Plus 升级任务持久化状态 |
| `.web-data\oa-email-pool.txt` | OA 邮箱池 |
| `.web-data\logs\*.log` | 每个任务的完整日志 |

### 1.2 启动服务

PowerShell：

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle"
.\start-web.cmd
```

服务默认监听：

```text
http://127.0.0.1:8787/
```

如果 `8787` 被占用，服务会自动尝试 `8788`、`8789` 等端口。Agent 应读取启动输出中的：

```text
web server listening: http://127.0.0.1:<port>/
```

并把它作为 `BASE_URL`。

固定端口启动示例：

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle\codex_register"
$env:PORT = "8787"
npm run web
```

### 1.3 健康检查

```powershell
$BASE = "http://127.0.0.1:8787"
Invoke-RestMethod "$BASE/api/health"
```

成功返回中应包含：

- `ok: true`
- `rootDir`
- `appDir`
- `tokenFile`
- `counts.at`
- `counts.oaEmails`
- `counts.registerTasks`
- `counts.plusJobs`
- `config`

---

## 2. Agent 调用约定

### 2.1 请求格式

除 `GET` 外，API 默认使用 JSON：

```http
Content-Type: application/json
Accept: application/json
```

PowerShell 通用调用函数：

```powershell
$BASE = "http://127.0.0.1:8787"

function ApiGet($Path) {
  Invoke-RestMethod -Method GET -Uri "$BASE$Path"
}

function ApiPost($Path, $Body = @{}) {
  Invoke-RestMethod -Method POST -Uri "$BASE$Path" `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 20)
}

function ApiPatch($Path, $Body = @{}) {
  Invoke-RestMethod -Method PATCH -Uri "$BASE$Path" `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 20)
}

function ApiDelete($Path) {
  Invoke-RestMethod -Method DELETE -Uri "$BASE$Path"
}
```

### 2.2 状态枚举

注册任务和 OA 任务：

| 状态 | 含义 |
|---|---|
| `queued` | 已入队，等待执行 |
| `running` | 正在执行 |
| `success` | 成功 |
| `failed` | 失败 |
| `canceled` | 已取消 |

Plus 升级任务常见状态：

| 状态 | 含义 |
|---|---|
| `queued` / `running` | 已提交或执行中 |
| `otp_pending` | 等待 OTP，需调用 OTP 接口提交 |
| `success` | 升级成功 |
| `failed` | 升级失败 |

Agent 判定规则：

1. 只有接口返回的 `status=success` 才算成功。
2. `failed` 时读取 `logs` 或 job `latest/errorMessage` 再决策。
3. `queued/running/otp_pending` 需要轮询。
4. 不要用页面文字作为最终状态来源。

---

## 3. 功能总览

| 功能 | 主要接口 | 结果 |
|---|---|---|
| 配置检查 | `GET /api/health`, `GET /api/config` | 获取当前 SMS、PPXY、SUB2API、邮箱配置摘要 |
| SMS 价格查询 | `GET /api/sms/prices?...` | 查询当前国家/服务可用价格 |
| SMS 配置更新 | `PATCH /api/config/sms` | 修改接码平台、国家、价格阶梯 |
| 手机号注册 | `POST /api/register/tasks` | 创建注册任务，成功后 AT 写入 token 池 |
| 注册任务查询 | `GET /api/register/tasks`, `GET /api/tasks/{id}` | 查看任务状态和日志 |
| AT 池管理 | `GET /api/ats`, `POST /api/ats/import`, `DELETE /api/ats/{hash}` | 查看、导入、删除 AT |
| 试用检测 | `POST /api/ats/{hash}/check-trial` | 检测指定 AT 是否可试用 |
| Plus 升级 | `POST /api/plus/jobs` | 用 AT 创建 PPXY Plus 升级任务 |
| Plus 任务查询 | `GET /api/plus/jobs`, `GET /api/plus/jobs/{id}` | 查看升级进度 |
| 提交 OTP | `POST /api/plus/jobs/{id}/otp` | 给升级任务提交验证码 |
| SUB2API 配置 | `PATCH /api/config/sub2api` | 设置 OA 接入目标 |
| OA 邮箱池导入 | `POST /api/oa/emails/import` | 导入邮箱/接码 URL |
| OA 接入 | `POST /api/oa/tasks` | 用 AT 手机号 + 邮箱执行 OAuth 接入 |

---

## 4. 配置与预检

### 4.1 读取系统配置

```powershell
ApiGet "/api/config"
```

重点字段：

```jsonc
{
  "register": {
    "defaultPassword": "configured",
    "defaultProxyUrl": "...",
    "sms": {
      "provider": "smsbower",
      "active": {
        "provider": "smsbower",
        "apiKeyPresent": true,
        "service": "dr",
        "countries": [33],
        "priceTiers": [0.016, 0.017]
      }
    }
  },
  "ppxy": {
    "baseUrl": "https://...",
    "apiKeyPresent": true,
    "proxyJp": "...",
    "tokenFile": "F:\\...\\pool_tokens.txt"
  },
  "sub2api": {
    "url": "https://...",
    "email": "admin@example.com",
    "passwordPresent": true,
    "groupName": "new-plus"
  },
  "mailApi": {
    "baseUrl": "http://..."
  }
}
```

Agent 预检：

- 手机号注册前：`register.sms.active.apiKeyPresent` 必须为 `true`。
- Plus 升级前：`ppxy.apiKeyPresent` 必须为 `true`，并且 AT 池不为空。
- OA 接入前：`sub2api.url/email/passwordPresent/groupName` 有效，邮箱池有可用邮箱，AT 池里有可解析手机号的 token。

### 4.2 查询 SMS 平台价格

```powershell
ApiGet "/api/sms/prices?provider=smsbower&country=33&service=dr"
```

返回示例：

```jsonc
{
  "provider": "smsbower",
  "country": 33,
  "service": "dr",
  "items": [
    {"price": 0.016, "count": 12, "providerIds": []},
    {"price": 0.017, "count": 30, "providerIds": []}
  ]
}
```

### 4.3 更新 SMS 配置

```powershell
ApiPatch "/api/config/sms" @{
  provider = "smsbower"
  service = "dr"
  countries = "33"
  priceTiers = "0.016,0.017"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `provider` / `smsProvider` | 是 | `hero-sms` 或 `smsbower` |
| `service` | 是 | OpenAI 通常为 `dr` |
| `countries` | 是 | 国家代码，支持逗号分隔 |
| `priceTiers` | 是 | 价格阶梯，支持逗号分隔 |

---

## 5. 手机号注册流程

### 5.1 功能说明

调用现有 `src/index.ts --phone --at --st` 流程：

1. 从当前 SMS provider 取号。
2. 用手机号注册账号并等待短信 OTP。
3. 建立 ChatGPT Web session。
4. 获取 `accessToken`。
5. 追加写入 AT 池，默认是 `pool_tokens.txt`。
6. 写入任务日志和任务状态。

### 5.2 创建注册任务

```powershell
$result = ApiPost "/api/register/tasks" @{
  count = 1
  concurrency = 1
}
$taskId = $result.tasks[0].id
```

完整参数：

| 字段 | 默认 | 说明 |
|---|---|---|
| `count` | `1` | 创建多少个注册任务，范围 1-100 |
| `concurrency` | `1` | 注册并发，范围 1-20 |
| `tokenOut` | PPXY `TOKEN_FILE` | 成功 AT 写入路径 |
| `sentinelBrowserProxy` | 环境变量 | 可选，Sentinel 浏览器代理 |
| `sentinelBrowserPath` | 环境变量 | 可选，Chrome/浏览器路径 |

示例：一次注册 5 个，2 并发：

```powershell
ApiPost "/api/register/tasks" @{
  count = 5
  concurrency = 2
}
```

### 5.3 查询注册任务列表

```powershell
ApiGet "/api/register/tasks"
```

返回关键字段：

```jsonc
{
  "tasks": [
    {
      "id": "reg_...",
      "kind": "register",
      "status": "running",
      "title": "+573235806707_smsbower_...",
      "phone": "+573235806707",
      "accessTokenHash": "...",
      "accessTokenPreview": "eyJ...",
      "logs": []
    }
  ],
  "running": 1,
  "queued": 0,
  "concurrency": 1
}
```

### 5.4 查询单个任务和日志

```powershell
ApiGet "/api/tasks/$taskId"
```

### 5.5 取消任务

```powershell
ApiPost "/api/tasks/$taskId/cancel" @{}
```

如果已经取号，系统会尝试调用 SMS 平台取消 activation。

### 5.6 删除任务记录

```powershell
ApiDelete "/api/tasks/$taskId"
```

运行中的任务不能直接删除，需要先取消。

---

## 6. AT 池管理

### 6.1 查看 AT 池

```powershell
ApiGet "/api/ats"
```

返回字段：

```jsonc
{
  "tokenFile": "F:\\...\\pool_tokens.txt",
  "items": [
    {
      "index": 0,
      "hash": "sha256...",
      "preview": "eyJ...",
      "email": "",
      "phone": "+573235806707",
      "userId": "...",
      "plan": "",
      "expiresAt": "2026-...",
      "expired": false,
      "trial": {}
    }
  ]
}
```

`hash` 是后续 Plus 升级和删除 AT 的稳定引用。

### 6.2 导入 AT

```powershell
ApiPost "/api/ats/import" @{
  text = @"
eyJ...token1...
eyJ...token2...
"@
}
```

系统会提取 `eyJ...` JWT，并按 hash 去重。

### 6.3 删除 AT

```powershell
ApiDelete "/api/ats/<hash>"
```

### 6.4 检测 AT 试用资格

按 hash 检测：

```powershell
ApiPost "/api/ats/<hash>/check-trial" @{}
```

指定 JP 代理检测：

```powershell
ApiPost "/api/ats/<hash>/check-trial" @{
  proxyJp = "http://user:pass@host:port"
}
```

直接检测一个未入池 token：

```powershell
ApiPost "/api/ats/check-trial" @{
  token = "eyJ..."
  proxyJp = "http://user:pass@host:port"
}
```

结果会写回 `items[].trial`：

```jsonc
{
  "trial": {
    "checkedAt": "2026-06-13T...",
    "ok": true,
    "eligible": true,
    "result_code": "",
    "message": "",
    "amount_cents": 0,
    "currency": "usd"
  }
}
```

---

## 7. AT / Plus 升级流程

### 7.1 功能说明

Plus 升级通过 PPXY API 执行：

1. 从 AT 池选择一个或多个 token。
2. 可选先检测试用资格。
3. 创建 PPXY job。
4. 轮询 job 状态。
5. 如状态为 `otp_pending`，提交 OTP。
6. 成功后可选择从 AT 池删除该 token。

### 7.2 查看 PPXY 账号额度

```powershell
ApiGet "/api/plus/account"
```

### 7.3 创建 Plus 升级任务

使用 AT hash：

```powershell
ApiPost "/api/plus/jobs" @{
  tokenHash = "<at_hash>"
  paypalPhone = "08012345678"
  removeTokenOnSuccess = $false
}
```

直接传 token：

```powershell
ApiPost "/api/plus/jobs" @{
  token = "eyJ..."
  paypalPhone = "08012345678"
}
```

完整参数：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `tokenHash` | 二选一 | AT 池中的 token hash |
| `token` | 二选一 | 直接传 access token |
| `paypalPhone` / `phone` | 是 | PPXY/PayPal 手机号 |
| `clientRef` | 否 | 幂等订单号，不传则自动生成 |
| `proxyJp` | 否 | JP 代理，不传则使用 `PPXY_PROXY_JP` |
| `smsApi` | 否 | 下游需要时传 |
| `otp` | 否 | 创建时已有 OTP 可传 |
| `callbackUrl` | 否 | 下游回调地址 |
| `proxy` | 否 | 普通代理 |
| `email` | 否 | 下游需要时传 |
| `pplinkRetry` | 否 | PPLink 重试次数，默认 3 |
| `otpTimeout` | 否 | OTP 等待秒数 |
| `removeTokenOnSuccess` | 否 | 成功后删除源 AT |

返回：

```jsonc
{
  "job": {
    "localId": "plus_...",
    "jobId": "...",
    "status": "queued",
    "clientRef": "web-plus-...",
    "tokenHash": "...",
    "paypalPhone": "08012345678",
    "otpPending": false,
    "done": false
  }
}
```

### 7.4 查询 Plus 任务

全部任务：

```powershell
ApiGet "/api/plus/jobs"
```

单个任务，`id` 可以是 `localId` 或 `jobId`：

```powershell
ApiGet "/api/plus/jobs/<id>"
```

强制刷新：

```powershell
ApiPost "/api/plus/jobs/<id>/refresh" @{}
```

### 7.5 提交 OTP

当 job `otpPending=true` 或 `status=otp_pending`：

```powershell
ApiPost "/api/plus/jobs/<id>/otp" @{
  pin = "123456"
}
```

也支持：

```json
{"otp": "123456"}
```

### 7.6 删除 Plus 任务记录

```powershell
ApiDelete "/api/plus/jobs/<id>"
```

---

## 8. OA / SUB2API 接入流程

### 8.1 功能说明

OA 接入使用 `src/oa-sub2api.ts`：

1. 读取 AT 池，解析每个 AT 对应的手机号。
2. 读取 OA 邮箱池，选择可用邮箱和接码 URL。
3. 向 SUB2API 获取 OpenAI OAuth URL。
4. 用手机号账号登录 OpenAI，并绑定邮箱。
5. 从邮箱接码 URL 或 Hotmail refresh token 获取邮箱 OTP。
6. 完成 OAuth callback exchange。
7. 在 SUB2API 创建账号。
8. 成功后记录邮箱状态，可选删除源 AT。

### 8.2 配置 SUB2API

```powershell
ApiPatch "/api/config/sub2api" @{
  url = "https://YOUR_SUB2API_URL"
  email = "admin@example.com"
  password = "YOUR_PASSWORD"
  groupNames = "new-plus"
  proxyName = ""
  accountPriority = 1
  concurrency = 10
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---:|---|
| `url` | 是 | SUB2API 地址 |
| `email` | 是 | SUB2API 登录账号 |
| `password` | 首次必填 | 留空表示不修改已有密码 |
| `groupNames` / `groupName` | 是 | 导入分组，逗号分隔 |
| `proxyName` | 否 | SUB2API 中的代理名 |
| `accountPriority` | 否 | 创建账号优先级 |
| `concurrency` | 否 | SUB2API 侧并发参数 |

### 8.3 配置邮箱接码 API 域名

当导入四段邮箱格式：

```text
email----password----clientId----refreshToken
```

系统需要 `mailApiBaseUrl` 拼出接码 URL。

```powershell
ApiPatch "/api/config/mail-api" @{
  baseUrl = "http://YOUR_MAIL_API_HOST"
}
```

也可在导入邮箱时同时传：

```json
{"mailApiBaseUrl": "http://YOUR_MAIL_API_HOST"}
```

### 8.4 导入 OA 邮箱池

支持两种格式。

格式 A：邮箱 + 接码 URL：

```text
user1@example.com-----http://mail-api.example/api/GetLastEmails?email=user1@example.com&clientId=...&refreshToken=...&num=2&boxType=1
user2@example.com-----http://mail-api.example/api/GetLastEmails?email=user2@example.com&clientId=...&refreshToken=...&num=2&boxType=1
```

格式 B：四段邮箱：

```text
user1@example.com----password----clientId----refreshToken
user2@example.com----password----clientId----refreshToken
```

导入文本：

```powershell
ApiPost "/api/oa/emails/import" @{
  mailApiBaseUrl = "http://YOUR_MAIL_API_HOST"
  text = @"
user1@example.com----password----clientId----refreshToken
user2@example.com----password----clientId----refreshToken
"@
}
```

从文件导入：

```powershell
ApiPost "/api/oa/emails/import" @{
  filePath = "F:\path\to\emails.txt"
  mailApiBaseUrl = "http://YOUR_MAIL_API_HOST"
}
```

返回：

```jsonc
{
  "added": 2,
  "updated": 0,
  "skipped": 0,
  "total": 2,
  "invalid": 0,
  "needsMailApiBaseUrl": false
}
```

### 8.5 查看 OA 邮箱池

```powershell
ApiGet "/api/oa/emails"
```

关键字段：

```jsonc
{
  "file": "F:\\...\\.web-data\\oa-email-pool.txt",
  "count": 2,
  "items": [
    {
      "email": "user1@example.com",
      "mailboxUrl": "http://...",
      "available": true,
      "bindStatus": "free",
      "bindPhone": "",
      "bindTaskId": ""
    }
  ]
}
```

`available=true` 才会被 OA 任务自动选用。

### 8.6 修复邮箱池接码域名

当邮箱池中已有四段邮箱或旧域名，需要重新生成接码 URL：

```powershell
ApiPost "/api/oa/emails/rebase" @{
  mailApiBaseUrl = "http://YOUR_MAIL_API_HOST"
}
```

### 8.7 手动修改邮箱状态

```powershell
ApiPatch "/api/oa/emails/user1%40example.com" @{
  status = "free"
  phone = ""
  note = "manual reset"
}
```

状态可选：

```text
free | reserved | bound | failed | canceled | disabled
```

### 8.8 创建 OA 接入任务

使用 AT 池前 N 个可解析手机号的 token，并匹配可用邮箱：

```powershell
ApiPost "/api/oa/tasks" @{
  count = 1
  concurrency = 1
  removeTokenOnSuccess = $false
}
```

只处理指定 AT：

```powershell
ApiPost "/api/oa/tasks" @{
  count = 2
  concurrency = 1
  tokenHashes = @("<hash1>", "<hash2>")
  removeTokenOnSuccess = $true
}
```

完整参数：

| 字段 | 默认 | 说明 |
|---|---|---|
| `count` | `100` | 最多创建多少个 OA 任务 |
| `concurrency` | `1` | OA 任务并发，范围 1-20 |
| `tokenHashes` | 空 | 指定 AT hash 列表，不传则从 AT 池顺序选择 |
| `password` | `config.defaultPassword` | 手机号账号密码 |
| `tokenOut` | PPXY `TOKEN_FILE` | 成功后 SUB2API credentials 中的 access token 追加路径 |
| `removeTokenOnSuccess` | `false` | 成功后删除源 AT |

### 8.9 查询 OA 任务

```powershell
ApiGet "/api/oa/tasks"
```

单任务日志：

```powershell
ApiGet "/api/tasks/<oa_task_id>"
```

取消：

```powershell
ApiPost "/api/tasks/<oa_task_id>/cancel" @{}
```

删除：

```powershell
ApiDelete "/api/tasks/<oa_task_id>"
```

---

## 9. Agent 端到端操作模板

### 9.1 模板 A：注册手机号并得到 AT

```powershell
$BASE = "http://127.0.0.1:8787"

$health = ApiGet "/api/health"
if (-not $health.ok) { throw "service not healthy" }
if (-not $health.config.register.sms.active.apiKeyPresent) { throw "SMS API key missing" }

$created = ApiPost "/api/register/tasks" @{
  count = 1
  concurrency = 1
}
$taskId = $created.tasks[0].id

do {
  Start-Sleep -Seconds 3
  $task = (ApiGet "/api/tasks/$taskId").task
  $task.status
} while ($task.status -in @("queued", "running"))

if ($task.status -ne "success") {
  $task.logs | Select-Object -Last 30
  throw "register failed: $($task.error)"
}

ApiGet "/api/ats"
```

### 9.2 模板 B：选择 AT 并升级 Plus

```powershell
$ats = (ApiGet "/api/ats").items | Where-Object { -not $_.expired }
if (-not $ats) { throw "AT pool empty" }

$hash = $ats[0].hash
ApiPost "/api/ats/$hash/check-trial" @{}

$job = (ApiPost "/api/plus/jobs" @{
  tokenHash = $hash
  paypalPhone = "08012345678"
  removeTokenOnSuccess = $false
}).job

do {
  Start-Sleep -Seconds 5
  $job = (ApiGet "/api/plus/jobs/$($job.localId)").job
  $job.status

  if ($job.otpPending) {
    # 由上游获取 OTP 后提交
    # ApiPost "/api/plus/jobs/$($job.localId)/otp" @{ pin = "123456" }
  }
} while (-not $job.done)

if ($job.status -ne "success") {
  $job | ConvertTo-Json -Depth 20
  throw "plus job failed"
}
```

### 9.3 模板 C：OA 接入

```powershell
$config = ApiGet "/api/config"
if (-not $config.sub2api.passwordPresent) { throw "SUB2API password missing" }

ApiPost "/api/oa/emails/import" @{
  mailApiBaseUrl = "http://YOUR_MAIL_API_HOST"
  text = @"
user1@example.com----password----clientId----refreshToken
"@
}

$emails = (ApiGet "/api/oa/emails").items | Where-Object { $_.available }
if (-not $emails) { throw "no available OA email" }

$ats = (ApiGet "/api/ats").items | Where-Object { $_.phone }
if (-not $ats) { throw "no AT with phone_number" }

$created = ApiPost "/api/oa/tasks" @{
  count = 1
  concurrency = 1
  removeTokenOnSuccess = $false
}
$taskId = $created.tasks[0].id

do {
  Start-Sleep -Seconds 3
  $task = (ApiGet "/api/tasks/$taskId").task
  $task.status
} while ($task.status -in @("queued", "running"))

if ($task.status -ne "success") {
  $task.logs | Select-Object -Last 50
  throw "OA task failed: $($task.error)"
}

$task.sub2apiAccount
```

---

## 10. CLI 兜底方式

API 是首选。只有在 Web 服务不可用时，才直接调用 CLI。

### 10.1 手机号注册

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle\codex_register"
node .\node_modules\tsx\dist\cli.mjs src/index.ts --phone --at --st --gp-token-out "F:\ai-work\codex-phone-at-bundle\pool_tokens.txt"
```

### 10.2 Plus 升级脚本

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle"
.\ppxy-create-job.cmd 08012345678
.\ppxy-query-job.cmd <JOB_ID>
.\ppxy-submit-otp.cmd <JOB_ID> 123456
```

### 10.3 OA 接入

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle\codex_register"
node .\node_modules\tsx\dist\cli.mjs src/oa-sub2api.ts `
  --phone +573235806707 `
  --bind-email user@example.com `
  --mailbox-url "http://YOUR_MAIL_API_HOST/api/GetLastEmails?email=..." `
  --token-out "F:\ai-work\codex-phone-at-bundle\pool_tokens.txt"
```

---

## 11. 常见错误处理

| 现象 | Agent 处理方式 |
|---|---|
| `/api/health` 不通 | 启动 `start-web.cmd`，读取实际端口 |
| `SMS API Key 未配置` | 检查 `config.json` 或让用户补充对应 provider key |
| 注册任务一直失败 | 读取任务 `logs` 最后 50 行，关注取号、OTP、代理、浏览器路径 |
| AT 池为空 | 先跑 `/api/register/tasks` 或 `/api/ats/import` |
| AT 没有 `phone` | 该 token 不能用于 OA 自动匹配手机号，换 token |
| PPXY API key missing | 检查 `ppxy-env.cmd` 或进程环境变量 |
| Plus `otp_pending` | 等待上游 OTP 后调用 `/api/plus/jobs/{id}/otp` |
| OA 没有可用邮箱 | 先 `/api/oa/emails/import`，并确保 `available=true` |
| OA 邮箱是四段格式但不可用 | 设置 `mailApiBaseUrl` 后调用 `/api/oa/emails/rebase` |
| OA `email_already_in_use` | 系统会标记/消费邮箱；Agent 应换邮箱重试 |
| 任务卡住 | 先 `GET /api/tasks/{id}` 看日志，再按需 cancel |

---

## 12. Agent 执行原则

1. 优先使用 API，不模拟页面点击。
2. 每个动作后读取状态接口确认结果。
3. 失败时保留任务日志，不要直接删除失败任务。
4. 只在用户明确要求清理时删除任务记录或 token。
5. 不在对话、日志或文档中输出完整密钥、完整代理密码、完整 access token。
6. 需要并发时从小并发开始：注册建议 `1-2`，OA 建议 `1-3`，Plus 根据 PPXY 额度决定。
7. 成功判定以 API 状态为准，不以命令退出前的单条日志为准。
