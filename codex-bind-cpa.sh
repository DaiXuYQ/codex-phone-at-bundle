#!/bin/bash
# Usage: ./codex-bind-cpa.sh <phone> [password]
#
# 模式二：对已注册的 phone 账号（已开通 Plus 后）走 OAuth 绑定邮箱 + 回调 CPA 入库。
#
# 前提：
#   1. 该手机号已用 codex-phone-at.sh 注册过
#   2. 已用 accessToken 开通了 Plus（他们自己操作）
#   3. hotmail/tokens.txt 有可用卡密（绑邮箱用）
#
# 流程：
#   1. 从 CPA 获取 codex-auth-url
#   2. 用 phone + password 走 OAuth 登录
#   3. 触发 /add-email → hotmail 卡密绑定 + IMAP OTP
#   4. 拿到 localhost callback → 提交给 CPA
#   5. CPA 完成 token exchange + 入库
#
# 用法:
#   ./codex-bind-cpa.sh +573105624563
#   ./codex-bind-cpa.sh +573105624563 ChangeMe123!
#   PHONE=+573105624563 ./codex-bind-cpa.sh

set -uo pipefail

PHONE="${1:-${PHONE:-}}"
PASSWORD="${2:-${PASSWORD:-}}"

if [ -z "$PHONE" ]; then
  echo "用法: ./codex-bind-cpa.sh <phone> [password]" >&2
  echo "  phone: 已注册的手机号 (含国家码, 如 +573105624563)" >&2
  echo "  password: 注册时的密码 (默认读 config.json 的 defaultPassword)" >&2
  exit 1
fi

if [ -n "${SENTINEL_BROWSER_PROXY:-}" ]; then
  export SENTINEL_BROWSER_PROXY
fi
export SENTINEL_BROWSER_PATH="${SENTINEL_BROWSER_PATH:-/c/Program Files/Google/Chrome/Application/chrome.exe}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
CODEX_DIR="$SCRIPT_DIR/codex_register"
cd "$CODEX_DIR"

TSX="$CODEX_DIR/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  echo "缺少 $TSX,先在 codex_register/ 跑一次 npm install" >&2
  exit 1
fi

# CPA 配置
export CPA_BASE_URL="${CPA_BASE_URL:-}"
export CPA_MANAGEMENT_KEY="${CPA_MANAGEMENT_KEY:-}"

CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

printf "${CYAN}[bind-cpa] phone=${PHONE} → OAuth 绑邮箱 + CPA 入库${RESET}\n"

ARGS=(
  --codex-cpa
  --phone "$PHONE"
)

if [ -n "$PASSWORD" ]; then
  ARGS+=(--password "$PASSWORD")
fi

if [ -n "${CPA_BASE_URL:-}" ]; then
  ARGS+=(--cpa-base "$CPA_BASE_URL")
fi

if [ -n "${CPA_MANAGEMENT_KEY:-}" ]; then
  ARGS+=(--cpa-key "$CPA_MANAGEMENT_KEY")
fi

# 输出 token 到 pool (可选)
if [ -n "${TOKEN_OUT:-}" ]; then
  ARGS+=(--token-out "$TOKEN_OUT")
fi

"$TSX" src/index.ts "${ARGS[@]}"
ts_exit=$?

if [ $ts_exit -eq 0 ]; then
  printf "${GREEN}[bind-cpa] ✅ 成功：phone=${PHONE} 已绑邮箱并入库 CPA${RESET}\n"
else
  printf "${RED}[bind-cpa] ❌ 失败 (exit=${ts_exit})${RESET}\n"
  exit $ts_exit
fi
