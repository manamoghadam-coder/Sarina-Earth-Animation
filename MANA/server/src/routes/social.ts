import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireParent, requirePerm, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { todayISO } from '../jalali.ts';
import { zDate, zId } from '../util.ts';

const text = (max: number) => z.string().trim().min(1).max(max);
export default async function socialRoutes(app: FastifyInstance) {
  // ---------------- private diary (author only; enforced by RLS) ----------------
  const diaryBody = z.object({ title: z.string().trim().max(120).nullish(), body: text(10000), mood: z.string().trim().max(8).nullish(), entry_date: zDate.optional() }).strict();
  app.get('/api/diary', { preHandler: requirePerm('diary', 1) }, async (req) =>
    withActor(req.actor!, (q) => q(`SELECT id, entry_date, title, body, mood, created_at, updated_at FROM diary_entries WHERE user_id=$1 ORDER BY entry_date DESC, created_at DESC LIMIT 300`, [req.actor!.id])));
  app.post('/api/diary', { preHandler: requirePerm('diary', 2) }, async (req, reply) => {
    const d = diaryBody.parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`INSERT INTO diary_entries (user_id, entry_date, title, body, mood) VALUES ($1, COALESCE($2::date, $3::date), $4, $5, $6) RETURNING id, entry_date, title, body, mood, created_at, updated_at`,
      [req.actor!.id, d.entry_date ?? null, todayISO(), d.title ?? null, d.body, d.mood ?? null]));
    return reply.code(201).send(r);
  });
  app.patch('/api/diary/:id', { preHandler: requirePerm('diary', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const d = diaryBody.partial().parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`UPDATE diary_entries SET title=CASE WHEN $3 THEN $4 ELSE title END, body=COALESCE($5, body), mood=CASE WHEN $6 THEN $7 ELSE mood END, updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING id, entry_date, title, body, mood, created_at, updated_at`, [id, req.actor!.id, 'title' in d, d.title ?? null, d.body ?? null, 'mood' in d, d.mood ?? null]));
    return r ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/diary/:id', { preHandler: requirePerm('diary', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM diary_entries WHERE id=$1 AND user_id=$2 RETURNING id`, [id, req.actor!.id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // ---------------- Mom's messages ----------------
  app.get('/api/mom-messages', { preHandler: requirePerm('inbox', 1) }, async (req) => {
    const { to_user } = z.object({ to_user: zId.optional() }).parse(req.query);
    return withActor(req.actor!, (q) => req.actor!.role === 'parent'
      ? q(`SELECT m.id, m.to_user, u.display_name AS to_name, m.msg_date, m.title, m.body, m.created_at, m.read_at FROM mom_messages m JOIN users u ON u.id=m.to_user
           WHERE ($1::uuid IS NULL OR m.to_user=$1) ORDER BY m.msg_date DESC, m.created_at DESC LIMIT 300`, [to_user ?? null])
      : q(`SELECT id, to_user, msg_date, title, body, created_at, read_at FROM mom_messages WHERE to_user=$1 ORDER BY msg_date DESC, created_at DESC LIMIT 300`, [req.actor!.id]));
  });
  app.get('/api/mom-messages/unread', { preHandler: requireUser }, async (req) => {
    if (req.actor!.role === 'parent') return { count: 0 };
    const [r] = await withActor(req.actor!, (q) => q(`SELECT count(*)::int AS count FROM mom_messages WHERE to_user=$1 AND read_at IS NULL`, [req.actor!.id]));
    return r;
  });
  // Mana writes to one or several people ('all' = every active non-parent account)
  app.post('/api/mom-messages', { preHandler: requireParent }, async (req, reply) => {
    const d = z.object({ to: z.union([z.literal('all'), z.array(zId).min(1).max(10)]), title: z.string().trim().max(120).nullish(), body: text(5000), msg_date: zDate.optional() }).strict().parse(req.body);
    const rows = await withActor(req.actor!, async (q) => {
      const targets = await q<{ id: string }>(`SELECT id FROM users WHERE active AND role IN ('member','child') AND ($1::boolean OR id = ANY($2::uuid[]))`, [d.to === 'all', d.to === 'all' ? [] : d.to]);
      const out = [];
      for (const t of targets) {
        const [m] = await q(`INSERT INTO mom_messages (to_user, msg_date, title, body, created_by) VALUES ($1, COALESCE($2::date, $3::date), $4, $5, $6) RETURNING id, to_user, msg_date`, [t.id, d.msg_date ?? null, todayISO(), d.title ?? null, d.body, req.actor!.id]);
        await q(`INSERT INTO notifications (user_id,kind,title,body,icon,voice_text,due_at,dedupe_key,ref_type,ref_id) VALUES ($1,'mom_message',$2,$3,'💌',$4, now(), $5,'mom_message',$6)`,
          [t.id, d.title || 'پیام مامان', d.body.slice(0, 120), `یک پیام از مامان داری. ${d.title ?? ''}`, `mom:${m.id}`, m.id]);
        out.push(m);
      }
      return out;
    });
    if (!rows.length) return reply.code(400).send({ error: 'no_recipients' });
    return reply.code(201).send({ sent: rows.length });
  });
  app.patch('/api/mom-messages/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const d = z.object({ title: z.string().trim().max(120).nullish(), body: text(5000) }).strict().partial().parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`UPDATE mom_messages SET title=CASE WHEN $2 THEN $3 ELSE title END, body=COALESCE($4, body) WHERE id=$1 RETURNING id`, [id, 'title' in d, d.title ?? null, d.body ?? null]));
    return r ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/mom-messages/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM mom_messages WHERE id=$1 RETURNING id`, [id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/api/mom-messages/:id/read', { preHandler: requirePerm('inbox', 1) }, async (req) => {
    const id = zId.parse((req.params as any).id);
    await withActor(req.actor!, (q) => q(`UPDATE mom_messages SET read_at=COALESCE(read_at, now()) WHERE id=$1 AND to_user=$2`, [id, req.actor!.id]));
    return { ok: true };
  });

  // ---------------- family chat ----------------
  app.get('/api/chat', { preHandler: requirePerm('chat', 1) }, async (req) => {
    const { after } = z.object({ after: z.coerce.number().int().min(0).optional() }).parse(req.query);
    return withActor(req.actor!, async (q) => ({
      people: await q(`SELECT * FROM chat_people()`),
      messages: after !== undefined
        ? await q(`SELECT id, sender_id, body, created_at FROM chat_messages WHERE id > $1 ORDER BY id LIMIT 200`, [after])
        : (await q(`SELECT id, sender_id, body, created_at FROM chat_messages ORDER BY id DESC LIMIT 100`)).reverse(),
    }));
  });
  app.get('/api/chat/unread', { preHandler: requireUser }, async (req) => {
    const { after } = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const [r] = await withActor(req.actor!, (q) => q(`SELECT count(*)::int AS count, COALESCE(max(id),0) AS last FROM chat_messages WHERE id > $1 AND sender_id <> $2`, [after, req.actor!.id]));
    return r;
  });
  app.post('/api/chat', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, preHandler: requirePerm('chat', 2) }, async (req, reply) => {
    const { body } = z.object({ body: text(2000) }).strict().parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`INSERT INTO chat_messages (sender_id, body) VALUES ($1,$2) RETURNING id, sender_id, body, created_at`, [req.actor!.id, body]));
    return reply.code(201).send(r);
  });
  app.delete('/api/chat/:id', { preHandler: requirePerm('chat', 2) }, async (req, reply) => {
    const id = z.coerce.number().int().parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM chat_messages WHERE id=$1 RETURNING id`, [id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
