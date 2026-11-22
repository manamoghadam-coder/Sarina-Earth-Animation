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
