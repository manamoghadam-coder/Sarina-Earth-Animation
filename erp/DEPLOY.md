# راهنمای استقرار، پشتیبان‌گیری و بازیابی

> وضعیت راستی‌آزمایی: منطق برنامه، پراکسی‌پشتی (`X-Forwarded-*`)، HSTS، کوکی Secure، health، توقف تمیز، پشتیبان/بازیابی (SQLite و PostgreSQL) و اجرای برنامه با فقط وابستگی‌های تولیدی **تست شده‌اند**.
> `Dockerfile` و `docker-compose.yml` در محیط توسعه **build/اجرا نشده‌اند** (daemon در دسترس نبود)؛ فقط اعتبار نحوی compose بررسی شد. اولین استقرار را روی یک سرور آزمایشی انجام دهید.

## ۱) استقرار با Docker (پیشنهادی): PostgreSQL + HTTPS خودکار + پشتیبان روزانه

پیش‌نیاز: سروری با Docker، دامنه‌ای که DNS آن به سرور اشاره می‌کند، و پورت‌های ۸۰ و ۴۴۳ باز.

```bash
git clone <repo> && cd <repo>/erp
cp deploy/.env.example .env          # سپس همه‌ی مقادیر را پر کنید (دستور تولید هرکدام در همان فایل نوشته شده)
docker compose up -d --build
docker compose logs -f caddy app     # صدور گواهی و بالا آمدن برنامه
```

- https://دامنه‌ی‌شما ← ورود با `superadmin` و گذرواژه‌ی `ERP_SUPERADMIN_PASSWORD` ← **فوراً «تغییر گذرواژه»** ← ساخت شرکت‌ها از بخش «شرکت‌ها».
- فقط Caddy به بیرون باز است (۸۰/۴۴۳). برنامه و PostgreSQL فقط در شبکه‌ی داخلی Docker‌اند.
- فایروال میزبان: فقط ۲۲ (ترجیحاً محدود به IP شما یا فقط کلید SSH)، ۸۰ و ۴۴۳. مثال: `ufw default deny incoming && ufw allow 22,80,443/tcp && ufw enable`
- هر چهار کانتینر `restart: unless-stopped` دارند و برنامه health-check دارد (`/api/health`).

### متغیرهای مهم
| متغیر | توضیح |
|---|---|
| `ERP_TRUST_PROXY=1` | تعداد پراکسی‌های مورد اعتماد جلوی برنامه. **فقط وقتی پشت پراکسی هستید** تنظیم کنید؛ در غیر این صورت `X-Forwarded-For` جعلی می‌شود. نتیجه: IP واقعی برای قفل ورود، HSTS، کوکی Secure |
| `ERP_COOKIE_SECURE=1` | کوکی همیشه Secure (HTTPS الزامی) |
| `ERP_RATE_PER_MIN` | سقف درخواست API به‌ازای IP در دقیقه (پیش‌فرض ۶۰۰) |
| `ERP_SECRET` | کلید امضای نشست؛ تغییر آن همه‌ی کاربران را خارج می‌کند |

## ۲) استقرار بدون Docker (systemd + Nginx)

```bash
# Node >= 22.13، PostgreSQL، nginx، certbot روی سرور نصب باشد
cd /opt/erp && npm ci --omit=dev
sudo cp deploy/erp.service /etc/systemd/system/ && sudo cp deploy/nginx.conf /etc/nginx/sites-available/erp
sudo nano /etc/erp.env    # مثل .env.example + DATABASE_URL=postgres://… ، ERP_TRUST_PROXY=1 ، ERP_COOKIE_SECURE=1 ، ERP_DATA_DIR=/var/lib/erp
sudo chmod 600 /etc/erp.env && sudo systemctl enable --now erp
sudo certbot --nginx -d erp.example.com
```
پشتیبان روزانه با cron: `0 2 * * * cd /opt/erp && set -a && . /etc/erp.env && set +a && node src/backup.js backup >> /var/log/erp-backup.log 2>&1`

## ۳) پشتیبان‌گیری

- **چه چیزی**: کل دیتابیس (SQLite: `VACUUM INTO`، PostgreSQL: `pg_dump -Fc`) + فایل‌های پیوست + manifest با sha256 هر فایل. سر راز نشست عمداً در آن نیست.
- **امنیت**: با `ERP_BACKUP_KEY` رمزنگاری AES-256-GCM (تشخیص دست‌کاری)؛ فایل‌ها با دسترسی `600`. **کلید را جدا از سرور نگه دارید** (مدیر گذرواژه/گاوصندوق)؛ بدون آن پشتیبان غیرقابل‌بازیابی است.
- **هم‌زمان با کار سیستم** گرفته می‌شود و سازگار است (در تست با نوشتن هم‌زمان بررسی شده).
- **چرخش**: آخرین `ERP_BACKUP_KEEP` نسخه (پیش‌فرض ۱۴) روی دیسک می‌ماند.
- **خارج از سرور (ضروری)**: پشتیبانِ هم‌سرور با خود سرور از بین می‌رود. با `ERP_BACKUP_HOOK` هر پشتیبان را به مقصد دیگر بفرستید، مثلاً `rclone copy "$BACKUP_FILE" remote:erp-backups` (S3، Backblaze، سرور دیگر).

```bash
docker compose run --rm backup node src/backup.js backup          # پشتیبان دستی
docker compose run --rm backup node src/backup.js list
docker compose run --rm backup node src/backup.js verify /backups/erp-backup-….tar.gz.enc
```

### بازیابی
```bash
docker compose stop app backup caddy                                # ۱) توقف برنامه (دیتابیس بماند)
docker compose run --rm backup node src/backup.js verify /backups/FILE   # ۲) صحت فایل
docker compose run --rm backup node src/backup.js restore /backups/FILE --force   # ۳) PostgreSQL: --clean؛ فایل‌های قبلی با پسوند .pre-restore-* کنار گذاشته می‌شود
docker compose up -d                                                # ۴) راه‌اندازی و بررسی ورود/داده‌ها
```
> سرویس `backup` پوشه‌ی `/data` را فقط‌خواندنی می‌بیند؛ برای بازیابی **فایل‌های پیوست**، آن را موقتاً بدون `:ro` اجرا کنید (یا `docker compose run --rm -v erpdata:/data app node src/backup.js restore …`).

### تمرین بازیابی (حداقل ماهی یک بار)
پشتیبان بازیابی‌نشده را پشتیبان حساب نکنید. روی ماشین یا دیتابیس جدا `restore` را اجرا و ورود و گزارش‌ها (تراز آزمایشی) را بررسی کنید. نشانه‌ی سلامت: جمع بدهکار = جمع بستانکار.

### پایش
- Uptime (UptimeRobot، Healthchecks.io و …) روی `https://دامنه/api/health`.
- هشدار «تازگی پشتیبان»: مثلاً `find backups -name 'erp-backup-*' -mtime -2 | grep -q .` وگرنه اعلان؛ همچنین در لاگ دنبال `BACKUP FAILED` باشید.
- فضای دیسک میزبان و حجم `pgdata`.

## ۴) به‌روزرسانی
```bash
docker compose run --rm backup node src/backup.js backup   # همیشه قبل از به‌روزرسانی
git pull && docker compose up -d --build                   # طرح دیتابیس خودکار ارتقا می‌یابد (فقط افزودن جدول/ستون)
```

## ۵) فهرست سخت‌سازی پیش از ورود داده‌ی واقعی
- [ ] HTTPS فعال، `ERP_COOKIE_SECURE=1`، `ERP_TRUST_PROXY` مطابق تعداد پراکسی
- [ ] گذرواژه‌ی superadmin عوض شده؛ کاربران شرکت‌ها گذرواژه‌ی منحصربه‌فرد دارند
- [ ] پشتیبان رمزنگاری‌شده + نسخه‌ی خارج از سرور + **یک بازیابی موفق تمرین شده**
- [ ] SSH فقط با کلید، به‌روزرسانی خودکار امنیتی سیستم‌عامل، فایروال
- [ ] پورت PostgreSQL به بیرون باز نیست
- [ ] بازبینی امنیتی مستقل انسانی (پنتست) — رجوع به `SECURITY.md`
