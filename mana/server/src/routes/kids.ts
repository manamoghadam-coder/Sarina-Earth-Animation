import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { fmtJalali, fromJalali, persianWeekday, toJalali, todayISO } from '../jalali.ts';
import { jalaaliMonthLength } from 'jalaali-js';
import { crud, zDate, zId, zText, zTime } from '../util.ts';

const isoDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default async function kidsRoutes(app: FastifyInstance) {
  // ---------- Mana-managed catalogs ----------
  crud(app, 'routines', 'routines', z.object({
    child_id: zId, kind: z.enum(['habit', 'medicine']).optional(), title: zText(), icon: z.string().max(8).optional(), dose: z.string().max(100).nullable().optional(),
    times: z.array(zTime).max(8).optional(), weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    start_date: zDate.nullable().optional(), end_date: zDate.nullable().optional(), notify: z.boolean().optional(), active: z.boolean().optional(),
  }), 'kind, title', ['child_id'], 'children');
  crud(app, 'quotes', 'quotes', z.object({ age_group: z.enum(['young', 'teen', 'adult']), text: zText(240), active: z.boolean().optional() }), 'age_group, text', [], 'children');
  crud(app, 'occasions', 'occasions', z.object({
    title: zText(100), kind: z.enum(['family', 'birthday', 'iranian', 'school', 'other', 'anniversary', 'holiday']).optional(), notify: z.boolean().optional(), person_id: zId.nullable().optional(), official: z.boolean().optional(), jm: z.number().int().min(1).max(12), jd: z.number().int().min(1).max(31),
    birth_jy: z.number().int().min(1300).max(1500).nullable().optional(), icon: z.string().max(8).optional(), audience: z.enum(['all', 'kids', 'adults']).optional(), active: z.boolean().optional(),
  }), 'jm, jd', [], 'events');

  app.get('/api/purchase-requests', { preHandler: requirePerm('children', 1) }, async (req) => withActor(req.actor!, (q) =>
    q(`SELECT r.*, u.display_name AS child FROM purchase_requests r JOIN users u ON u.id=r.child_id ORDER BY (r.status='requested') DESC, r.created_at DESC LIMIT 100`)));
  app.post('/api/purchase-requests/:id/decide', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const b = z.object({ status: z.enum(['approved', 'bought', 'rejected']), mom_note: z.string().max(300).nullable().optional() }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`UPDATE purchase_requests SET status=$2, mom_note=COALESCE($3, mom_note), decided_at=now() WHERE id=$1 RETURNING *`, [id, b.status, b.mom_note ?? null]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  app.get('/api/suggestions', { preHandler: requirePerm('children', 1) }, async (req) => withActor(req.actor!, (q) =>
    q(`SELECT s.*, u.display_name AS child FROM suggestions s JOIN users u ON u.id=s.child_id ORDER BY (s.status='new') DESC, s.created_at DESC LIMIT 100`)));
  app.post('/api/suggestions/:id/status', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { status } = z.object({ status: z.enum(['new', 'seen', 'done']) }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`UPDATE suggestions SET status=$2 WHERE id=$1 RETURNING *`, [id, status]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  // adherence overview for Mana: last 7 days per routine
  app.get('/api/routines/report', { preHandler: requirePerm('children', 1) }, async (req) => {
    const { child_id } = z.object({ child_id: zId }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT r.id, r.title, r.kind, r.icon, cardinality(r.times) AS slots_per_day,
        (SELECT count(*)::int FROM routine_logs l WHERE l.routine_id=r.id AND l.day > current_date - 7) AS done_7d
      FROM routines r WHERE r.child_id=$1 AND r.active ORDER BY r.kind, r.title`, [child_id]));
  });

  // ---------- child side ----------
  const childOnly = async (req: any, reply: any) => { await requireUser(req, reply); if (!reply.sent && req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' }); };

  app.get('/api/child/routines', { preHandler: requireUser }, async (req) => {
    const cid = req.actor!.role === 'child' ? req.actor!.id : zId.parse((req.query as any).child_id);
    const day = todayISO(); const wd = persianWeekday(day);
    return withActor(req.actor!, async (q) => {
      const rs = await q(`SELECT id, kind, title, icon, dose, times, end_date FROM routines WHERE child_id=$1 AND active
        AND (weekdays IS NULL OR $2 = ANY(weekdays)) AND (start_date IS NULL OR start_date <= $3) AND (end_date IS NULL OR end_date >= $3) ORDER BY kind DESC, title`, [cid, wd, day]);
      const logs = await q(`SELECT routine_id, slot FROM routine_logs WHERE child_id=$1 AND day=$2`, [cid, day]);
      return rs.map((r: any) => ({ ...r, slots: (r.times.length ? r.times : ['']).map((s: string) => ({ slot: s, done: logs.some((l: any) => l.routine_id === r.id && l.slot === s) })) }));
    });
  });
  app.post('/api/child/routines/:id/log', { preHandler: childOnly }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { slot = '' } = z.object({ slot: z.union([zTime, z.literal('')]).optional() }).strict().parse(req.body ?? {});
    return withActor(req.actor!, async (q) => {
      const [r] = await q(`SELECT id FROM routines WHERE id=$1 AND child_id=$2 AND active`, [id, req.actor!.id]);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      await q(`INSERT INTO routine_logs (routine_id, child_id, day, slot) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [id, req.actor!.id, todayISO(), slot]);
      return { ok: true };
    });
  });
  const CATS = ['food', 'clothes', 'school', 'class_fee', 'other'] as const;
  app.get('/api/child/requests', { preHandler: childOnly }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, category, title, note, status, mom_note, created_at FROM purchase_requests WHERE child_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.actor!.id])));
  app.post('/api/child/requests', { preHandler: childOnly }, async (req, reply) => {
    const b = z.object({ category: z.enum(CATS), title: zText(120), note: z.string().max(300).nullable().optional() }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO purchase_requests (child_id, category, title, note) VALUES ($1,$2,$3,$4) RETURNING id`, [req.actor!.id, b.category, b.title, b.note ?? null]));
    return reply.code(201).send(r[0]);
  });
  app.get('/api/child/suggestions', { preHandler: childOnly }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, kind, text, status, created_at FROM suggestions WHERE child_id=$1 ORDER BY created_at DESC LIMIT 30`, [req.actor!.id])));
  app.post('/api/child/suggestions', { preHandler: childOnly }, async (req, reply) => {
    const b = z.object({ kind: z.enum(['food', 'fun', 'other']), text: zText(300) }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO suggestions (child_id, kind, text) VALUES ($1,$2,$3) RETURNING id`, [req.actor!.id, b.kind, b.text]));
    return reply.code(201).send(r[0]);
  });

  // ---------- shared reads ----------
  app.get('/api/quote/today', { preHandler: requireUser }, async (req) => withActor(req.actor!, async (q) => {
    const [u] = await q(`SELECT age_group FROM users WHERE id=$1`, [req.actor!.id]);
    const list = await q(`SELECT text FROM quotes WHERE age_group=$1 AND active ORDER BY id`, [u?.age_group ?? 'adult']);
    if (!list.length) return { text: null };
    const day = todayISO(); const n = Math.floor(Date.parse(day) / 86400000);
    return { text: list[n % list.length].text };
  }));
  app.get('/api/occasions/upcoming', { preHandler: requireUser }, async (req) => {
    const { days = 60 } = z.object({ days: z.coerce.number().int().min(1).max(366).optional() }).parse(req.query);
    const today = todayISO(); const t = toJalali(today);
    const rows = await withActor(req.actor!, (q) => q(`SELECT id, title, kind, jm, jd, birth_jy, icon, audience FROM occasions WHERE active`));
    const out = rows.map((o: any) => {
      let jy = t.jy; const mk = (y: number) => fromJalali(y, o.jm, Math.min(o.jd, jalaaliMonthLength(y, o.jm)));
      let date = mk(jy); if (date < today) { jy++; date = mk(jy); }
      return { id: o.id, title: o.title, kind: o.kind, icon: o.icon, date, date_fa: fmtJalali(date), days_left: isoDiff(today, date), age: o.birth_jy ? jy - o.birth_jy : null, weekday: persianWeekday(date) };
    }).filter((o: any) => o.days_left <= days).sort((a: any, b: any) => a.days_left - b.days_left);
    return out;
  });
}
