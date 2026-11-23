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
      reminder_offsets: z.array(z.number().int().min(-240).max(240)).max(5), mic_allowed: z.boolean(), reflection_enabled: z.boolean(), reflection_time: zTime, reflection_stars: z.number().int().min(0).max(10), show_homework: z.boolean(), theme: z.enum(['sarina', 'saman']), weekly_goal_stars: z.number().int().min(0).max(1000) }).partial().strict().parse(req.body);
    const keys = Object.keys(d); if (!keys.length) return { ok: true };
    return withActor(req.actor!, async (q) => (await q(`UPDATE child_settings SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE child_id=$1 RETURNING *`, [id, ...keys.map((k) => (d as any)[k])]))[0]);
  });
  app.post('/api/children/:id/password', { preHandler: requireParent }, async (req) => {
    const id = zId.parse((req.params as any).id);
    const { password } = z.object({ password: z.string().min(8).max(100) }).parse(req.body);
    const hash = await hashPassword(password);
    await withActor(req.actor!, (q) => q(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1`, [id, hash]));
    await revokeAll(id);
    return { ok: true };
  });

  // ----- parent: activities, rewards, goals (CRUD) -----
  crud(app, 'activities', 'activities', activitySchema, 'start_time NULLS LAST', ['child_id'], 'children');
  crud(app, 'rewards', 'rewards', z.object({ child_id: zId, title: zText(), icon: z.string().max(8).optional(), cost_stars: z.number().int().min(1).max(100000), active: z.boolean().optional() }), 'cost_stars', ['child_id'], 'children');
  crud(app, 'child-goals', 'child_goals', z.object({ child_id: zId, title: zText(), icon: z.string().max(8).optional(), target_stars: z.number().int().min(1).nullable().optional(), done: z.boolean().optional() }), 'title', ['child_id'], 'children');

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
