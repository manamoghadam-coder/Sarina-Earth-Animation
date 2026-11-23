import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { notifyUsers } from '../scheduler.ts';
import { zId } from '../util.ts';
import { MAX, dir, sniff } from './photos.ts';

const WISH = z.object({ title: z.string().trim().min(1).max(120), note: z.string().trim().max(500).nullish(), kind: z.enum(['dream', 'place', 'goal']).default('dream'), photo_id: zId.nullish() }).strict();
const COLS = 'id, board_id, title, note, kind, photo_id, achieved_at, created_at';

/** Wish board: every person has one active board of pictures/dreams/places; "رسیدم ✓" marks a wish as achieved. Boards are renewed every few months. */
export default async function wishRoutes(app: FastifyInstance) {
  const target = (req: any) => { const { user_id } = z.object({ user_id: zId.optional() }).parse(req.query); return req.actor.role === 'parent' && user_id ? user_id : req.actor.id; };

  // the active board with its wishes (created on first use). Mana can read a child's board with ?user_id=
  app.get('/api/wishes/board', { preHandler: requirePerm('wishes', 1) }, async (req) => {
    const uid = target(req); const own = uid === req.actor!.id;
    return withActor(req.actor!, async (q) => {
      let [b] = await q(`SELECT * FROM wish_boards WHERE user_id=$1 AND NOT archived`, [uid]);
      if (!b && own && (req.actor!.role === 'parent' || (req.actor!.perms?.wishes ?? 2) >= 2)) [b] = await q(`INSERT INTO wish_boards (user_id) VALUES ($1) RETURNING *`, [uid]);
      if (!b) return { board: null, wishes: [], archived: [] };
      return { board: b, wishes: await q(`SELECT ${COLS} FROM wishes WHERE board_id=$1 ORDER BY created_at`, [b.id]),
        archived: await q(`SELECT b.id, b.title, b.starts_on, (SELECT count(*)::int FROM wishes w WHERE w.board_id=b.id) AS total, (SELECT count(*)::int FROM wishes w WHERE w.board_id=b.id AND w.achieved_at IS NOT NULL) AS achieved
                           FROM wish_boards b WHERE b.user_id=$1 AND b.archived ORDER BY b.starts_on DESC`, [uid]) };
    });
  });
  app.get('/api/wishes/boards/:id', { preHandler: requirePerm('wishes', 1) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, async (q) => { const [b] = await q(`SELECT * FROM wish_boards WHERE id=$1`, [id]); return b ? { board: b, wishes: await q(`SELECT ${COLS} FROM wishes WHERE board_id=$1 ORDER BY created_at`, [id]) } : null; });
    return r ?? reply.code(404).send({ error: 'not_found' });
  });
  // upload a picture for a wish (JPEG/PNG/WebP up to 8 MB) -> photo id
  app.post('/api/wishes/photo', { preHandler: requirePerm('wishes', 2) }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX, files: 1 } });
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const buf = await file.toBuffer(); if (file.file.truncated) return reply.code(413).send({ error: 'too_large' });
    const kind = sniff(buf); if (!kind) return reply.code(415).send({ error: 'unsupported_type' });
    const name = `${crypto.randomUUID()}.${kind.ext}`; fs.writeFileSync(path.join(dir(), name), buf, { mode: 0o600 });
    try { const [p] = await withActor(req.actor!, (q) => q(`INSERT INTO photos (owner_id,file_name,mime,bytes,caption,uploaded_by,kind) VALUES ($1,$2,$3,$4,'آرزو',$1,'wish') RETURNING id`, [req.actor!.id, name, kind.mime, buf.length])); return reply.code(201).send({ photo_id: p.id }); }
    catch (e) { fs.rmSync(path.join(dir(), name), { force: true }); throw e; }
  });
  app.post('/api/wishes', { preHandler: requirePerm('wishes', 2) }, async (req, reply) => {
    const d = WISH.parse(req.body);
    const r = await withActor(req.actor!, async (q) => {
      let [b] = await q(`SELECT id FROM wish_boards WHERE user_id=$1 AND NOT archived`, [req.actor!.id]);
      if (!b) [b] = await q(`INSERT INTO wish_boards (user_id) VALUES ($1) RETURNING id`, [req.actor!.id]);
      const [n] = await q(`SELECT count(*)::int n FROM wishes WHERE board_id=$1`, [b.id]); if (n.n >= 30) return null;
      return (await q(`INSERT INTO wishes (board_id, user_id, title, note, kind, photo_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`, [b.id, req.actor!.id, d.title, d.note ?? null, d.kind, d.photo_id ?? null]))[0];
    });
    return r ? reply.code(201).send(r) : reply.code(409).send({ error: 'board_full', message: 'تابلو حداکثر ۳۰ آرزو دارد؛ تابلوی تازه بساز.' });
  });
  app.patch('/api/wishes/:id', { preHandler: requirePerm('wishes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const d = WISH.partial().parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`UPDATE wishes SET title=COALESCE($3,title), note=CASE WHEN $4 THEN $5 ELSE note END, kind=COALESCE($6,kind), photo_id=CASE WHEN $7 THEN $8 ELSE photo_id END WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`,
      [id, req.actor!.id, d.title ?? null, 'note' in d, d.note ?? null, d.kind ?? null, 'photo_id' in d, d.photo_id ?? null]));
    return r ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/wishes/:id', { preHandler: requirePerm('wishes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM wishes WHERE id=$1 AND user_id=$2 RETURNING id`, [id, req.actor!.id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  // «رسیدم ✓» (and undo). Mana gets a notification when a child reaches a wish.
  app.post('/api/wishes/:id/achieve', { preHandler: requirePerm('wishes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const { achieved } = z.object({ achieved: z.boolean() }).strict().parse(req.body);
    const [w] = await withActor(req.actor!, (q) => q(`UPDATE wishes SET achieved_at = CASE WHEN $3 THEN COALESCE(achieved_at, now()) ELSE NULL END WHERE id=$1 AND user_id=$2 RETURNING ${COLS}`, [id, req.actor!.id, achieved]));
    if (!w) return reply.code(404).send({ error: 'not_found' });
    if (achieved && req.actor!.role !== 'parent') {
      const [u] = await sys(`SELECT display_name FROM users WHERE id=$1`, [req.actor!.id]); const moms = await sys(`SELECT id FROM users WHERE role='parent' AND active`);
      await notifyUsers(moms.map((m) => m.id), { kind: 'wish_done', title: `🎉 ${u.display_name} به آرزویش رسید`, body: w.title, icon: '🎉', key: `wishdone:${w.id}` });
    }
    return w;
  });
  // a new board for the new season: the old one is archived (kept, with its ticks); unachieved wishes can be carried over
  app.post('/api/wishes/board/renew', { preHandler: requirePerm('wishes', 2) }, async (req) => {
    const d = z.object({ title: z.string().trim().min(1).max(80).default('تابلو آرزوهای تازه'), carry_over: z.boolean().default(true), refresh_months: z.number().int().min(1).max(12).default(3) }).strict().parse(req.body ?? {});
    return withActor(req.actor!, async (q) => {
      const [old] = await q(`UPDATE wish_boards SET archived=true WHERE user_id=$1 AND NOT archived RETURNING id`, [req.actor!.id]);
      const [b] = await q(`INSERT INTO wish_boards (user_id, title, refresh_months) VALUES ($1,$2,$3) RETURNING *`, [req.actor!.id, d.title, d.refresh_months]);
      if (old && d.carry_over) await q(`INSERT INTO wishes (board_id,user_id,title,note,kind,photo_id) SELECT $1,user_id,title,note,kind,photo_id FROM wishes WHERE board_id=$2 AND achieved_at IS NULL`, [b.id, old.id]);
      return b;
    });
  });
  app.patch('/api/wishes/board', { preHandler: requirePerm('wishes', 2) }, async (req) => {
    const d = z.object({ title: z.string().trim().min(1).max(80).optional(), refresh_months: z.number().int().min(1).max(12).optional() }).strict().parse(req.body);
    const [b] = await withActor(req.actor!, (q) => q(`UPDATE wish_boards SET title=COALESCE($2,title), refresh_months=COALESCE($3,refresh_months) WHERE user_id=$1 AND NOT archived RETURNING *`, [req.actor!.id, d.title ?? null, d.refresh_months ?? null]));
    return b;
  });
}
