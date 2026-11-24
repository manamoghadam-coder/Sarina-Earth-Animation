// TEST DATA ONLY. Creates the three accounts and sample data. Real private data must be entered through the app.
import crypto from 'node:crypto';
import { sys, sysPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';

const [{ n }] = await sys<{ n: number }>('SELECT count(*)::int n FROM users');
if (n > 0 && process.argv[2] !== '--force') { console.log('users already exist; use --force to add sample data anyway'); process.exit(0); }
const pw = () => crypto.randomBytes(9).toString('base64url');
const accounts = [
  { username: 'mana', name: 'مانا', role: 'parent', password: process.env.SEED_MANA_PASSWORD ?? pw() },
  { username: 'vahid', name: 'وحید', role: 'member', password: process.env.SEED_VAHID_PASSWORD ?? pw() },
  { username: 'sarina', name: 'سارینا', role: 'child', password: process.env.SEED_SARINA_PASSWORD ?? pw() },
  { username: 'saman', name: 'سامان', role: 'child', password: process.env.SEED_SAMAN_PASSWORD ?? pw() },
];
const ids: Record<string, string> = {};
for (const a of accounts) {
  const [u] = await sys(`INSERT INTO users (username, display_name, role, password_hash, age_group) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [a.username, a.name, a.role, await hashPassword(a.password), a.role === 'child' ? (a.username === 'saman' ? 'young' : 'teen') : 'adult']);
  ids[a.username] = u.id;
  if (a.role === 'child') await sys('INSERT INTO child_settings (child_id, voice_notifications, read_aloud_default) VALUES ($1,$2,$2)', [u.id, a.username === 'saman']);
}
const act = (c: string, title: string, kind: string, icon: string, weekdays: number[], s: string | null, e: string | null, stars: number, text?: string) =>
  sys(`INSERT INTO activities (child_id,title,kind,icon,weekdays,start_time,end_time,stars,notify,notify_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$6::time IS NOT NULL,$9)`, [ids[c], title, kind, icon, weekdays, s, e, stars, text ?? null]);
// Sarina (6th grade). Class times from the brief; daily-routine times are SAMPLE values the mother should adjust.
await act('sarina', 'کلاس رقص', 'class', '💃', [1, 3], '17:00', '19:30', 5);
await act('sarina', 'کلاس فن بیان', 'class', '🎤', [2], '18:45', '20:00', 5);
await act('sarina', 'شاهنامه‌خوانی', 'class', '📜', [4], null, null, 5);            // time not provided in brief -> no notification until set
await act('sarina', 'مطالعه روزانه (۵ صفحه)', 'reading', '📖', [0, 1, 2, 3, 4, 5], '16:00', '16:30', 3, 'وقت مطالعه روزانه‌ات رسیده! 📖');
await act('sarina', 'تمرین سنتور', 'music', '🎵', [0, 1, 2, 3, 4, 5], '15:30', '16:00', 5, 'سارینا جان، وقت تمرین سنتوره! 🎵');
await act('sarina', 'انجام تکالیف و مرور دروس', 'homework', '✏️', [0, 1, 2, 3, 4], '14:30', '15:30', 5);
await act('sarina', 'تمرین زبان', 'language', '🔤', [0, 2, 4], '20:15', '20:45', 3);
// Saman
await act('saman', 'تکالیف', 'homework', '✏️', [0, 1, 2, 3, 4], '16:00', '16:30', 5, 'سامان جان، وقت انجام تکالیفته! ✏️');
await act('saman', 'تمرین نوشتن و خواندن', 'writing', '🖍️', [0, 1, 2, 3, 4], '17:00', '17:30', 5, 'الان ساعت پنج عصره. وقت تمرین نوشتنه. آماده‌ای شروع کنیم؟');
await act('saman', 'کتاب خواندن', 'reading', '📚', [0, 1, 2, 3, 4, 5], '18:00', '18:20', 3, 'وقت کتاب خوندنه! 📚');
await act('saman', 'قصه', 'story', '🐻', [0, 1, 2, 3, 4, 5, 6], '20:00', '20:20', 2, 'وقت قصه‌های قشنگه! 🐻');
await act('saman', 'مرتب کردن اتاق', 'chore', '🧸', [0, 1, 2, 3, 4, 5, 6], '19:00', '19:15', 3);
for (const [c, t, i, s] of [['sarina', 'انتخاب فیلم خانوادگی', '🎬', 40], ['sarina', 'خرید یک کتاب', '📕', 80], ['saman', 'انتخاب فیلم خانوادگی', '🎬', 30], ['saman', 'تفریح آخر هفته', '🎡', 100]] as const)
  await sys('INSERT INTO rewards (child_id,title,icon,cost_stars) VALUES ($1,$2,$3,$4)', [ids[c], t, i, s]);
await sys(`INSERT INTO child_goals (child_id,title,icon,target_stars) VALUES ($1,'جمع کردن ۱۰۰ ستاره','🌟',100), ($2,'جمع کردن ۵۰ ستاره','🌟',50)`, [ids.sarina, ids.saman]);
// Parent sample data (FAKE)
await sys(`INSERT INTO tasks (title, priority, status, due_date) VALUES ('نمونه: تهیه گزارش هفتگی',1,'todo', current_date + 1), ('نمونه: پیگیری قرارداد',2,'doing', current_date + 3)`);
await sys(`INSERT INTO habits (title) VALUES ('ورزش ۳۰ دقیقه'), ('مطالعه ۲۰ صفحه')`);
await sys(`INSERT INTO goals (title,horizon,progress) VALUES ('نمونه: یادگیری زبان',  'learning', 20)`);
await sys(`INSERT INTO transactions (kind, amount, category, occurred_on, note) VALUES ('income', 30000000, 'حقوق', current_date - 5, 'نمونه'), ('expense', 800000, 'خانه', current_date - 1, 'نمونه')`);
await sys(`INSERT INTO debts (title, type, total_amount, installment_amount, next_due_date, remaining_installments) VALUES ('نمونه: قسط وسیله', 'installment', 12000000, 2000000, current_date + 4, 6)`);
console.log('\n=== TEST ACCOUNTS (shown once; store them securely) ===');
for (const a of accounts) console.log(`${a.username.padEnd(8)} ${a.password}`);
await sysPool.end();
