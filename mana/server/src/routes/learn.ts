import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.ts';
import { sys, sysPool, withActor, type Q } from '../db.ts';
import { addDays, todayISO } from '../jalali.ts';
import { awardBadges } from '../rewards.ts';
import { crud, zId, zText } from '../util.ts';

const dayNo = (iso: string) => Math.floor(Date.parse(iso) / 86400000);
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default async function learnRoutes(app: FastifyInstance) {
  // ----- daily facts -----
  crud(app, 'facts', 'facts', z.object({ age_group: z.enum(['young', 'teen', 'adult']), topic: z.string().max(30).optional(), title: zText(80), body: zText(600), active: z.boolean().optional() }), 'age_group, topic, title', [], 'children');
  app.get('/api/facts/today', { preHandler: requireUser }, async (req) => withActor(req.actor!, async (q) => {
    const [u] = await q(`SELECT age_group FROM users WHERE id=$1`, [req.actor!.id]);
    let g = u?.age_group ?? 'adult';
    let list = await q(`SELECT id, topic, title, body FROM facts WHERE age_group=$1 AND active ORDER BY topic, title`, [g]);
    if (!list.length) list = await q(`SELECT id, topic, title, body FROM facts WHERE age_group='teen' AND active ORDER BY topic, title`);
    if (!list.length) return { today: null, recent: [] };
    // deterministic order per group (stable hash by id) so "today" is the same for everybody in the group all day
    const ordered = [...list].sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
    const n = dayNo(todayISO());
    const pick = (d: number) => ordered[((d % ordered.length) + ordered.length) % ordered.length];
    return { today: pick(n), recent: [1, 2, 3, 4, 5, 6].map((k) => ({ ...pick(n - k), day: addDays(todayISO(), -k) })) };
  }));

  // ----- financial literacy lessons -----
  crud(app, 'lessons', 'lessons', z.object({ age_group: z.enum(['young', 'teen']), position: z.number().int().min(0).max(999).optional(), title: zText(100), body: zText(1200), question: zText(300),
    options: z.array(zText(200)).min(2).max(4), correct: z.number().int().min(0).max(3), stars: z.number().int().min(0).max(20).optional(), active: z.boolean().optional() }), 'age_group, position', [], 'children');
  app.get('/api/child/lessons', { preHandler: requireUser }, async (req) => {
    const cid = req.actor!.role === 'child' ? req.actor!.id : zId.parse((req.query as any).child_id);
    return withActor(req.actor!, (q) => q(`SELECT l.id, l.title, l.position, l.stars, p.correct AS done FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.child_id=$1
      WHERE l.active AND l.age_group=(SELECT age_group FROM users WHERE id=$1) ORDER BY l.position`, [cid]));
  });
  app.get('/api/child/lessons/:id', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [l] = await q(`SELECT id, title, body, question, options, stars FROM lessons WHERE id=$1 AND active`, [id]);
      if (!l) return reply.code(404).send({ error: 'not_found' });
      const options = shuffle(l.options.map((text: string, i: number) => ({ i, text })));      // the correct index is never sent to the client
      return { ...l, options };
    });
  });
  app.post('/api/child/lessons/:id/answer', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const id = zId.parse((req.params as any).id); const { i } = z.object({ i: z.number().int().min(0).max(3) }).strict().parse(req.body);
    const [l] = await withActor(req.actor!, (q) => q(`SELECT id, correct, stars, options FROM lessons WHERE id=$1 AND active`, [id]));
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const correct = i === l.correct; const cid = req.actor!.id;
    const q: Q = (s, p) => sys(s, p);
    const [prev] = await q(`SELECT correct FROM lesson_progress WHERE child_id=$1 AND lesson_id=$2`, [cid, id]);
    await q(`INSERT INTO lesson_progress (child_id, lesson_id, correct) VALUES ($1,$2,$3) ON CONFLICT (child_id, lesson_id) DO UPDATE SET attempts = lesson_progress.attempts + 1, correct = lesson_progress.correct OR EXCLUDED.correct, at = now()`, [cid, id, correct]);
    let stars = 0;
    if (correct && !prev?.correct && l.stars > 0) {           // stars only once per lesson
      stars = l.stars; await q(`INSERT INTO star_ledger (child_id, delta, reason) VALUES ($1,$2,'درس سواد مالی')`, [cid, stars]); await awardBadges(q, cid);
    }
    return { correct, stars_awarded: stars };
  });

  // ----- pocket money + savings goals -----
  const balance = async (q: Q, cid: string) => Number((await q(`SELECT COALESCE(SUM(delta) FILTER (WHERE goal_id IS NULL),0) AS w FROM wallet_ledger WHERE child_id=$1`, [cid]))[0].w);
  app.get('/api/child/wallet', { preHandler: requireUser }, async (req) => {
    const cid = req.actor!.role === 'child' ? req.actor!.id : zId.parse((req.query as any).child_id);
    return withActor(req.actor!, async (q) => ({
      balance: await balance(q, cid),
      goals: await q(`SELECT g.id, g.title, g.icon, g.target_amount, g.done, COALESCE((SELECT SUM(delta) FROM wallet_ledger w WHERE w.goal_id=g.id),0)::bigint AS saved FROM savings_goals g WHERE g.child_id=$1 ORDER BY g.done, g.created_at`, [cid]),
      ledger: await q(`SELECT delta, reason, at, goal_id FROM wallet_ledger WHERE child_id=$1 ORDER BY at DESC, id DESC LIMIT 30`, [cid]),
    }));
  });
  // moves pocket money into a goal's jar; runs as one locked transaction (children have no direct insert rights)
  app.post('/api/child/wallet/save', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const { goal_id, amount } = z.object({ goal_id: zId, amount: z.number().int().positive().max(1e10) }).strict().parse(req.body); const cid = req.actor!.id;
    const c = await sysPool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [cid]);
      const g = await c.query(`SELECT id, title FROM savings_goals WHERE id=$1 AND child_id=$2 AND NOT done`, [goal_id, cid]);
      if (!g.rowCount) { await c.query('ROLLBACK'); return reply.code(404).send({ error: 'not_found' }); }
      const b = Number((await c.query(`SELECT COALESCE(SUM(delta),0) s FROM wallet_ledger WHERE child_id=$1 AND goal_id IS NULL`, [cid])).rows[0].s);
      if (b < amount) { await c.query('ROLLBACK'); return reply.code(409).send({ error: 'insufficient_balance', message: 'پول‌توجیبی‌ات کافی نیست.' }); }
      await c.query(`INSERT INTO wallet_ledger (child_id, goal_id, delta, reason) VALUES ($1,NULL,$2,$3), ($1,$4,$5,$6)`, [cid, -amount, `گذاشتن در قلک «${g.rows[0].title}»`, goal_id, amount, 'پس‌انداز']);
      await c.query('COMMIT'); return { ok: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  app.post('/api/child/wallet/spend', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const { amount, note } = z.object({ amount: z.number().int().positive().max(1e10), note: zText(100) }).strict().parse(req.body); const cid = req.actor!.id;
    const c = await sysPool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [cid]);
      const b = Number((await c.query(`SELECT COALESCE(SUM(delta),0) s FROM wallet_ledger WHERE child_id=$1 AND goal_id IS NULL`, [cid])).rows[0].s);
      if (b < amount) { await c.query('ROLLBACK'); return reply.code(409).send({ error: 'insufficient_balance', message: 'پول‌توجیبی‌ات کافی نیست.' }); }
      await c.query(`INSERT INTO wallet_ledger (child_id, delta, reason) VALUES ($1,$2,$3)`, [cid, -amount, `خرج: ${note}`]);
      await c.query('COMMIT'); return { ok: true };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  });
  // Mana side
  app.post('/api/children/:id/wallet', { preHandler: requirePerm('children', 2) }, async (req) => {
    const cid = zId.parse((req.params as any).id);
    const { delta, reason } = z.object({ delta: z.number().int().refine((n) => n !== 0).refine((n) => Math.abs(n) <= 1e10), reason: zText(120) }).strict().parse(req.body);
    return withActor(req.actor!, async (q) => { await q(`INSERT INTO wallet_ledger (child_id, delta, reason) VALUES ($1,$2,$3)`, [cid, delta, reason]); return { balance: await balance(q, cid) }; });
  });
  app.post('/api/children/:id/goals', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const cid = zId.parse((req.params as any).id);
    const b = z.object({ title: zText(80), icon: z.string().max(8).optional(), target_amount: z.number().int().positive().max(1e10) }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO savings_goals (child_id,title,icon,target_amount) VALUES ($1,$2,$3,$4) RETURNING *`, [cid, b.title, b.icon ?? '🎯', b.target_amount]));
    return reply.code(201).send(r[0]);
  });
  app.delete('/api/savings-goals/:id', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [g] = await q(`SELECT child_id, title FROM savings_goals WHERE id=$1 FOR UPDATE`, [id]); if (!g) return reply.code(404).send({ error: 'not_found' });
      const [{ s }] = await q(`SELECT COALESCE(SUM(delta),0) s FROM wallet_ledger WHERE goal_id=$1`, [id]);
      if (Number(s) > 0) await q(`INSERT INTO wallet_ledger (child_id, goal_id, delta, reason) VALUES ($1,NULL,$2,$3)`, [g.child_id, s, `برگشت پول قلک «${g.title}»`]);   // refund before the jar's rows cascade away
      await q(`DELETE FROM savings_goals WHERE id=$1`, [id]); return { ok: true };
    });
  });
}
