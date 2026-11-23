@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================================
echo   GearBox Pro 授权签发管理服务器 - 一键启动
echo ========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 18 或更高版本。
  pause
  exit /b 1
)

if not exist "%~dp0keys\private.pem" (
  echo [错误] 未找到 keys\private.pem，请先从管理员受控备份恢复签发私钥。
  pause
  exit /b 1
)

echo 管理员令牌将以隐藏方式输入，且至少需要 24 位。
powershell -NoProfile -Command "$secure=Read-Host 'Admin token' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }; if ($token.Length -lt 24) { Write-Error 'Token must be at least 24 characters.'; exit 1 }; $env:LICENSE_SERVER_HOST='127.0.0.1'; $env:LICENSE_SERVER_PORT='8090'; $env:LICENSE_ADMIN_TOKEN=$token; $p=Start-Process -FilePath 'node' -ArgumentList 'server.js' -NoNewWindow -Wait -PassThru; exit $p.ExitCode"
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

if not "%SERVER_EXIT_CODE%"=="0" (
  echo 授权服务器已退出，代码 %SERVER_EXIT_CODE%。
  pause
  exit /b %SERVER_EXIT_CODE%
)
