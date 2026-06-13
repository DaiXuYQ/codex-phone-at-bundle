@echo off
setlocal EnableExtensions
call "%~dp0ppxy-env.cmd"

if "%~1"=="" (
  echo Usage: ppxy-create-job.cmd PAYPAL_PHONE
  echo Example: ppxy-create-job.cmd 08012345678
  exit /b 1
)

if not exist "%TOKEN_FILE%" (
  echo Missing token file: "%TOKEN_FILE%"
  exit /b 1
)

set "PAYPAL_PHONE=%~1"
set "AT="
for /f "usebackq delims=" %%A in ("%TOKEN_FILE%") do (
  set "AT=%%A"
  goto :got_token
)

:got_token
if "%AT%"=="" (
  echo No token found in "%TOKEN_FILE%"
  exit /b 1
)

set "ORDER=plus-%RANDOM%-%RANDOM%"

curl.exe -X POST "%PPXY_BASE_URL%/api/v1/jobs" ^
  -H "Authorization: Bearer %PPXY_API_KEY%" ^
  -H "Content-Type: application/json" ^
  -H "Idempotency-Key: %ORDER%" ^
  -d "{\"input\":\"%AT%\",\"client_ref\":\"%ORDER%\",\"phone\":\"%PAYPAL_PHONE%\",\"proxy_jp\":\"%PPXY_PROXY_JP%\"}"

