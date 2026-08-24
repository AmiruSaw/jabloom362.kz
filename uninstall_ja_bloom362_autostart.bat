@echo off
chcp 65001 >nul
set "TASK_NAME=JA-Bloom362-CRM"

echo Удаление автозапуска JA Bloom362...
schtasks /End /TN "%TASK_NAME%" >nul 2>&1
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1
netsh advfirewall firewall delete rule name="JA Bloom362 CRM 5176" >nul 2>&1

echo Готово. Автозапуск удалён.
pause
