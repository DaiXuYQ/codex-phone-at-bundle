@echo off
setlocal EnableExtensions
call "%~dp0ppxy-env.cmd"

if "%~1"=="" (
  echo Usage: ppxy-query-job.cmd JOB_ID
  exit /b 1
)

curl.exe "%PPXY_BASE_URL%/api/v1/jobs/%~1" ^
  -H "Authorization: Bearer %PPXY_API_KEY%"

