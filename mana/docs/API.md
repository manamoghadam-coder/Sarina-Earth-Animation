# مستندات API
پایه: `/api`. JSON. احراز هویت با کوکی `mana_session`. درخواست‌های `POST/PUT/PATCH/DELETE` باید هدر `X-Requested-With: mana` داشته باشند. خطاها: `{error, message?, issues?}`؛ ۴۰۱ نشست ندارد، ۴۰۳ مجوز ندارد، ۴۰۰ اعتبارسنجی. 🔒 = فقط مانا.

## ورود و کاربر
| روش و مسیر | شرح |
|---|---|
| `POST /auth/login` `{username,password}` | ورود؛ ۴۲۹ هنگام قفل |
| `POST /auth/logout` | خروج |
| `GET /me` | کاربر جاری + تنظیمات کودک |
| `POST /auth/password` 🔒 `{current,next}` | تغییر رمز مانا (همه‌ی نشست‌ها بسته می‌شود) |
| `POST /children/:id/password` 🔒 `{password}` | تعیین رمز کودک |
| `GET /settings` · `PUT /settings/currency` 🔒 | تنظیمات (واحد پول) |

## مانا 🔒
CRUD استاندارد (`GET` فهرست، `POST` ایجاد، `PATCH /:id`، `DELETE /:id`): `/projects` `/tasks` (فیلتر `status`,`project_id`) `/events` `/transactions` `/debts` `/goals` `/habits`.

| مسیر | شرح |
|---|---|
| `POST /tasks/:id/status` | تغییر وضعیت (todo/doing/waiting/done/cancelled) |
| `PUT /budgets` `{jy,jm,category,amount}` | بودجه‌ی ماه شمسی |
| `POST /debts/:id/pay` `{amount?}` | پرداخت قسط: هزینه ثبت و سررسید یک ماه شمسی جلو می‌رود |
| `GET /finance/summary?jy&jm` | درآمد، هزینه، مانده، دسته‌ها در برابر بودجه، سررسیدها |
| `GET /dashboard` | داشبورد |
| `PUT /habits/:id/log` · `GET /habits/logs?from&to` | ثبت عادت |

## خانواده
| مسیر | شرح |
|---|---|
| `GET /children` 🔒 | کودکان + مانده‌ی ستاره + تنظیمات |
| `PATCH /children/:id/settings` 🔒 | اعلان، صدا، ساعت سکوت، آفست یادآوری، میکروفون، هدف هفتگی |
| CRUD 🔒 `/activities?child_id` `/rewards?child_id` `/child-goals?child_id` | برنامه، جایزه، هدف |
| `GET /completions?status` 🔒 · `POST /completions/:id/decide` `{approve,stars?}` | تأیید ستاره |
| `POST /children/:id/mark-done` 🔒 `{activity_id,day?}` | ثبتِ مستقیم انجام (تأییدشده) |
| `POST /children/:id/stars` 🔒 `{delta,reason}` | تنظیم دستی ستاره |
| `GET /reward-claims` · `POST /reward-claims/:id/decide` 🔒 `{grant}` | جایزه‌ها |
| `GET /child/today · /child/week · /child/stars` | نمای کودک (برای مانا با `?child_id=`) |
| `POST /child/complete` `{activity_id}` | «انجام دادم» → pending |
| `POST /child/claim` `{reward_id}` | درخواست جایزه |

## تصاویر
`POST /users/:id/photos` 🔒 (multipart `file`, `caption?`) · `GET /photos?owner_id` · `GET /photos/:id/file` · `DELETE /photos/:id` 🔒 · `POST /photos/:id/avatar` 🔒.

## اعلان
| مسیر | شرح |
|---|---|
| `GET /notifications?unseen=1` | اعلان‌های سررسیدشده‌ی کاربر |
| `POST /notifications/:id/seen · /done · /snooze {minutes}` | دیده / انجام (کودک→pending، مانا→کار انجام) / تعویق (حداکثر ۳ بار) |
| `GET /notifications/history?user_id` 🔒 | تاریخچه با وضعیت ارسال |
| `POST /notifications/test` 🔒 `{user_id,text?}` | اعلان آزمایشی |
| `GET /push/key` · `POST /push/subscribe` · `POST /push/unsubscribe` | Web Push |

## MANA AI 🔒
`POST /ai/message {text}` → `{kind:'proposal'|'answer'|'unknown', proposal_id?, summary?, message}`؛ `POST /ai/proposals/:id/confirm {approve}`. نیت‌ها: رویداد، تراکنش، برنامه‌ی کودک، انجام فعالیت کودک، کار، گزارش هزینه، سه اولویت.

## حساب‌های عضو بزرگسال (🔒 فقط مانا)
`GET /members` · `PATCH /members/:id {permissions:{tasks?:0-2,events?,finance?,goals?,children?,photos?}, active?}` · `POST /members/:id/password {password}`.
مسیرهای ماژول‌ها (مثل `/tasks`، `/finance/summary`، `/children`، `/photos`) برای عضو بر اساس سطح (۱ خواندن، ۲ نوشتن) مجازند؛ `/me` فیلد `permissions` را برمی‌گرداند.

## مرحله‌ی ۲ (دانستنی‌ها، سواد مالی، کتابخانه، آشپزی، AI بچه‌ها، امنیت)
| مسیر | شرح |
|---|---|
| `GET /facts/today` · CRUD 🔒 `/facts` | دانستنی روز (به‌تفکیک گروه سنی) + ۶ روز قبل |
| `GET /child/lessons` · `GET /child/lessons/:id` · `POST /child/lessons/:id/answer {i}` · CRUD 🔒 `/lessons` | درس‌های سواد مالی؛ پاسخ درست هرگز به کلاینت فرستاده نمی‌شود؛ ستاره فقط یک‌بار |
| `GET /child/wallet` · `POST /child/wallet/save {goal_id,amount}` · `POST /child/wallet/spend {amount,note}` | پول‌توجیبی مجازی، قلک و ثبت خرج کودک |
| `POST /children/:id/wallet {delta,reason}` · `POST /children/:id/goals` · `DELETE /savings-goals/:id` 🔒 | واریز/کسر، هدف پس‌انداز (حذف = برگشت پول) |
| `POST /library` (multipart) · `GET /library` · `GET /library/:id/file` (Range) · `PATCH/DELETE /library/:id` | PDF و صوت؛ نوع از محتوای فایل؛ هر کودک فقط موارد همه/گروه سنی خود |
| `GET /recipe-categories` · `GET /recipes[?category_id]` · `GET /recipes/:id` · `POST/PATCH/DELETE /recipes` · `POST /recipes/:id/media` · `GET /recipe-media/:id/file` | دستور غذا با عکس و ویدیو (آپلود یا لینک) |
| `POST /child/ask {question}` · `GET /children/:id/ai-chats[?flagged_only=1]` 🔒 | پرسش از دستیار هوشمند و ثبت گفتگو برای مانا؛ سقف روزانه، فیلتر موضوع‌های حساس |
| `GET/POST /users` · `PATCH /users/:id` 🔒 | مدیریت حساب‌ها |
| `GET /backups` · `POST /backups/run` · `GET /backups/:name` 🔒 | پشتیبان‌گیری |
| `POST /auth/2fa/setup|enable|disable` 🔒 · ورود با `totp` | تأیید دومرحله‌ای (TOTP) |
ماژول‌های جدید دسترسی: `library`، `recipes`. متغیرهای محیطی جدید: `ANTHROPIC_API_KEY`، `ANTHROPIC_MODEL`، `BACKUP_KEEP`، `BACKUP_AUTO`.

## مرحله‌ی ۱ تکمیلی: عادت‌ها و دارو، درخواست‌ها، پیشنهادها، مناسبت‌ها، جمله‌ی روز
| مسیر | شرح |
|---|---|
| CRUD 🔒 `/routines?child_id` | عادت یا دارو (`kind`، `times` ساعت‌ها، `weekdays`، `start_date/end_date`، `dose`) — ماژول `children` |
| `GET /routines/report?child_id` | تعداد انجام در ۷ روز اخیر |
| `GET /child/routines` · `POST /child/routines/:id/log {slot}` | نمای کودک و تیک انجام |
| `GET/POST /child/requests` `{category: food|clothes|school|class_fee|other, title}` | درخواست خرید کودک (فقط با وضعیت requested) |
| `GET /purchase-requests` · `POST /purchase-requests/:id/decide {status: approved|bought|rejected, mom_note?}` | مدیریت درخواست‌ها (ماژول children) |
| `GET/POST /child/suggestions {kind, text}` · `GET /suggestions` · `POST /suggestions/:id/status` | جعبه‌ی پیشنهاد |
| CRUD `/occasions` | مناسبت/تولد شمسی سالانه (`jm`, `jd`, `birth_jy?`, `audience`) — ماژول events |
| `GET /occasions/upcoming?days` | مناسبت‌های نزدیک با روزهای باقی‌مانده و سن |
| `GET /quote/today` · CRUD `/quotes` | جمله‌ی روز بر اساس گروه سنی (`young|teen|adult`) |
ماژول جدید دسترسی: `debts` (بدهی و اقساط) جدا از `finance`.

## مرحله‌ی ۳: پیام‌رسان، لیست خرید، سلامت، پیوست، پشتیبان
| مسیر | شرح |
|---|---|
| `GET /messenger/status` · `POST /messenger/link-code {provider: bale|telegram}` · `POST /messenger/toggle` · `POST /messenger/unlink` · `POST /messenger/test` | اتصال حساب به ربات (بزرگسالان) |
| ربات: `/start کد` · `/today` · `/list` · `/add نام` · `/unlink` · `/help` | دستورهای ربات (long polling؛ بدون وب‌هوک) |
| `GET/POST /shopping` · `POST /shopping/:id/status` · `DELETE /shopping/:id` · `POST /shopping/clear-bought` · `POST /purchase-requests/:id/to-shopping` | لیست خرید (ماژول shopping) |
| CRUD `/health-records` · `POST /health-records/:id/done` · `GET /people` | سلامت (ماژول health) |
| `GET/POST /tasks/:id/files` · `GET/DELETE /task-files/:id[/file]` | پیوست کار: PDF، عکس، docx/xlsx/pptx تا ۲۵MB |
| `GET /backups` (+ `intervalHours`, `keep`, `lastCheck`) · `PUT /backups/settings` · `POST /backups/run[?force=1]` | پشتیبان بدون تکرار؛ نتیجه شامل `skipped` برای بخش‌های بدون تغییر |
متغیرهای محیطی: `MESSENGER_PROVIDERS`، `BALE_BOT_TOKEN`، `BALE_API_BASE`، `TELEGRAM_BOT_TOKEN`، `TELEGRAM_API_BASE`، `BACKUP_INTERVAL_HOURS`، `BACKUP_KEEP`.

## مرحله‌ی ۴: ویژگی‌های شخصی و اجتماعی (منتقل‌شده)
| مسیر | شرح |
|---|---|
| `GET/POST/PATCH/DELETE /diary` (`?user_id=` فقط مانا برای کودکان) | دفترچه (ویژگی `diary`) |
| `GET/POST/PATCH/DELETE /mom-messages` · `POST /mom-messages/:id/read` · `GET /mom-messages/unread` | پیام‌های مانا (ویژگی `inbox`) |
| `GET /chat[?peer=&after=]` · `GET /chat/summary` · `POST /chat {body,peer_id?}` · `DELETE /chat/:id` | چت گروهی و خصوصی (ویژگی `chat`) |
| `GET/PUT /reflection/today` · `GET /reflection` · CRUD `/reflection-questions` 🔒 | مرور شبانه |
| `GET /wishes/board[?user_id=]` · `POST /wishes/photo` · `POST/PATCH/DELETE /wishes` · `POST /wishes/:id/achieve` · `POST /wishes/board/renew` · `PATCH /wishes/board` | تابلو آرزوها (ویژگی `wishes`) |
| `GET /reports/weekly[?week_start=]` 🔒 | گزارش هفتگی |
| `GET /meals?from&to` · `PUT /meals` | برنامه‌ی غذایی |
| `POST /me/avatar` | عکس پروفایل خود فرد (ویژگی `avatar`) |
| `POST /children/:id/sample-data` 🔒 | برنامه‌ی نمونه‌ی اختیاری |
| `PATCH /members/:id {permissions:{diary,inbox,chat,wishes,avatar,…}}` 🔒 | ویژگی‌ها برای بزرگسال و کودک؛ ماژول‌های کاری فقط برای بزرگسال |
سطح ویژگی‌ها: ۰ بدون دسترسی، ۱ مشاهده، ۲ مشاهده و نوشتن. پیش‌فرض: diary ۲، chat ۲، inbox ۱، avatar ۲، wishes ۲.
