# معماری MANA

## لایه‌ها
```
مرورگر/PWA (React) ──HTTPS──> Fastify API ──(SET LOCAL app.user_id/app.role)──> PostgreSQL (RLS)
                                  │                                   ▲
                                  ├─ Scheduler (30s) ─ sysPool ───────┘  (نقش mana_owner؛ فقط اعلان‌ها/نشست)
                                  ├─ Web Push (VAPID) ─> سرویس پوش مرورگر/گوشی
                                  └─ AI: قاعده‌محور | Claude (کلید فقط روی سرور)
```
- **دو Pool**: `appPool` با نقش `mana_app` (بدون BYPASSRLS) برای همه‌ی درخواست‌های کاربر؛ `sysPool` با نقش مالک جدول فقط برای ورود/نشست، scheduler و اسکریپت‌ها.
- هر درخواست در یک تراکنش اجرا می‌شود که `app.user_id` و `app.role` را (از نشست معتبر، نه از ورودی کاربر) تنظیم می‌کند؛ سیاست‌های RLS با آن‌ها تصمیم می‌گیرند.
- Backend ماژولار: `routes/{auth,parent,family,photos,notifications,ai}.ts`، `scheduler.ts`، `push.ts`، `ai.ts`، `rewards.ts`، `jalali.ts`.

## مدل داده (migrations/001–003)
| حوزه | جداول |
|---|---|
| هویت | `users`، `sessions`، `settings` |
| مانا (فقط والد) | `projects`، `tasks`، `events`، `transactions`، `budgets`، `debts`، `goals`، `habits`، `habit_logs`، `ai_proposals`، `audit_log` |
| کودکان | `child_settings`، `activities` (هفتگی یا یک‌بار)، `completions`، `star_ledger`، `badges`، `rewards`، `reward_claims`، `child_goals`، `photos` |
| اعلان | `notifications` (یکتا با `dedupe_key`)، `push_subscriptions` |

قراردادها: روز هفته 0=شنبه…6=جمعه؛ تاریخ‌ها میلادی در DB و شمسی در UI؛ مبلغ‌ها `bigint` تومان؛ ستاره‌ها دفتر کل (`star_ledger`) هستند و مانده = مجموع.

## ماتریس دسترسی
| منبع | مانا | سارینا | سامان |
|---|---|---|---|
| کارها، پروژه‌ها، رویدادها، مالی، اهداف، عادت‌ها، AI | خواندن/نوشتن | ✖ (۴۰۳ + RLS) | ✖ |
| برنامه/جوایز/اهداف هر کودک | خواندن/نوشتن | فقط خواندنِ مال خودش | فقط خواندنِ مال خودش |
| ثبت «انجام دادم» | تأیید/رد | فقط ایجاد ردیف `pending` برای خودش | فقط برای خودش |
| ستاره | ثبت/کسر | فقط خواندن | فقط خواندن |
| درخواست جایزه | تأیید/رد | فقط ایجاد درخواست برای خودش | همان |
| تصاویر | بارگذاری/حذف/پروفایل | فقط دیدنِ گالری خودش | فقط دیدنِ گالری خودش |
| اعلان‌ها | مشاهده‌ی تاریخچه‌ی همه | اعلان‌های خودش (دیده/انجام/تعویق) | همان |
| تنظیمات، رمز، حساب‌ها | همه | ✖ | ✖ |

## جریان‌های کلیدی
- **ثبت انجام فعالیت**: کودک → `completions(pending)` → مانا تأیید → `star_ledger(+stars)` → نشان‌ها.
- **اعلان**: scheduler از `activities/events/tasks/debts` ردیف `notifications` می‌سازد (آفست‌های −۱۵/۰/+۱۰ قابل تنظیم؛ «+۱۰» فقط اگر گزارش نشده؛ ساعت سکوت؛ پنجره‌ی ۱۰ دقیقه‌ای جبران) → Web Push + دریافت درون‌برنامه‌ای با polling ۲۰ ثانیه.
- **MANA AI**: متن → نیت ساختاریافته → `ai_proposals(pending)` → تأیید مانا → اجرا. گزارش‌ها (فقط‌خواندنی) بلافاصله پاسخ داده می‌شوند.
- **صدا**: TTS/STT مرورگر؛ تطبیق فرمان در `web/src/voice.ts` (`matchCommand`)؛ ثبت تغییر فقط پس از تأیید صوتی/لمسی.
