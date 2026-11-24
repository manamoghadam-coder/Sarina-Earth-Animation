@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/3] ساخت و اجرای MANA (بار اول چند دقیقه طول می‌کشد)...
docker compose -f docker-compose.local.yml up -d --build
if errorlevel 1 ( echo خطا! Docker Desktop باز و در حال اجرا باشد. & pause & exit /b 1 )
if not exist accounts.env echo هشدار: فایل accounts.env کنار این فایل نیست؛ رمزهای تصادفی ساخته می‌شود.
echo [2/3] ساخت حساب‌های آزمایشی (رمزها را یادداشت کنید)...
docker compose -f docker-compose.local.yml exec mana npx tsx scripts/seed.ts
echo [3/3] باز شدن برنامه در مرورگر...
start http://localhost:8080
echo.
echo برای خاموش کردن: docker compose -f docker-compose.local.yml down
pause
