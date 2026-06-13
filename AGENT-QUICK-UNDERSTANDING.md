# Agent 快速阅读理解

这是一份给智能体看的快速接入说明。完整接口和字段见 `AGENT-INTEGRATION.md`。

---

## 1. 一句话理解系统

这是一个本地自动化控制台。Agent 启动 Web/API 服务后，通过本地 HTTP API 完成三条主链路：

```text
手机号注册 -> 产出 AT -> 写入 pool_tokens.txt
AT 池 -> PPXY Plus 升级 -> 查询/提交 OTP
AT 池 + OA 邮箱池 -> SUB2API/OA 接入 -> 创建中转站账号
```

不要点页面，直接调用 API。

---

## 2. 第一步永远做什么

启动或确认服务：

```powershell
Set-Location "F:\ai-work\codex-phone-at-bundle"
.\start-web.cmd
```

拿到实际地址，例如：

```text
http://127.0.0.1:8787
```

然后：

```powershell
$BASE = "http://127.0.0.1:8787"
Invoke-RestMethod "$BASE/api/health"
```

健康检查重点看：

- `ok=true`
- `counts.at`
- `counts.oaEmails`
- `config.register.sms.active.apiKeyPresent`
- `config.ppxy.apiKeyPresent`
- `config.sub2api.passwordPresent`

---

## 3. 最常用 API 速查

| 目的 | API |
|---|---|
| 健康检查 | `GET /api/health` |
| 配置摘要 | `GET /api/config` |
| 手机号注册 | `POST /api/register/tasks` |
| 查注册任务 | `GET /api/register/tasks` |
| 查任意任务日志 | `GET /api/tasks/{id}` |
| 取消任务 | `POST /api/tasks/{id}/cancel` |
| AT 池 | `GET /api/ats` |
| 导入 AT | `POST /api/ats/import` |
| 检测试用 | `POST /api/ats/{hash}/check-trial` |
| 创建 Plus 升级 | `POST /api/plus/jobs` |
| 查 Plus 任务 | `GET /api/plus/jobs/{id}` |
| 提交 Plus OTP | `POST /api/plus/jobs/{id}/otp` |
| 配置 SUB2API | `PATCH /api/config/sub2api` |
| 导入 OA 邮箱 | `POST /api/oa/emails/import` |
| 查看 OA 邮箱 | `GET /api/oa/emails` |
| 创建 OA 接入任务 | `POST /api/oa/tasks` |
| 查 OA 任务 | `GET /api/oa/tasks` |

---

## 4. 三个标准工作流

### 4.1 手机号注册

请求：

```json
POST /api/register/tasks
{
  "count": 1,
  "concurrency": 1
}
```

然后轮询：

```text
GET /api/tasks/{id}
```

直到：

- `status=success`：成功，AT 已写入 token 池。
- `status=failed`：读 `logs` 最后 30-50 行定位原因。

结果查看：

```text
GET /api/ats
```

### 4.2 AT 升级 Plus

先拿 AT：

```text
GET /api/ats
```

选一个 `expired=false` 的 `hash`。

可选检测试用：

```json
POST /api/ats/{hash}/check-trial
{}
```

创建升级：

```json
POST /api/plus/jobs
{
  "tokenHash": "<hash>",
  "paypalPhone": "08012345678",
  "removeTokenOnSuccess": false
}
```

轮询：

```text
GET /api/plus/jobs/{localId}
```

如果 `otpPending=true`：

```json
POST /api/plus/jobs/{localId}/otp
{
  "pin": "123456"
}
```

结束条件：

- `done=true && status=success`：成功。
- `done=true && status=failed`：失败，读 job 详情。

### 4.3 OA 接入

前置条件：

- AT 池里 token 能解析出 `phone`。
- OA 邮箱池里有 `available=true` 的邮箱。
- SUB2API 已配置。

导入邮箱：

```json
POST /api/oa/emails/import
{
  "mailApiBaseUrl": "http://YOUR_MAIL_API_HOST",
  "text": "user@example.com----password----clientId----refreshToken"
}
```

创建 OA 任务：

```json
POST /api/oa/tasks
{
  "count": 1,
  "concurrency": 1,
  "removeTokenOnSuccess": false
}
```

轮询：

```text
GET /api/tasks/{oa_task_id}
```

成功后看：

- `task.sub2apiAccount`
- `task.bindEmail`
- `task.phone`

---

## 5. 状态怎么判断

注册/OA：

```text
queued/running -> 继续等
success        -> 成功
failed         -> 读 logs
canceled       -> 已取消
```

Plus：

```text
queued/running -> 继续等
otp_pending    -> 提交 OTP
success        -> 成功
failed         -> 读 job.latest / errorMessage
```

邮箱：

```text
free      -> 可用
reserved  -> 已被排队/运行任务占用
bound     -> 已绑定成功
failed    -> 可重试
canceled  -> 可重试
disabled  -> 不使用
```

---

## 6. 字段翻译

| 字段 | 含义 |
|---|---|
| `task.id` | 注册/OA 本地任务 ID |
| `task.status` | 任务状态 |
| `task.logs` | 最近日志 |
| `task.phone` | 注册或 OA 使用的手机号 |
| `task.accessTokenHash` | AT hash |
| `task.accessTokenPreview` | AT 预览，不是完整 token |
| `task.bindEmail` | OA 绑定邮箱 |
| `task.sub2apiAccount` | OA 成功后创建的 SUB2API 账号名 |
| `at.hash` | AT 的稳定引用 |
| `at.phone` | token 内解析到的手机号 |
| `job.localId` | 本地 Plus job ID |
| `job.jobId` | PPXY 远端 job ID |
| `job.otpPending` | 是否等待 OTP |
| `job.done` | Plus job 是否结束 |

---

## 7. 常见决策

- 要注册新号：调用 `/api/register/tasks`。
- 要看现在有多少 AT：调用 `/api/ats`。
- 要升级：从 `/api/ats` 选 hash，调用 `/api/plus/jobs`。
- 要接入 OA：先 `/api/oa/emails` 看邮箱，再 `/api/oa/tasks`。
- 任务报错：`GET /api/tasks/{id}`，只看最后 30-50 行日志。
- 服务端口不确定：看 `start-web.cmd` 输出或试 `8787-8806` 的 `/api/health`。

---

## 8. 不要做什么

- 不要把完整 access token、API key、代理密码写进回复。
- 不要直接改 `.web-data` 状态文件，除非明确要修复数据。
- 不要用浏览器页面 DOM 判断任务结果。
- 不要在任务失败后立即删除记录；先保留日志给用户定位。
- 不要大并发盲跑；注册/OA 从 `1` 或 `2` 并发开始。

