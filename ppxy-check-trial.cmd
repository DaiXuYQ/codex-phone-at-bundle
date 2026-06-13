@echo off
setlocal EnableExtensions
call "%~dp0ppxy-env.cmd"

if not exist "%TOKEN_FILE%" (
  echo Missing token file: "%TOKEN_FILE%"
  exit /b 1
)

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

curl.exe -X POST "%PPXY_BASE_URL%/api/v1/trial/check" ^
  -H "Authorization: Bearer %PPXY_API_KEY%" ^
  -H "Content-Type: application/json" ^
  -d "{\"token\":\"%AT%\",\"proxy_jp\":\"%PPXY_PROXY_JP%\"}"

