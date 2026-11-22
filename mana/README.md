# MANA — دستیار اجرایی زندگی و خانواده

اپلیکیشن فارسی، RTL و PWA برای مدیریت کار، خانواده، مالی، اهداف و برنامه‌ی کودکان، با دستیار صوتی و اعلان. حساب‌ها: **مانا** (مدیر)، **وحید** (بزرگسال با دسترسی قابل تعریف توسط مانا)، **سارینا** و **سامان** (کودک). لوگوی خانواده: «Our Little World».

| بخش | فناوری |
|---|---|
| Frontend | React 19 + TypeScript + Tailwind 4 + Vite، فونت Vazirmatn، PWA (Service Worker + Web Push) |
| Backend | Node 22 + Fastify 5 + Zod، نشست مبتنی بر کوکی HttpOnly، scrypt برای رمز |
| Database | PostgreSQL 16 با **Row Level Security** (دسترسی در سطح پایگاه داده) |
| تاریخ | تقویم شمسی (jalaali-js)، ذخیره به میلادی، منطقه‌ی زمانی Asia/Tehran |
| صدا | Web Speech API (TTS و STT فارسی مرورگر) — صدایی ضبط یا ذخیره نمی‌شود |
| AI | تحلیل‌گر قاعده‌محور فارسی (همیشه فعال) + Claude اختیاری از طریق Backend |

## راه‌اندازی محلی (توسعه)
پیش‌نیاز: Node ≥ 22، PostgreSQL ≥ 14.

```bash
# 1) پایگاه داده (نقش‌ها و DB؛ با کاربر postgres)
sudo -u postgres bash mana/server/scripts/db-setup.sh <owner_password> <app_password>

# 2) Backend
cd mana/server
cp .env.example .env          # DATABASE_URL (mana_app) و DATABASE_URL_OWNER (mana_owner) را تنظیم کنید
npm ci
npm run migrate               # ساخت جدول‌ها، سیاست‌های RLS و مجوزها
npm run seed                  # فقط داده‌ی آزمایشی؛ رمز سه حساب را یک‌بار چاپ می‌کند
# کلید اعلان پوش:  npx web-push generate-vapid-keys  → در .env

# 3) Frontend
cd ../web && npm ci && npm run build      # خروجی web/dist توسط Backend سرو می‌شود

# 4) اجرا
cd ../server && npm start                 # http://localhost:8080  (+ scheduler اعلان‌ها)
```
توسعه‌ی زنده: `npm run dev` در `server/` و `web/` (Vite روی ۵۱۷۳ و پروکسی `/api`).

## تست
```bash
cd mana/server && npm test        # ۱۶ تست: امنیت/RLS، جداسازی کودکان، عکس‌ها، ستاره‌ها، مالی، AI، scheduler
cd mana/web && npm run typecheck
# تست مرورگر (Playwright؛ API صوتی stub می‌شود):
PW_MANA=… PW_SARINA=… PW_SAMAN=… node mana/e2e/e2e.cjs ./shots
```

## استقرار آنلاین
`mana/deploy/` شامل Dockerfile و docker-compose است (**در محیط ساخت آزمایش نشده**). پشت یک HTTPS قرار دهید — نصب PWA، اعلان پوش و میکروفون فقط روی HTTPS کار می‌کنند. `NODE_ENV=production` کوکی را `Secure` می‌کند. پس از استقرار رمزهای seed را از «تنظیمات/خانواده» عوض کنید و داده‌ی آزمایشی را پاک کنید.

## مستندات
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — معماری، مدل داده، ماتریس دسترسی
- [docs/SECURITY.md](docs/SECURITY.md) — مدل تهدید و کنترل‌ها
- [docs/API.md](docs/API.md) — مستندات API
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — راهنمای مدیریت کاربران و استفاده
- [docs/DEPLOY_PHONES.md](docs/DEPLOY_PHONES.md) — **راهنمای نصب روی سه گوشی**
- `brand/` — لوگوی BK (SVG + PNG) و اسکریپت رندر
- [docs/STATUS.md](docs/STATUS.md) — **وضعیت صادقانه‌ی پیاده‌سازی، آزمون‌شده‌ها و محدودیت‌ها**
