@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Dang cai dat lan dau, vui long doi...
  call npm install --omit=dev
  if errorlevel 1 ( pause & exit /b 1 )
)
echo Seller Union dang chay tai http://localhost:3000  (dong cua so nay de tat)
start "" http://localhost:3000/app/
call npm start
pause
