@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo نسخه ۶ - دنیای کوچک ما
echo [1/4] خاموش کردن نسخه‌ی قدیمی (اگر روشن باشد)...
docker compose -p deploy down >nul 2>&1
echo [1/4] ساخت و اجرای برنامه (بار اول چند دقیقه طول می‌کشد)...
docker compose -f docker-compose.local.yml up -d --build
if errorlevel 1 ( echo خطا! Docker Desktop باز و در حال اجرا باشد. & pause & exit /b 1 )
echo [2/4] منتظر آماده شدن سرور...
set /a tries=0
:wait
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://localhost:8090/api/health -TimeoutSec 3).StatusCode}catch{exit 1}" >nul 2>&1
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
echo [3/4] آماده است. در اولین ورود، برنامه از شما نام کاربری و رمز مدیر را می‌پرسد.
echo [4/4] باز شدن برنامه در مرورگر...
start http://localhost:8090
echo.
echo اگر نام کاربری یا رمز مدیر را فراموش کردید: reset-password.bat را اجرا کنید.
echo برای خاموش کردن: docker compose -f docker-compose.local.yml down
pause
