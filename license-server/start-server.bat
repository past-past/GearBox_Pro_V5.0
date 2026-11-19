@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js 18 or newer was not found in PATH.
  pause
  exit /b 1
)

if not exist "keys\private.pem" (
  echo ERROR: keys\private.pem was not found.
  echo Run "node keygen.js" first in this directory on the administrator machine.
  pause
  exit /b 1
)

echo Enter a strong admin token of at least 24 characters. Input is hidden.
powershell -NoProfile -Command "$secure=Read-Host 'Admin token' -AsSecureString; $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }; if ($token.Length -lt 24) { Write-Error 'Token must be at least 24 characters.'; exit 1 }; $env:LICENSE_SERVER_HOST='127.0.0.1'; $env:LICENSE_SERVER_PORT='8090'; $env:LICENSE_ADMIN_TOKEN=$token; $p=Start-Process -FilePath 'node' -ArgumentList 'server.js' -NoNewWindow -Wait -PassThru; exit $p.ExitCode"
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

if not "%SERVER_EXIT_CODE%"=="0" (
  echo License server exited with code %SERVER_EXIT_CODE%.
)
pause
exit /b %SERVER_EXIT_CODE%
