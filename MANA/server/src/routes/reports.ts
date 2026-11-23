import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent } from '../auth.ts';
import { withActor, type Q } from '../db.ts';
import { addDays, fmtJalali, persianWeekday, todayISO, toFaDigits } from '../jalali.ts';
import { fmtMoney, zDate } from '../util.ts';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const weekStartOf = (iso: string) => addDays(iso, -persianWeekday(iso));   // weeks run Saturday..Friday

/** Rule-based weekly report (no AI): numbers from the database + simple, explainable highlights. */
export async function buildWeekly(q: Q, weekStart: string) {
  const end = addDays(weekStart, 6); const today = todayISO(); const lastDay = end < today ? end : today;
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => d <= lastDay);
  const prevStart = addDays(weekStart, -7), prevEnd = addDays(weekStart, -1);
  const kidsRows = await q(`SELECT u.id, u.display_name, s.reflection_enabled FROM users u JOIN child_settings s ON s.child_id=u.id WHERE u.role='child' AND u.active ORDER BY u.display_name`);
  const kids: any[] = []; const highlights: string[] = [];
  for (const k of kidsRows) {
    const acts = await q(`SELECT weekdays, on_date FROM activities WHERE child_id=$1 AND active`, [k.id]);
    const planned = days.reduce((n, d) => n + acts.filter((a: any) => a.on_date === d || (a.on_date === null && (a.weekdays ?? []).includes(persianWeekday(d)))).length, 0);
    const [c] = await q(`SELECT count(*) FILTER (WHERE status='approved')::int approved, count(*) FILTER (WHERE status='pending')::int pending, count(*) FILTER (WHERE status='rejected')::int rejected FROM completions WHERE child_id=$1 AND day BETWEEN $2 AND $3`, [k.id, weekStart, end]);
    const [st] = await q(`SELECT COALESCE(SUM(delta) FILTER (WHERE delta>0),0)::int earned, COALESCE(SUM(delta) FILTER (WHERE delta<0),0)::int spent FROM star_ledger WHERE child_id=$1 AND (at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $2 AND $3`, [k.id, weekStart, end]);
    const badges = await q(`SELECT title, icon FROM badges WHERE child_id=$1 AND (awarded_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $2 AND $3`, [k.id, weekStart, end]);
    const refl = await q(`SELECT day, answers FROM reflection_entries WHERE user_id=$1 AND day BETWEEN $2 AND $3 ORDER BY day`, [k.id, weekStart, end]);
    const pick = (re: RegExp) => refl.flatMap((r: any) => (r.answers as any[]).filter((a) => a.a && re.test(a.q)).map((a) => ({ day: r.day, text: a.a })));
    const diary = await q(`SELECT mood FROM diary_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3`, [k.id, weekStart, end]);
    const moods: Record<string, number> = {}; diary.forEach((d: any) => { if (d.mood) moods[d.mood] = (moods[d.mood] ?? 0) + 1; });
    const [w] = await q(`SELECT count(*) FILTER (WHERE (achieved_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $2 AND $3)::int achieved, count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $2 AND $3)::int added FROM wishes WHERE user_id=$1`, [k.id, weekStart, end]);
    const achieved = await q(`SELECT title FROM wishes WHERE user_id=$1 AND (achieved_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $2 AND $3`, [k.id, weekStart, end]);
    const reported = c.approved + c.pending; const rate = pct(c.approved, planned);
    const sad = pick(/ناراحت/);
    const kid = { id: k.id, name: k.display_name, planned, approved: c.approved, pending: c.pending, rejected: c.rejected, rate, stars_earned: st.earned, stars_spent: -st.spent, badges, reflection_days: refl.length, reflection_enabled: k.reflection_enabled, diary_entries: diary.length, moods,
      happy: pick(/خوشحال/), sad, learned: pick(/یاد گرفتی/), helped: pick(/کمک/), gratitude: refl.flatMap((r: any) => (r.answers as any[]).filter((a) => a.a && a.kind === 'gratitude').map((a) => ({ day: r.day, text: a.a }))), wishes_added: w.added, wishes_achieved: achieved.map((x: any) => x.title) };
    kids.push(kid);
    if (planned >= 3 && rate !== null && rate < 50) highlights.push(`${k.display_name}: فقط ${toFaDigits(rate)}٪ فعالیت‌های برنامه‌ریزی‌شده‌ی این هفته تأیید شده (${toFaDigits(c.approved)} از ${toFaDigits(planned)}${c.pending ? `، ${toFaDigits(c.pending)} هنوز منتظر تأیید شماست` : ''}). شاید برنامه سنگین است یا باید گفتگو کنید.`);
    else if (c.pending > 0) highlights.push(`${k.display_name}: ${toFaDigits(c.pending)} فعالیت گزارش‌شده هنوز منتظر تأیید شماست.`);
    if (k.reflection_enabled && days.length >= 4 && refl.length < Math.ceil(days.length / 2)) highlights.push(`${k.display_name} فقط ${toFaDigits(refl.length)} شب از ${toFaDigits(days.length)} شب مرور شبانه را انجام داد؛ شاید ساعت یادآوری را عوض کنید.`);
    if (sad.length) highlights.push(`${k.display_name} در ${toFaDigits(sad.length)} شب از چیزهایی ناراحت‌کننده نوشته؛ جواب‌ها را در «خانواده ← مرور و دفترچه» بخوانید و در صورت صلاح گفتگو کنید.`);
    if (achieved.length) highlights.push(`🎉 ${k.display_name} به ${achieved.map((x: any) => `«${x.title}»`).join('، ')} رسید.`);
    if (badges.length) highlights.push(`🏅 ${k.display_name} مدال گرفت: ${badges.map((b: any) => b.title).join('، ')}.`);
    void reported;
  }
  const [t] = await q(`SELECT count(*) FILTER (WHERE status='done' AND (done_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $1 AND $2)::int done, count(*) FILTER (WHERE status IN ('todo','doing','waiting') AND due_date < $3)::int overdue, count(*) FILTER (WHERE status IN ('todo','doing','waiting'))::int open FROM tasks`, [weekStart, end, today]);
  const [fin] = await q(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='income'),0)::bigint income, COALESCE(SUM(amount) FILTER (WHERE kind='expense'),0)::bigint expense FROM transactions WHERE occurred_on BETWEEN $1 AND $2`, [weekStart, end]);
  const [pf] = await q(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='expense'),0)::bigint expense FROM transactions WHERE occurred_on BETWEEN $1 AND $2`, [prevStart, prevEnd]);
  const cats = await q(`SELECT category, SUM(amount)::bigint total FROM transactions WHERE kind='expense' AND occurred_on BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, [weekStart, end]);
  const nextStart = addDays(end, 1);
  const events = await q(`SELECT title, starts_at FROM events WHERE (starts_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $1 AND $2 ORDER BY starts_at LIMIT 8`, [nextStart, addDays(nextStart, 6)]);
  const debts = await q(`SELECT title, next_due_date, installment_amount AS amount FROM debts WHERE status='open' AND next_due_date BETWEEN $1 AND $2 ORDER BY next_due_date`, [nextStart, addDays(nextStart, 6)]);
  const [mm] = await q(`SELECT count(*)::int sent, count(*) FILTER (WHERE read_at IS NOT NULL)::int read FROM mom_messages WHERE msg_date BETWEEN $1 AND $2`, [weekStart, end]);
  const [ch] = await q(`SELECT count(*)::int n FROM chat_messages WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN $1 AND $2 AND peer_id IS NULL`, [weekStart, end]);
  if (Number(fin.expense) > 0 && Number(pf.expense) > 0 && Number(fin.expense) > Number(pf.expense) * 1.3) highlights.push(`💰 هزینه‌ی این هفته (${toFaDigits(fmtMoney(Number(fin.expense)))}) بیش از ۳۰٪ از هفته‌ی قبل بیشتر است.`);
  if (t.overdue > 0) highlights.push(`✅ ${toFaDigits(t.overdue)} کار عقب‌افتاده دارید.`);
  if (mm.sent === 0 && kidsRows.length) highlights.push('💌 این هفته برای بچه‌ها پیام مامان ننوشته‌اید.');
  if (!highlights.length) highlights.push('این هفته مورد هشداردهنده‌ای ثبت نشد.');
  return { week_start: weekStart, week_end: end, week_fa: `${fmtJalali(weekStart)} تا ${fmtJalali(end)}`, days: days.length, kids, highlights,
    family: { tasks: t, finance: { income: Number(fin.income), expense: Number(fin.expense), prev_expense: Number(pf.expense), top_categories: cats.map((c: any) => ({ category: c.category, total: Number(c.total) })) }, next_events: events, next_debts: debts.map((d: any) => ({ ...d, amount: d.amount === null ? null : Number(d.amount) })), mom_messages: mm, chat_group_messages: ch.n },
    note: 'این گزارش قاعده‌محور است (بدون تحلیل هوش مصنوعی): اعداد از پایگاه داده و نکته‌ها از قاعده‌های ساده‌ی قابل‌ردیابی می‌آیند.' };
}

export default async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports/weekly', { preHandler: requireParent }, async (req) => {
    const { week_start } = z.object({ week_start: zDate.optional() }).parse(req.query);
    const ws = weekStartOf(week_start ?? todayISO());
    return withActor(req.actor!, (q) => buildWeekly(q, ws));
  });
}
