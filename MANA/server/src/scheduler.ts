import { sys } from './db.ts';
import { addDays, persianWeekday, tehranInstant, tehranParts, todayISO, toJalali } from './jalali.ts';
import { sendPush } from './push.ts';
import { fmtMoney } from './util.ts';

const GRACE_MIN = 10;      // a reminder is still delivered if the server was briefly down
const inQuiet = (mins: number, start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number); const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? mins >= s && mins < e : mins >= s || mins < e;
};
const hhmm = (d: Date) => { const p = tehranParts(d); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

async function enqueue(n: { user_id: string; kind: string; title: string; body: string; icon: string; due: Date; key: string; ref_type?: string; ref_id?: string; ref_day?: string; voice?: string }) {
  await sys(`INSERT INTO notifications (user_id,kind,title,body,icon,voice_text,due_at,dedupe_key,ref_type,ref_id,ref_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (dedupe_key) DO NOTHING`,
    [n.user_id, n.kind, n.title, n.body, n.icon, n.voice ?? n.body, n.due, n.key, n.ref_type ?? null, n.ref_id ?? null, n.ref_day ?? null]);
}

/** Push/in-app notification for a new chat message (throttled: at most one unseen chat notification per person per 5 minutes). */
export async function notifyChat(senderId: string, peerId: string | null, body: string) {
  const [snd] = await sys(`SELECT display_name FROM users WHERE id=$1`, [senderId]); if (!snd) return;
  const to = await sys(`SELECT u.id, u.role, u.permissions, s.notifications_enabled, s.quiet_start, s.quiet_end FROM users u LEFT JOIN child_settings s ON s.child_id=u.id
    WHERE u.active AND u.id <> $1 AND ($2::uuid IS NULL OR u.id = $2)`, [senderId, peerId]);
  const nowMin = tehranParts().minutes;
  for (const u of to) {
    if (u.role !== 'parent' && Number(u.permissions?.chat ?? 2) < 1) continue;
    if (u.role === 'child' && (!u.notifications_enabled || inQuiet(nowMin, u.quiet_start, u.quiet_end))) continue;
    const [recent] = await sys(`SELECT 1 FROM notifications WHERE user_id=$1 AND kind='chat' AND seen_at IS NULL AND done_at IS NULL AND due_at > now() - interval '5 minutes'`, [u.id]); if (recent) continue;
    await enqueue({ user_id: u.id, kind: 'chat', title: `💬 ${snd.display_name}${peerId ? '' : ' (گروه)'}`, body: body.slice(0, 100), icon: '💬', due: new Date(), key: `chat:${u.id}:${Date.now()}`, ref_type: 'chat' });
  }
}
/** Same notification for a list of recipients (used by wishes etc.). */
export async function notifyUsers(ids: string[], n: { kind: string; title: string; body: string; icon: string; key: string; ref_type?: string; ref_id?: string }) {
  for (const id of ids) await enqueue({ user_id: id, kind: n.kind, title: n.title, body: n.body, icon: n.icon, due: new Date(), key: `${n.key}:${id}`, ref_type: n.ref_type, ref_id: n.ref_id });
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
        const text = off < 0 ? `${k.display_name} جان، ${-off} دقیقه دیگر: ${a.title}` : off === 0 ? (a.notify_text ?? `${k.display_name} جان، وقت «${a.title}» است ${a.icon}`) : `${k.display_name} جان، «${a.title}» را انجام دادی؟`;
        await enqueue({ user_id: k.id, kind: 'activity', title: a.title, body: text, icon: a.icon, due, key: `act:${a.id}:${today}:${off}`, ref_type: 'activity', ref_id: a.id, ref_day: today });
      }
    }
  }
  // nightly reflection: one reminder per child per evening (skipped when already answered or inside quiet hours)
  for (const k of kids) {
    if (!k.reflection_enabled) continue;
    const due = tehranInstant(today, String(k.reflection_time).slice(0, 5));
    if (now < due || now.getTime() - due.getTime() > 45 * 60000 || inQuiet(nowP.minutes, k.quiet_start, k.quiet_end)) continue;
    const [done] = await sys(`SELECT 1 FROM reflection_entries WHERE user_id=$1 AND day=$2`, [k.id, today]); if (done) continue;
    await enqueue({ user_id: k.id, kind: 'reflection', title: 'مرور شبانه', body: `${k.display_name} جان، وقت مرور امروز و گفتن «خدایا شکرت» است 🌙`, icon: '🌙', due, key: `refl:${k.id}:${today}`, ref_type: 'reflection', ref_day: today,
      voice: `${k.display_name} جان، وقت مرور امروز است. بیا چند تا سؤال کوتاه جواب بدهیم و خدا را شکر کنیم.` });
  }
  // parent: events, task deadlines, installments, morning/night routines
  const [mom] = await sys(`SELECT id FROM users WHERE role='parent' AND active ORDER BY created_at LIMIT 1`);
  if (!mom) return;
  const events = await sys(`SELECT * FROM events WHERE starts_at BETWEEN now() - interval '10 minutes' AND now() + interval '1 day 1 hour'`);
  for (const e of events) for (const m of [0, ...(e.remind_minutes as number[])]) {
    const due = new Date(new Date(e.starts_at).getTime() - m * 60000);
    if (now < due || now.getTime() - due.getTime() > GRACE_MIN * 60000) continue;
    await enqueue({ user_id: mom.id, kind: 'event', title: e.title, body: m ? `${m} دقیقه دیگر: ${e.title} (${hhmm(new Date(e.starts_at))})` : `همین حالا: ${e.title}`, icon: '📅', due, key: `ev:${e.id}:${m}`, ref_type: 'event', ref_id: e.id });
  }
  const tasks = await sys(`SELECT * FROM tasks WHERE status IN ('todo','doing','waiting') AND due_date = $1 AND due_time IS NOT NULL`, [today]);
  for (const t of tasks) { const due = tehranInstant(today, t.due_time); if (now >= due && now.getTime() - due.getTime() <= GRACE_MIN * 60000) await enqueue({ user_id: mom.id, kind: 'task', title: t.title, body: `مهلت کار: ${t.title}`, icon: '✅', due, key: `task:${t.id}:${today}`, ref_type: 'task', ref_id: t.id }); }
  const debts = await sys(`SELECT * FROM debts WHERE status='open' AND next_due_date IN ($1,$2)`, [today, addDays(today, 3)]);
  for (const d of debts) { const due = tehranInstant(today, '09:00'); if (now >= due && now.getTime() - due.getTime() <= 4 * 3600000) await enqueue({ user_id: mom.id, kind: 'debt', title: d.title, body: `${d.next_due_date === today ? 'امروز' : 'سه روز دیگر'} سررسید: ${d.title}${d.installment_amount ? ' — ' + fmtMoney(d.installment_amount) + ' تومان' : ''}`, icon: '💳', due, key: `debt:${d.id}:${d.next_due_date}:${d.next_due_date === today ? 0 : 3}`, ref_type: 'debt', ref_id: d.id }); }
  const at = (h: string) => tehranInstant(today, h);
  if (now >= at('07:00') && now.getTime() - at('07:00').getTime() <= 3 * 3600000) {
    const top = await sys(`SELECT title FROM tasks WHERE status IN ('todo','doing') ORDER BY priority, due_date NULLS LAST LIMIT 3`);
    const [{ ev }] = await sys(`SELECT count(*)::int ev FROM events WHERE starts_at::timestamptz >= $1 AND starts_at < $2`, [at('00:00'), at('23:59')]);
    await enqueue({ user_id: mom.id, kind: 'morning', title: 'مرور صبحگاهی', icon: '🌅', due: at('07:00'), key: `morning:${today}`, body: `${ev} جلسه/قرار امروز. سه اولویت: ${top.map((t: any, i: number) => `${i + 1}) ${t.title}`).join(' ، ') || 'کاری ثبت نشده'}` });
  }
  if (now >= at('22:00') && now.getTime() - at('22:00').getTime() <= 3 * 3600000) {
    const [r] = await sys(`SELECT count(*) FILTER (WHERE status='done' AND done_at >= $1)::int done, count(*) FILTER (WHERE status IN ('todo','doing','waiting') AND due_date <= $2)::int left FROM tasks`, [at('00:00'), today]);
    const [sp] = await sys(`SELECT COALESCE(SUM(amount),0)::bigint s FROM transactions WHERE kind='expense' AND occurred_on=$1`, [today]);
    await enqueue({ user_id: mom.id, kind: 'night', title: 'جمع‌بندی شبانه', icon: '🌙', due: at('22:00'), key: `night:${today}`, body: `${r.done} کار انجام شد، ${r.left} کار ناتمام. هزینه امروز: ${fmtMoney(sp.s)} تومان. برای فردا برنامه بریز.` });
  }
  // ----- weekly family report (Friday evening), wish-board refresh, annual dates -----
  if (wd === 6 && now >= at('18:00') && now.getTime() - at('18:00').getTime() <= 3 * 3600000)
    await enqueue({ user_id: mom.id, kind: 'weekly_report', title: 'گزارش هفتگی خانواده', body: 'گزارش این هفته آماده است: ستاره‌ها، مرور شبانه، مالی و نکته‌های پیشنهادی.', icon: '📊', due: at('18:00'), key: `weekly:${today}`, ref_type: 'weekly_report' });
  if (now >= at('09:00') && now.getTime() - at('09:00').getTime() <= 4 * 3600000) {
    const boards = await sys(`SELECT b.id, b.user_id, u.display_name, u.role FROM wish_boards b JOIN users u ON u.id=b.user_id WHERE NOT b.archived AND u.active AND (b.starts_on + (b.refresh_months || ' months')::interval)::date <= $1`, [today]);
    for (const b of boards) {
      await enqueue({ user_id: b.user_id, kind: 'wish_refresh', title: 'وقت به‌روزرسانی تابلو آرزوها', body: 'چند ماه گذشته! آرزوهای تازه اضافه کن و آن‌هایی را که به آن‌ها رسیده‌ای تیک بزن 🌠', icon: '🌠', due: at('09:00'), key: `wishrefresh:${b.id}`, ref_type: 'wishes' });
      if (b.role === 'child') await enqueue({ user_id: mom.id, kind: 'wish_refresh', title: `تابلو آرزوهای ${b.display_name}`, body: 'زمان به‌روزرسانی تابلو رسیده است؛ یک گفتگوی خوب درباره‌ی آرزوهایش داشته باشید.', icon: '🌠', due: at('09:00'), key: `wishrefresh-mom:${b.id}`, ref_type: 'wishes' });
    }
    const j = toJalali(today); const j3 = toJalali(addDays(today, 3));
    const dates = await sys(`SELECT d.*, u.display_name AS person FROM family_dates d LEFT JOIN users u ON u.id=d.person_id WHERE d.notify AND ((d.jm=$1 AND d.jd=$2) OR (d.jm=$3 AND d.jd=$4))`, [j.jm, j.jd, j3.jm, j3.jd]);
    const everyone = await sys(`SELECT id, role FROM users WHERE active`);
    for (const d of dates) {
      const isToday = d.jm === j.jm && d.jd === j.jd; const icon = d.kind === 'birthday' ? '🎂' : d.kind === 'anniversary' ? '💍' : '🎉';
      for (const u of everyone) {
        if (!isToday && u.role === 'child') continue;                // 3-day heads-up only for adults
        await enqueue({ user_id: u.id, kind: 'family_date', title: d.title, body: isToday ? `امروز: ${d.title} ${icon}` : `۳ روز دیگر: ${d.title} ${icon}`, icon, due: at('09:00'), key: `fd:${d.id}:${isToday ? today : addDays(today, 3)}:${u.id}`, ref_type: 'family_date' });
      }
    }
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
