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

## حساب‌ها و سطح دسترسی همه‌ی کاربران (🔒 فقط مانا)
`GET /members` (وحید + کودکان) · `PATCH /members/:id {permissions:{…}, active?}` · `POST /members/:id/password {password}`.
- بخش‌های کاری `tasks, events, finance, goals, children, photos` فقط برای عضو بزرگسال معنا دارند (برای کودک نادیده گرفته می‌شود).
- ویژگی‌های شخصی برای **همه** (وحید، سارینا، سامان): `diary`، `chat`، `inbox`، `avatar`؛ سطح ۰ بدون دسترسی، ۱ فقط مشاهده، ۲ مشاهده و ویرایش. پیش‌فرض: diary=۲، chat=۲، inbox=۱، avatar=۲.
- `/me` فیلد `permissions` را برای همه‌ی این کلیدها برمی‌گرداند.

## دفترچه‌ی خاطرات (نویسنده؛ مانا فقط دفترچه‌ی کودکان را می‌خواند، با `?user_id=`)
`GET /diary[?user_id]` · `POST /diary {title?,body,mood?,entry_date?}` · `PATCH /diary/:id` · `DELETE /diary/:id`.

## پیام‌های مامان
`GET /mom-messages` (مانا: همه، با `?to_user`؛ دیگران: فقط پیام‌های خودشان) · `POST /mom-messages` 🔒 `{to:[ids]|'all', title?, body, msg_date?}` (برای هر گیرنده یک اعلان «پیام مامان» ساخته می‌شود) · `PATCH/DELETE /mom-messages/:id` 🔒 · `POST /mom-messages/:id/read` · `GET /mom-messages/unread`.

## چت خانوادگی
`GET /chat[?after=id]` → `{people, messages}` (برای به‌روزرسانی هر ۴ ثانیه) · `POST /chat {body}` · `DELETE /chat/:id` (فرستنده یا مانا) · `GET /chat/unread?after=id`.

## عکس پروفایل خود فرد
`POST /me/avatar` — `multipart file` (عکس تازه) یا JSON `{photo_id}` (یکی از عکس‌های خود فرد). نیازمند `avatar ≥ ۲`.

## مرور شبانه
`GET /reflection/today` (سؤال‌های فعال + جواب امروز) · `PUT /reflection/today {answers:[{q,kind,a}]}` (یک ثبت در روز؛ دوباره‌فرستادن = ویرایش) · `GET /reflection[?user_id]` (تاریخچه؛ مانا برای کودکان).
مانا 🔒: `GET/POST /reflection-questions` `{text,kind:'text'|'gratitude',child_id?,sort?,active?}` · `PATCH/DELETE /reflection-questions/:id`. تنظیم هر کودک با `PATCH /children/:id/settings` (`reflection_enabled`, `reflection_time`). زمان‌بند هر شب یک اعلان `reflection` می‌سازد (اگر هنوز جواب نداده باشد).

## تابلو آرزوها
`GET /wishes/board[?user_id]` (تابلوی فعال + آرزوها + بایگانی؛ مانا برای کودکان با `user_id`) · `GET /wishes/boards/:id` · `POST /wishes/photo` (multipart، عکس آرزو) → `{photo_id}` · `POST /wishes {title,note?,kind:'dream'|'place'|'goal',photo_id?}` · `PATCH/DELETE /wishes/:id` · `POST /wishes/:id/achieve {achieved}` («رسیدم»؛ مانا اعلان می‌گیرد) · `POST /wishes/board/renew {title?,carry_over?,refresh_months?}` · `PATCH /wishes/board`. کلید دسترسی: `wishes`.

## گزارش هفتگی 🔒
`GET /reports/weekly[?week_start=YYYY-MM-DD]` (هفته‌ی شنبه تا جمعه، قاعده‌محور). زمان‌بند جمعه ۱۸:۰۰ اعلان `weekly_report` می‌سازد.

## خانه‌داری (ماژول `home`) و پیوست کار
`/shopping` (CRUD) · `GET /meals?from&to` · `PUT /meals {day,slot:'breakfast|lunch|dinner',title}` (عنوان خالی = حذف) · `GET/POST /tasks/:id/files` · `GET/DELETE /task-files/:id` (PDF/JPEG/PNG/WebP تا ۱۰MB).

## مناسبت‌های سالانه
`GET /family-dates` · `POST/DELETE /family-dates` 🔒 `{title,kind:'birthday|anniversary|occasion|holiday',jm,jd,person_id?,notify?}`.

## چت: گفتگوی خصوصی
`GET /chat?peer=<userId>[&after]` · `POST /chat {body, peer_id?}` · `GET /chat/summary` (آخرین پیام هر گفتگو برای نشان خوانده‌نشده). گفتگوی خصوصی فقط برای همان دو نفر خواندنی است.

## ساخت عضو و تنظیمات کودک
`POST /members` 🔒 `{username,display_name,role:'member'|'child',password,theme?,show_homework?}` · `PATCH /children/:id/settings` فیلدهای تازه: `theme`, `show_homework`, `reflection_stars`.
