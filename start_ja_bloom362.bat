@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM JA Bloom362 — запуск в текущей локальной сети
set "JA_BLOOM362_HOST=0.0.0.0"
set "JA_BLOOM362_PORT=5176"

REM Автоматически определяем IPv4 этого компьютера в текущей LAN
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip=(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual | Where-Object {$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '0.0.0.0'} | Select-Object -First 1 -ExpandProperty IPAddress); if($ip){$ip}"`) do set "LAN_IP=%%I"

if not defined LAN_IP (
  echo Не удалось автоматически определить IP локальной сети.
  echo Выполни ipconfig и укажи IPv4 вручную.
  pause
  exit /b 1
)

set "JA_BLOOM362_ALLOWED_ORIGINS=http://%LAN_IP%:5176,http://127.0.0.1:5176,http://localhost:5176"

echo.
echo ========================================
echo       JA Bloom362 CRM
 echo      Локальная сеть
 echo ========================================
echo IP компьютера: %LAN_IP%
echo CRM: http://%LAN_IP%:5176/
echo Localhost: http://127.0.0.1:5176/
echo ========================================
echo.

title JA Bloom362 CRM - %LAN_IP%:5176
start "JA Bloom362 CRM" "http://%LAN_IP%:5176/"
python server.py
if errorlevel 1 (
  echo.
  echo Сервер завершился с ошибкой.
  pause
)
