import { sys } from './db.ts';
import { addDays, persianWeekday, tehranInstant, tehranParts, toFaDigits, todayISO } from './jalali.ts';
import { sendPush } from './push.ts';
import { runBackup, todaysBackupExists } from './backup.ts';
import { fmtMoney } from './util.ts';

const GRACE_MIN = 10;      // a reminder is still delivered if the server was briefly down
const inQuiet = (mins: number, start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number); const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
};
const hhmm = (d: Date) => { const p = tehranParts(d); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

async function enqueue(n: { user_id: string; kind: string; title: string; body: string; icon: string; due: Date; key: string; ref_type?: string; ref_id?: string; ref_day?: string; ref_slot?: string; voice?: string }) {
  await sys(`INSERT INTO notifications (user_id,kind,title,body,icon,voice_text,due_at,dedupe_key,ref_type,ref_id,ref_day,ref_slot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.user_id, n.kind, n.title, n.body, n.icon, n.voice ?? n.body, n.due, n.key, n.ref_type ?? null, n.ref_id ?? null, n.ref_day ?? null, n.ref_slot ?? null]);
}

/** Builds due notifications from schedules. Idempotent thanks to dedupe_key. */
export async function generate(now = new Date()) {
  const today = todayISO(); const wd = persianWeekday(today); const nowP = tehranParts(now);
  const kids = await sys(`SELECT u.id, u.display_name, s.* FROM users u JOIN child_settings s ON s.child_id=u.id WHERE u.active AND u.role='child' AND s.notifications_enabled`);
  for (const k of kids) {
    const acts = await sys(`SELECT * FROM activities WHERE child_id=$1 AND active AND notify AND start_time IS NOT NULL AND (($2 = ANY(weekdays)) OR on_date=$3)`, [k.id, wd, today]);
    for (const a of acts) {
      const start = tehranInstant(today, a.start_time);
      for (const off of (a.remind_offsets ?? k.reminder_offsets) as number[]) {
        const due = new Date(start.getTime() + off * 60000);
        if (now < due || now.getTime() - due.getTime() > GRACE_MIN * 60000) continue;
        if (inQuiet(nowP.minutes, k.quiet_start, k.quiet_end)) continue;
        if (off > 0) { // "not done yet" nudge only when nothing was reported
          const [c] = await sys(`SELECT 1 FROM completions WHERE activity_id=$1 AND day=$2`, [a.id, today]); if (c) continue;
        }
        const text = off < 0 ? `${k.display_name} جان، ${toFaDigits(-off)} دقیقه دیگر: ${a.title}` : off === 0 ? (a.notify_text ?? `${k.display_name} جان، وقت «${a.title}» است ${a.icon}`) : `${k.display_name} جان، «${a.title}» را انجام دادی؟`;
        await enqueue({ user_id: k.id, kind: 'activity', title: a.title, body: text, icon: a.icon, due, key: `act:${a.id}:${today}:${off}`, ref_type: 'activity', ref_id: a.id, ref_day: today });
      }
    }
    // weekly pocket money (idempotent via ref_key)
    if (k.allowance_amount > 0 && k.allowance_weekday === wd && nowP.minutes >= 8 * 60) {
      const ins = await sys(`INSERT INTO wallet_ledger (child_id, delta, reason, ref_key) VALUES ($1,$2,'پول‌توجیبی هفتگی',$3) ON CONFLICT (ref_key) DO NOTHING RETURNING id`, [k.id, k.allowance_amount, `allow:${k.id}:${today}`]);
      if (ins.length) await enqueue({ user_id: k.id, kind: 'allowance', title: 'پول‌توجیبی', body: `${k.display_name} جان، پول‌توجیبی این هفته‌ات اضافه شد: ${fmtMoney(k.allowance_amount)} تومان 💰`, icon: '💰', due: now, key: `allowance:${k.id}:${today}` });
    }
    // habits & medicine reminders (medicine ignores quiet hours; unreported doses get one nudge after 15 min)
    const routines = await sys(`SELECT * FROM routines WHERE child_id=$1 AND active AND notify AND cardinality(times) > 0 AND (weekdays IS NULL OR $2 = ANY(weekdays))
      AND (start_date IS NULL OR start_date <= $3) AND (end_date IS NULL OR end_date >= $3)`, [k.id, wd, today]);
    for (const r of routines) for (const slot of r.times as string[]) for (const off of r.kind === 'medicine' ? [0, 15] : [0]) {
      const due = new Date(tehranInstant(today, slot).getTime() + off * 60000);
      if (now < due || now.getTime() - due.getTime() > GRACE_MIN * 60000) continue;
      if (r.kind !== 'medicine' && inQuiet(nowP.minutes, k.quiet_start, k.quiet_end)) continue;
      const [lg] = await sys(`SELECT 1 FROM routine_logs WHERE routine_id=$1 AND day=$2 AND slot=$3`, [r.id, today, slot]); if (lg) continue;
      const body = off === 0 ? (r.kind === 'medicine' ? `${k.display_name} جان، وقت مصرف ${r.title}${r.dose ? ' (' + r.dose + ')' : ''} است ${r.icon}` : `${k.display_name} جان، وقت «${r.title}» است ${r.icon}`) : `${k.display_name} جان، «${r.title}» را مصرف کردی؟`;
      await enqueue({ user_id: k.id, kind: 'routine', title: r.title, body, icon: r.icon, due, key: `rt:${r.id}:${today}:${slot}:${off}`, ref_type: 'routine', ref_id: r.id, ref_day: today, ref_slot: slot });
    }
  }
  // parent: events, task deadlines, installments, morning/night routines
  const [mom] = await sys(`SELECT id FROM users WHERE role='parent' AND active ORDER BY created_at LIMIT 1`);
  if (!mom) return;
  const events = await sys(`SELECT * FROM events WHERE starts_at BETWEEN now() - interval '10 minutes' AND now() + interval '1 day 1 hour'`);
  for (const e of events) for (const m of [0, ...(e.remind_minutes as number[])]) {
    const due = new Date(new Date(e.starts_at).getTime() - m * 60000);
    if (now < due || now.getTime() - due.getTime() > GRACE_MIN * 60000) continue;
    await enqueue({ user_id: mom.id, kind: 'event', title: e.title, body: m ? `${toFaDigits(m)} دقیقه دیگر: ${e.title} (${toFaDigits(hhmm(new Date(e.starts_at)))})` : `همین حالا: ${e.title}`, icon: '📅', due, key: `ev:${e.id}:${m}`, ref_type: 'event', ref_id: e.id });
  }
  const tasks = await sys(`SELECT * FROM tasks WHERE status IN ('todo','doing','waiting') AND due_date = $1 AND due_time IS NOT NULL`, [today]);
  for (const t of tasks) { const due = tehranInstant(today, t.due_time); if (now >= due && now.getTime() - due.getTime() <= GRACE_MIN * 60000) await enqueue({ user_id: mom.id, kind: 'task', title: t.title, body: `مهلت کار: ${t.title}`, icon: '✅', due, key: `task:${t.id}:${today}`, ref_type: 'task', ref_id: t.id }); }
  const debts = await sys(`SELECT * FROM debts WHERE status='open' AND next_due_date IN ($1,$2)`, [today, addDays(today, 3)]);
  for (const d of debts) { const due = tehranInstant(today, '09:00'); if (now >= due && now.getTime() - due.getTime() <= 4 * 3600000) await enqueue({ user_id: mom.id, kind: 'debt', title: d.title, body: `${d.next_due_date === today ? 'امروز' : 'سه روز دیگر'} سررسید: ${d.title}${d.installment_amount ? ' — ' + fmtMoney(d.installment_amount) + ' تومان' : ''}`, icon: '💳', due, key: `debt:${d.id}:${d.next_due_date}:${d.next_due_date === today ? 0 : 3}`, ref_type: 'debt', ref_id: d.id }); }
  const at = (h: string) => tehranInstant(today, h);
  // nightly backup at 03:00 (once per day)
  if (nowP.hour >= 3 && process.env.BACKUP_AUTO !== 'off' && !todaysBackupExists(today.replace(/-/g, ''))) {
    try { await runBackup(); } catch (e: any) { await enqueue({ user_id: mom.id, kind: 'backup', title: 'پشتیبان‌گیری ناموفق بود', body: `پشتیبان‌گیری خودکار انجام نشد: ${String(e.message).slice(0, 120)}`, icon: '⚠️', due: now, key: `backupfail:${today}` }); }
  }
  // Friday 18:00 weekly report for Mana
  if (wd === 6 && now >= at('18:00') && now.getTime() - at('18:00').getTime() <= 4 * 3600000) {
    const kidsRows = await sys(`SELECT u.display_name, COALESCE((SELECT SUM(delta) FROM star_ledger s WHERE s.child_id=u.id AND delta>0 AND s.at > now() - interval '7 days'),0)::int stars, (SELECT count(*)::int FROM routine_logs l WHERE l.child_id=u.id AND l.day > current_date - 7) habits FROM users u WHERE u.role='child' AND u.active ORDER BY u.display_name`);
    const [t] = await sys(`SELECT count(*) FILTER (WHERE status='done' AND done_at > now() - interval '7 days')::int done, count(*) FILTER (WHERE status IN ('todo','doing','waiting'))::int open FROM tasks`);
    const [rq] = await sys(`SELECT count(*)::int n FROM purchase_requests WHERE status='requested'`);
    const [sp] = await sys(`SELECT COALESCE(SUM(amount),0)::bigint s FROM transactions WHERE kind='expense' AND occurred_on > $1`, [addDays(today, -7)]);
    await enqueue({ user_id: mom.id, kind: 'weekly', title: 'گزارش هفتگی خانواده', icon: '📊', due: at('18:00'), key: `weekly:${today}`,
      body: `${kidsRows.map((k: any) => `${k.display_name}: ${toFaDigits(k.stars)} ستاره، ${toFaDigits(k.habits)} عادت`).join(' | ')} — کار انجام‌شده: ${toFaDigits(t.done)}، باز: ${toFaDigits(t.open)} — درخواست خرید منتظر: ${toFaDigits(rq.n)} — هزینه‌ی هفته: ${fmtMoney(sp.s)} تومان` });
  }
  if (now >= at('07:00') && now.getTime() - at('07:00').getTime() <= 3 * 3600000) {
    const top = await sys(`SELECT title FROM tasks WHERE status IN ('todo','doing') ORDER BY priority, due_date NULLS LAST LIMIT 3`);
    const [{ ev }] = await sys(`SELECT count(*)::int ev FROM events WHERE starts_at::timestamptz >= $1 AND starts_at < $2`, [at('00:00'), at('23:59')]);
    await enqueue({ user_id: mom.id, kind: 'morning', title: 'مرور صبحگاهی', icon: '🌅', due: at('07:00'), key: `morning:${today}`, body: `${toFaDigits(ev)} جلسه/قرار امروز. سه اولویت: ${top.map((t: any, i: number) => `${toFaDigits(i + 1)}) ${t.title}`).join(' ، ') || 'کاری ثبت نشده'}` });
  }
  if (now >= at('22:00') && now.getTime() - at('22:00').getTime() <= 3 * 3600000) {
    const [r] = await sys(`SELECT count(*) FILTER (WHERE status='done' AND done_at >= $1)::int done, count(*) FILTER (WHERE status IN ('todo','doing','waiting') AND due_date <= $2)::int left FROM tasks`, [at('00:00'), today]);
    const [sp] = await sys(`SELECT COALESCE(SUM(amount),0)::bigint s FROM transactions WHERE kind='expense' AND occurred_on=$1`, [today]);
    await enqueue({ user_id: mom.id, kind: 'night', title: 'جمع‌بندی شبانه', icon: '🌙', due: at('22:00'), key: `night:${today}`, body: `${toFaDigits(r.done)} کار انجام شد، ${toFaDigits(r.left)} کار ناتمام. هزینه امروز: ${fmtMoney(sp.s)} تومان. برای فردا برنامه بریز.` });
  }
}

/** Sends push for delivered-but-unsent notifications. In-app delivery happens via polling regardless. */
export async function deliver() {
  const rows = await sys(`SELECT id,user_id,title,body,icon FROM notifications WHERE due_at <= now() AND sent_at IS NULL ORDER BY due_at LIMIT 50`);
  for (const n of rows) {
    const status = await sendPush(n.user_id, { id: n.id, title: n.title, body: n.body, icon: n.icon, url: '/' });
    await sys(`UPDATE notifications SET sent_at=now(), push_status=$2 WHERE id=$1`, [n.id, status]);
  }
}
export function startScheduler(log: { info: Function; error: Function }) {
  const tick = async () => { try { await generate(); await deliver(); } catch (e) { log.error(e, 'scheduler tick failed'); } };
  const h = setInterval(tick, 30_000); void tick(); log.info('scheduler started (30s)');
  return () => clearInterval(h);
}
