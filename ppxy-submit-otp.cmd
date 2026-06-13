@echo off
setlocal EnableExtensions
call "%~dp0ppxy-env.cmd"

if "%~1"=="" (
  echo Usage: ppxy-submit-otp.cmd JOB_ID OTP
  exit /b 1
)

if "%~2"=="" (
  echo Usage: ppxy-submit-otp.cmd JOB_ID OTP
  exit /b 1
)

curl.exe -X POST "%PPXY_BASE_URL%/api/v1/jobs/%~1/otp" ^
  -H "Authorization: Bearer %PPXY_API_KEY%" ^
  -H "Content-Type: application/json" ^
  -d "{\"pin\":\"%~2\"}"

