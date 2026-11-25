import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requirePerm, requireUser, hashPassword, revokeAll } from '../auth.ts';
import { withActor } from '../db.ts';
import { addDays, fmtJalali, persianWeekday, todayISO } from '../jalali.ts';
import { balanceOf, decideCompletion, awardBadges } from '../rewards.ts';
import { crud, zDate, zId, zText, zTime } from '../util.ts';

const kinds = ['homework', 'study', 'class', 'music', 'language', 'reading', 'chore', 'story', 'writing', 'game', 'other'] as const;
export const activitySchema = z.object({
  child_id: zId, title: zText(), kind: z.enum(kinds).optional(), description: z.string().max(1000).nullable().optional(), icon: z.string().max(8).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).nullable().optional(), on_date: zDate.nullable().optional(),
  start_time: zTime.nullable().optional(), end_time: zTime.nullable().optional(), stars: z.number().int().min(0).max(100).optional(),
  notify: z.boolean().optional(), notify_text: z.string().max(200).nullable().optional(), remind_offsets: z.array(z.number().int().min(-240).max(240)).max(5).nullable().optional(), active: z.boolean().optional(),
});


/** Optional starter content for a child's account (idempotent: only adds what is missing, by title). Times are SAMPLE values for Mana to adjust. */
const SAMPLE = {
  teen: {
    activities: [['کلاس رقص', 'class', '💃', [1, 3], '17:00', '19:30', 5], ['کلاس فن بیان', 'class', '🎤', [2], '18:45', '20:00', 5], ['شاهنامه‌خوانی', 'class', '📜', [4], null, null, 5],
      ['مطالعه روزانه (۵ صفحه)', 'reading', '📖', [0, 1, 2, 3, 4, 5], '16:00', '16:30', 3], ['تمرین سنتور', 'music', '🎵', [0, 1, 2, 3, 4, 5], '15:30', '16:00', 5],
      ['انجام تکالیف و مرور دروس', 'homework', '✏️', [0, 1, 2, 3, 4], '14:30', '15:30', 5], ['تمرین زبان', 'language', '🔤', [0, 2, 4], '20:15', '20:45', 3]],
    routines: [['habit', 'مسواک زدن', '🪥', ['08:00', '21:00']], ['habit', 'نظافت اتاق', '🧹', ['17:30']], ['habit', 'روتین پوستی', '🧴', ['21:30']], ['habit', 'نوشیدن آب', '💧', ['10:00', '14:00', '18:00']]],
    rewards: [['انتخاب فیلم خانوادگی', '🎬', 40], ['خرید یک کتاب', '📕', 80], ['تفریح آخر هفته', '🎡', 100]], goals: [['جمع کردن ۱۰۰ ستاره', '🌟', 100]],
  },
  young: {
    activities: [['تکالیف', 'homework', '✏️', [0, 1, 2, 3, 4], '16:00', '16:30', 5], ['تمرین نوشتن و خواندن', 'writing', '🖍️', [0, 1, 2, 3, 4], '17:00', '17:30', 5], ['کتاب خواندن', 'reading', '📚', [0, 1, 2, 3, 4, 5], '18:00', '18:20', 3],
      ['قصه', 'story', '🐻', [0, 1, 2, 3, 4, 5, 6], '20:00', '20:20', 2], ['مرتب کردن اتاق', 'chore', '🧸', [0, 1, 2, 3, 4, 5, 6], '19:00', '19:15', 3]],
    routines: [['habit', 'مسواک زدن', '🪥', ['08:00', '20:30']], ['habit', 'مرتب کردن اسباب‌بازی‌ها', '🧸', ['18:30']], ['habit', 'نوشیدن آب', '💧', ['10:00', '14:00']]],
    rewards: [['انتخاب فیلم خانوادگی', '🎬', 30], ['تفریح آخر هفته', '🎡', 100], ['یک بستنی', '🍦', 20]], goals: [['جمع کردن ۵۰ ستاره', '🌟', 50]],
  },
} as const;

export default async function familyRoutes(app: FastifyInstance) {
  // ----- parent: children overview -----
  app.get('/api/children', { preHandler: requirePerm('children', 1) }, async (req) => withActor(req.actor!, async (q) => {
    const kids = await q(`SELECT u.id, u.username, u.display_name, u.avatar_photo_id, u.active, s.* FROM users u JOIN child_settings s ON s.child_id=u.id WHERE u.role='child' ORDER BY u.display_name`);
    for (const k of kids) k.balance = await balanceOf(q, k.id);
    return kids;
  }));
  app.patch('/api/children/:id/settings', { preHandler: requirePerm('children', 2) }, async (req) => {
    const id = zId.parse((req.params as any).id);
    const d = z.object({ notifications_enabled: z.boolean(), voice_notifications: z.boolean(), read_aloud_default: z.boolean(), quiet_start: zTime, quiet_end: zTime,
      reminder_offsets: z.array(z.number().int().min(-240).max(240)).max(5), mic_allowed: z.boolean(), weekly_goal_stars: z.number().int().min(0).max(1000), reflection_enabled: z.boolean(), reflection_time: zTime, reflection_stars: z.number().int().min(0).max(10), show_homework: z.boolean(), allowance_amount: z.number().int().min(0).max(1e9), allowance_weekday: z.number().int().min(0).max(6), ai_enabled: z.boolean(), ai_daily_limit: z.number().int().min(0).max(200) }).partial().strict().parse(req.body);
    const keys = Object.keys(d); if (!keys.length) return { ok: true };
    return withActor(req.actor!, async (q) => (await q(`UPDATE child_settings SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE child_id=$1 RETURNING *`, [id, ...keys.map((k) => (d as any)[k])]))[0]);
  });
  app.post('/api/children/:id/password', { preHandler: requireParent }, async (req) => {
    const id = zId.parse((req.params as any).id);
    const { password } = z.object({ password: z.string().min(4).max(100) }).parse(req.body);   // children: Mana may choose a short PIN; lockout is progressive
    const hash = await hashPassword(password);
    await withActor(req.actor!, (q) => q(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1 AND role='child'`, [id, hash]));
    await revokeAll(id);
    return { ok: true };
  });

  // ----- parent: activities, rewards, goals (CRUD) -----
  crud(app, 'activities', 'activities', activitySchema, 'start_time NULLS LAST', ['child_id'], 'children');
  crud(app, 'rewards', 'rewards', z.object({ child_id: zId, title: zText(), icon: z.string().max(8).optional(), cost_stars: z.number().int().min(1).max(100000), active: z.boolean().optional() }), 'cost_stars', ['child_id'], 'children');
  crud(app, 'child-goals', 'child_goals', z.object({ child_id: zId, title: zText(), icon: z.string().max(8).optional(), target_stars: z.number().int().min(1).nullable().optional(), done: z.boolean().optional() }), 'title', ['child_id'], 'children');

  // optional starter schedule / routines / rewards (by the child's age group); returns how many items were added
  app.post('/api/children/:id/sample-data', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const cid = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [u] = await q(`SELECT age_group FROM users WHERE id=$1 AND role='child'`, [cid]); if (!u) return reply.code(404).send({ error: 'not_found' });
      const t = SAMPLE[u.age_group === 'young' ? 'young' : 'teen']; const added = { activities: 0, routines: 0, rewards: 0, goals: 0 };
      for (const [title, kind, icon, weekdays, st, en, stars] of t.activities) {
        const r = await q(`INSERT INTO activities (child_id,title,kind,icon,weekdays,start_time,end_time,stars,notify) SELECT $1,$2,$3,$4,$5,$6::time,$7::time,$8,$6::time IS NOT NULL WHERE NOT EXISTS (SELECT 1 FROM activities WHERE child_id=$1 AND title=$2) RETURNING id`, [cid, title, kind, icon, weekdays, st, en, stars]); added.activities += r.length; }
      for (const [kind, title, icon, times] of t.routines) {
        const r = await q(`INSERT INTO routines (child_id,kind,title,icon,times) SELECT $1,$2,$3,$4,$5::time[] WHERE NOT EXISTS (SELECT 1 FROM routines WHERE child_id=$1 AND title=$3) RETURNING id`, [cid, kind, title, icon, times]); added.routines += r.length; }
      for (const [title, icon, cost] of t.rewards) { const r = await q(`INSERT INTO rewards (child_id,title,icon,cost_stars) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM rewards WHERE child_id=$1 AND title=$2) RETURNING id`, [cid, title, icon, cost]); added.rewards += r.length; }
      for (const [title, icon, target] of t.goals) { const r = await q(`INSERT INTO child_goals (child_id,title,icon,target_stars) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM child_goals WHERE child_id=$1 AND title=$2) RETURNING id`, [cid, title, icon, target]); added.goals += r.length; }
      return { ok: true, added };
    });
  });

  // ----- parent: approvals -----
  app.get('/api/completions', { preHandler: requirePerm('children', 1) }, async (req) => {
    const { status = 'pending' } = z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT c.id, c.day, c.status, c.stars_awarded, c.created_at, u.display_name AS child, a.title, a.icon, a.stars FROM completions c JOIN users u ON u.id=c.child_id JOIN activities a ON a.id=c.activity_id WHERE c.status=$1 ORDER BY c.created_at DESC LIMIT 100`, [status]));
  });
  app.post('/api/completions/:id/decide', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { approve, stars } = z.object({ approve: z.boolean(), stars: z.number().int().min(0).max(100).optional() }).parse(req.body);
    const r = await withActor(req.actor!, (q) => decideCompletion(q, id, approve, stars));
    return r ?? reply.code(409).send({ error: 'not_pending' });
  });
  // mother marks an activity done directly (approved at once)
  app.post('/api/children/:id/mark-done', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const cid = zId.parse((req.params as any).id);
    const { activity_id, day = todayISO() } = z.object({ activity_id: zId, day: zDate.optional() }).parse(req.body);
    return withActor(req.actor!, async (q) => {
      const [a] = await q(`SELECT id FROM activities WHERE id=$1 AND child_id=$2`, [activity_id, cid]);
      if (!a) return reply.code(404).send({ error: 'not_found' });
      await q(`INSERT INTO completions (activity_id, child_id, day) VALUES ($1,$2,$3) ON CONFLICT (activity_id, day) DO NOTHING`, [activity_id, cid, day]);
      const [c] = await q(`SELECT id FROM completions WHERE activity_id=$1 AND day=$2`, [activity_id, day]);
      return (await decideCompletion(q, c.id, true)) ?? { ok: true, note: 'already decided' };
    });
  });
  app.post('/api/children/:id/stars', { preHandler: requirePerm('children', 2) }, async (req) => {
    const cid = zId.parse((req.params as any).id);
    const { delta, reason } = z.object({ delta: z.number().int().min(-1000).max(1000).refine((n) => n !== 0), reason: zText(120) }).parse(req.body);
    return withActor(req.actor!, async (q) => { await q(`INSERT INTO star_ledger (child_id,delta,reason) VALUES ($1,$2,$3)`, [cid, delta, reason]); await awardBadges(q, cid); return { balance: await balanceOf(q, cid) }; });
  });
  app.get('/api/reward-claims', { preHandler: requirePerm('children', 1) }, async (req) => withActor(req.actor!, (q) =>
    q(`SELECT rc.id, rc.status, rc.created_at, u.display_name child, r.title, r.icon, r.cost_stars FROM reward_claims rc JOIN users u ON u.id=rc.child_id JOIN rewards r ON r.id=rc.reward_id ORDER BY (rc.status='requested') DESC, rc.created_at DESC LIMIT 50`)));
  app.post('/api/reward-claims/:id/decide', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { grant } = z.object({ grant: z.boolean() }).parse(req.body);
    return withActor(req.actor!, async (q) => {
      const [c] = await q(`SELECT rc.*, r.cost_stars, r.title FROM reward_claims rc JOIN rewards r ON r.id=rc.reward_id WHERE rc.id=$1 FOR UPDATE OF rc`, [id]);
      if (!c || c.status !== 'requested') return reply.code(409).send({ error: 'not_pending' });
      if (grant) {
        if ((await balanceOf(q, c.child_id)) < c.cost_stars) return reply.code(409).send({ error: 'insufficient_stars' });
        await q(`INSERT INTO star_ledger (child_id,delta,reason) VALUES ($1,$2,$3)`, [c.child_id, -c.cost_stars, `جایزه: ${c.title}`]);
      }
      await q(`UPDATE reward_claims SET status=$2, decided_at=now() WHERE id=$1`, [id, grant ? 'granted' : 'rejected']);
      return { ok: true };
    });
  });

  // ----- child (or parent previewing a child) views -----
  const target = (req: any) => req.actor!.role === 'child' ? req.actor!.id : zId.parse((req.query as any).child_id);

  app.get('/api/child/today', { preHandler: requireUser }, async (req) => {
    const cid = target(req); const day = todayISO(); const wd = persianWeekday(day);
    return withActor(req.actor!, async (q) => {
      const items = await q(`SELECT a.id, a.title, a.kind, a.icon, a.description, a.start_time, a.end_time, a.stars, c.status AS completion
        FROM activities a LEFT JOIN completions c ON c.activity_id=a.id AND c.day=$2
        WHERE a.child_id=$1 AND a.active AND (($3 = ANY(a.weekdays)) OR a.on_date=$2) ORDER BY a.start_time NULLS LAST, a.title`, [cid, day, wd]);
      const [wk] = await q(`SELECT COALESCE(SUM(delta) FILTER (WHERE delta>0 AND at > now() - interval '7 days'),0)::int week_stars FROM star_ledger WHERE child_id=$1`, [cid]);
      const [s] = await q(`SELECT weekly_goal_stars, read_aloud_default, voice_notifications, mic_allowed FROM child_settings WHERE child_id=$1`, [cid]);
      return { day, day_fa: fmtJalali(day), items, balance: await balanceOf(q, cid), week_stars: wk.week_stars, settings: s };
    });
  });
  app.get('/api/child/week', { preHandler: requireUser }, async (req) => {
    const cid = target(req);
    return withActor(req.actor!, (q) => q(`SELECT id,title,kind,icon,weekdays,on_date,start_time,end_time,stars FROM activities WHERE child_id=$1 AND active ORDER BY start_time NULLS LAST`, [cid]));
  });
  app.get('/api/child/stars', { preHandler: requireUser }, async (req) => {
    const cid = target(req);
    return withActor(req.actor!, async (q) => ({
      balance: await balanceOf(q, cid),
      ledger: await q(`SELECT delta, reason, at FROM star_ledger WHERE child_id=$1 ORDER BY at DESC LIMIT 30`, [cid]),
      badges: await q(`SELECT code,title,icon,awarded_at FROM badges WHERE child_id=$1 ORDER BY awarded_at`, [cid]),
      rewards: await q(`SELECT id,title,icon,cost_stars FROM rewards WHERE child_id=$1 AND active ORDER BY cost_stars`, [cid]),
      claims: await q(`SELECT rc.id, rc.status, r.title, r.icon FROM reward_claims rc JOIN rewards r ON r.id=rc.reward_id WHERE rc.child_id=$1 ORDER BY rc.created_at DESC LIMIT 10`, [cid]),
      goals: await q(`SELECT id,title,icon,target_stars,done FROM child_goals WHERE child_id=$1 ORDER BY title`, [cid]),
    }));
  });
  // child says "I did it": creates a PENDING completion; stars only after the mother approves
  app.post('/api/child/complete', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const { activity_id } = z.object({ activity_id: zId }).strict().parse(req.body);
    const day = todayISO();
    return withActor(req.actor!, async (q) => {
      const [a] = await q(`SELECT id FROM activities WHERE id=$1 AND child_id=$2 AND active`, [activity_id, req.actor!.id]);
      if (!a) return reply.code(404).send({ error: 'not_found' });
      const r = await q(`INSERT INTO completions (activity_id, child_id, day) VALUES ($1,$2,$3) ON CONFLICT (activity_id, day) DO NOTHING RETURNING status`, [activity_id, req.actor!.id, day]);
      return { ok: true, status: r[0]?.status ?? 'already_reported' };
    });
  });
  app.post('/api/child/claim', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const { reward_id } = z.object({ reward_id: zId }).strict().parse(req.body);
    return withActor(req.actor!, async (q) => {
      const [r] = await q(`SELECT cost_stars FROM rewards WHERE id=$1 AND child_id=$2 AND active`, [reward_id, req.actor!.id]);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if ((await balanceOf(q, req.actor!.id)) < r.cost_stars) return reply.code(409).send({ error: 'insufficient_stars' });
      await q(`INSERT INTO reward_claims (reward_id, child_id) VALUES ($1,$2)`, [reward_id, req.actor!.id]);
      return { ok: true };
    });
  });
  void addDays;
}
