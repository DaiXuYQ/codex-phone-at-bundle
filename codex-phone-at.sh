#!/bin/bash
# Usage: ./codex-phone-at.sh [N] [P]
#   N = 总注册次数 (默认 1)
#   P = 并发数      (默认 1)
#
# phone 注册 → ChatGPT web 登录 → api/auth/session 拿 accessToken → 追加到 pool_tokens.txt
# 走 --phone --at 模式：和 email 一样直接拿 ChatGPT session token，不经过 CPA。

set -uo pipefail

N="${1:-1}"
P="${2:-1}"

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

CYAN='\033[36m'
GREEN='\033[32m'
RED='\033[31m'
YELLOW='\033[33m'
RESET='\033[0m'

run_one() {
  local idx=$1
  local total=$2
  printf "${CYAN}========== [phone-at] %d / %d (pid=%d) ==========${RESET}\n" "$idx" "$total" "$$"

  # --phone --at --st：phone signup → ChatGPT web login → getChatGPTAccessToken
  "$TSX" src/index.ts --phone --at --st --gp-token-out "$ROOT/pool_tokens.txt"
  local ts_exit=$?

  if [ $ts_exit -eq 0 ]; then
    printf "${GREEN}[phone-at] ✅ #%d 成功${RESET}\n" "$idx"
    return 0
  else
    printf "${RED}[phone-at] ❌ #%d 失败 (exit=%d)${RESET}\n" "$idx" "$ts_exit"
    return 1
  fi
}

if [ "$P" -le 1 ]; then
  for ((i = 1; i <= N; i++)); do
    echo
    run_one "$i" "$N"
  done
else
  printf "${YELLOW}[并行模式] 总计 %d 批,最多同时 %d 个${RESET}\n" "$N" "$P"
  for ((i = 1; i <= N; i++)); do
    run_one "$i" "$N" &
    while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$P" ]; do
      wait -n 2>/dev/null || sleep 0.5
    done
  done
  wait
  echo
  printf "${YELLOW}[并行模式] 全部 %d 批完成${RESET}\n" "$N"
fi
