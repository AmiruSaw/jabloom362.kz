@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo ========================================
echo      JA Bloom362 - Автозапуск Windows
echo ========================================
echo.

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "TASK_NAME=JA-Bloom362-CRM"

for /f "delims=" %%P in ('where python.exe 2^>nul') do (
  set "PYTHON=%%P"
  goto :python_found
)

echo [ОШИБКА] Python не найден в PATH.
echo Установи Python и включи Add python.exe to PATH.
pause
exit /b 1

:python_found
echo Python: %PYTHON%
echo Папка CRM: %APP_DIR%
echo.

REM Remove an old task if it exists.
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

REM Allow the CRM port through Windows Firewall for the local network.
netsh advfirewall firewall delete rule name="JA Bloom362 CRM 5176" >nul 2>&1
netsh advfirewall firewall add rule name="JA Bloom362 CRM 5176" dir=in action=allow protocol=TCP localport=5176 profile=private >nul 2>&1

REM Start server at every user logon, hidden in the background.
schtasks /Create /TN "%TASK_NAME%" /TR "\"%PYTHON%\" \"%APP_DIR%\server.py\"" /SC ONLOGON /RL HIGHEST /F /RU "%USERNAME%" /HIDDEN >nul
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Не удалось создать автозапуск.
  echo Запусти этот файл от имени администратора.
  pause
  exit /b 1
)

REM Start it now.
schtasks /Run /TN "%TASK_NAME%" >nul 2>&1

echo.
echo ========================================
echo ГОТОВО!
echo ========================================
echo JA Bloom362 теперь запускается автоматически при входе в Windows.
echo Сервер: http://127.0.0.1:5176/
echo.
echo Можно закрыть это окно. CRM продолжит работать в фоне.
echo ========================================
echo.
pause
