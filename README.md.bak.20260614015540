# codex-phone-at — 手机号注册 + 绑定 CPA 工具包

提供两个独立模式，用户自行完成 Plus 开通后再回来绑定入库。

---

## 两个模式

| 模式 | 脚本 | 用途 |
|------|------|------|
| **模式一** | `codex-phone-at.sh` | 手机号注册 ChatGPT → 拿 accessToken |
| **模式二** | `codex-bind-cpa.sh` | 已有账号 → OAuth 绑邮箱 → 回调 CPA 入库 |

### 典型工作流

```
1. 跑 codex-phone-at.sh        → 拿到 accessToken
2. 用 accessToken 开通 Plus     → 用户自己操作（pplink/gopay/手动）
3. 跑 codex-bind-cpa.sh +xxx   → 绑邮箱 + CPA 入库
```

---

## 环境要求

- **Node.js** >= 18
- **npm**
- **Google Chrome**（Sentinel 解算需要）

## 安装

```bash
cd codex_register
npm install
npx playwright install chromium   # sentinel-browser 需要
```

## 配置

```bash
cp codex_register/config.example.json codex_register/config.json
```

```jsonc
{
  "provider": "hotmail",
  "defaultProxyUrl": "socks5://USER-region-US:PASS@HOST:PORT",
  "defaultPassword": "ChangeMe123!",

  // hero-sms（模式一取号用）
  "heroSMSApiKey": "你的key",
  "heroSMSCountry": 33,
  "heroSMSMaxPrice": 0.08,
  "heroSMSPriceTiers": [0.045, 0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08],
  "heroSMSPollAttempts": 15,
  "heroSMSPollIntervalMs": 3000,

  // CPA（模式二入库用）
  "cliproxyApiAutoUploadAuth": true,
  "cliproxyApiBaseUrl": "https://YOUR_CPA_URL",
  "cliproxyApiManagementKey": "YOUR_KEY"
}
```

## 环境变量

```bash
export SENTINEL_BROWSER_PROXY="http://USER-region-US:PASS@HOST:PORT"
export SENTINEL_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

---

## 模式一：手机号注册 → 拿 AccessToken

```bash
./codex-phone-at.sh          # 跑 1 次
./codex-phone-at.sh 10       # 跑 10 次
./codex-phone-at.sh 10 3     # 10 次，3 并发
```

### 流程

1. hero-sms 取号（自动换号最多 8 次）
2. 手机号注册 ChatGPT（phone OTP 验证）
3. ChatGPT web 登录（建立 session cookies）
4. 从 `chatgpt.com/api/auth/session` 拿 accessToken
5. 追加到 `pool_tokens.txt`

### 输出

- `pool_tokens.txt` — 每行一个 accessToken（JWT）
- `codex_register/auth/at/` — auth JSON 文件

### 注意

- 不绑邮箱（除非 OpenAI 强制触发 /add-email）
- accessToken 可直接用于 Plus 订阅

---

## 模式二：绑邮箱 + CPA 入库

**前提**：账号已注册、已开通 Plus。

```bash
./codex-bind-cpa.sh +573105624563
./codex-bind-cpa.sh +573105624563 ChangeMe123!
```

也可以环境变量方式：
```bash
CPA_BASE_URL="https://YOUR_CPA_URL" \
CPA_MANAGEMENT_KEY="YOUR_KEY" \
./codex-bind-cpa.sh +573105624563
```

### 流程

1. 从 CPA 获取 codex-auth-url（PKCE authorize URL）
2. 用 phone + password 走 OAuth 登录
3. 触发 `/add-email` → 从 hotmail 卡密池取邮箱 + IMAP 收 OTP
4. 拿到 `localhost:1455/auth/callback?code=...`
5. 提交 callback 给 CPA → CPA 完成 token exchange + 入库
6. 从 CPA 拉回 auth 文件验证

### Hotmail 卡密池

```
codex_register/hotmail/tokens.txt
```

每行：`email----refreshToken`

模式二**必须**有可用卡密（OAuth 必然触发 add-email）。

---

## 常见问题

### "缺少 SDK" / playwright 错误
```bash
cd codex_register && npx playwright install chromium
```

### "SENTINEL_BROWSER_PATH 未找到"
```bash
# macOS
export SENTINEL_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# Linux
export SENTINEL_BROWSER_PATH="/usr/bin/google-chrome"
```

### hero-sms 取号失败
- 检查 `heroSMSApiKey`、余额
- 换 country（33=哥伦比亚, 48=波兰, 31=荷兰）

### 模式二 "OAuth 跳到 /add-email 但未提供 bindEmail"
- `hotmail/tokens.txt` 为空或格式不对
- 补充卡密再跑

### token 格式
输出的 accessToken 是 JWT（`eyJ...`），字段包含：
- `https://api.openai.com/profile.phone_number` — 手机号
- `https://api.openai.com/auth.user_id` — 用户 ID

可用于：
- ChatGPT Plus 订阅
- chatgpt.com API 调用
