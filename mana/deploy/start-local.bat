@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] ساخت و اجرای MANA (بار اول چند دقیقه طول می‌کشد)...
docker compose -f docker-compose.local.yml up -d --build
if errorlevel 1 ( echo خطا! Docker Desktop باز و در حال اجرا باشد. & pause & exit /b 1 )
if not exist accounts.env echo هشدار: فایل accounts.env کنار این فایل نیست؛ رمزهای تصادفی ساخته می‌شود.
echo [2/4] منتظر آماده شدن سرور...
set /a tries=0
:wait
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://localhost:8080/api/health -TimeoutSec 3).StatusCode}catch{exit 1}" >nul 2>&1
if %errorlevel%==0 goto ready
set /a tries+=1
if %tries% geq 40 goto failed
timeout /t 3 >nul
goto wait
:failed
echo خطا: سرور بالا نیامد. آخرین لاگ را برای پشتیبانی بفرستید:
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml logs mana --tail 40
pause
exit /b 1
:ready
echo [3/4] ساخت حساب‌های آزمایشی (رمزها را یادداشت کنید)...
docker compose -f docker-compose.local.yml exec mana npx tsx scripts/seed.ts
echo [4/4] باز شدن برنامه در مرورگر...
start http://localhost:8080
echo.
echo برای خاموش کردن: docker compose -f docker-compose.local.yml down
pause
