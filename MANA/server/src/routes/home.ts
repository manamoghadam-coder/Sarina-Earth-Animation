import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { requireParent, requirePerm, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { crud, zDate, zId } from '../util.ts';

const FMAX = 10 * 1024 * 1024;
const fdir = () => { const d = path.resolve(config.storageDir, 'files'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
function sniffFile(b: Buffer): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export default async function homeRoutes(app: FastifyInstance) {
  // ---- shopping list & meal plan (module "home") ----
  crud(app, 'shopping', 'shopping_items', z.object({ title: z.string().trim().min(1).max(120), qty: z.string().trim().max(40).nullish(), done: z.boolean().default(false) }), 'done, created_at DESC', [], 'home');
  app.get('/api/meals', { preHandler: requirePerm('home', 1) }, async (req) => {
    const { from, to } = z.object({ from: zDate, to: zDate }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT id, day, slot, title FROM meals WHERE day BETWEEN $1 AND $2 ORDER BY day`, [from, to]));
  });
  app.put('/api/meals', { preHandler: requirePerm('home', 2) }, async (req) => {
    const d = z.object({ day: zDate, slot: z.enum(['breakfast', 'lunch', 'dinner']), title: z.string().trim().max(120) }).strict().parse(req.body);
    return withActor(req.actor!, async (q) => {
      if (!d.title) { await q(`DELETE FROM meals WHERE day=$1 AND slot=$2`, [d.day, d.slot]); return { ok: true }; }
      return (await q(`INSERT INTO meals (day, slot, title) VALUES ($1,$2,$3) ON CONFLICT (day, slot) DO UPDATE SET title=EXCLUDED.title RETURNING id, day, slot, title`, [d.day, d.slot, d.title]))[0];
    });
  });

  // ---- task attachments (PDF/JPEG/PNG/WebP up to 10 MB; module "tasks") ----
  app.get('/api/tasks/:id/files', { preHandler: requirePerm('tasks', 1) }, async (req) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, (q) => q(`SELECT id, original_name, mime, bytes, created_at FROM task_files WHERE task_id=$1 ORDER BY created_at`, [id]));
  });
  app.post('/api/tasks/:id/files', { preHandler: requirePerm('tasks', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const file = await req.file({ limits: { fileSize: FMAX, files: 1 } }); if (!file) return reply.code(400).send({ error: 'no_file' });
    const buf = await file.toBuffer(); if (file.file.truncated) return reply.code(413).send({ error: 'too_large' });
    const kind = sniffFile(buf); if (!kind) return reply.code(415).send({ error: 'unsupported_type', hint: 'PDF, JPEG, PNG or WebP only' });
    const name = `${crypto.randomUUID()}.${kind.ext}`; fs.writeFileSync(path.join(fdir(), name), buf, { mode: 0o600 });
    try {
      const [r] = await withActor(req.actor!, (q) => q(`INSERT INTO task_files (task_id,file_name,original_name,mime,bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, original_name, mime, bytes, created_at`, [id, name, (file.filename || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120), kind.mime, buf.length]));
      return reply.code(201).send(r);
    } catch (e) { fs.rmSync(path.join(fdir(), name), { force: true }); throw e; }
  });
  app.get('/api/task-files/:id', { preHandler: requirePerm('tasks', 1) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [f] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime, original_name FROM task_files WHERE id=$1`, [id]));
    if (!f) return reply.code(404).send({ error: 'not_found' });
    reply.header('Content-Type', f.mime).header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`).header('Cache-Control', 'private, max-age=300');
    return reply.send(fs.createReadStream(path.join(fdir(), path.basename(f.file_name))));
  });
  app.delete('/api/task-files/:id', { preHandler: requirePerm('tasks', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [f] = await withActor(req.actor!, (q) => q(`DELETE FROM task_files WHERE id=$1 RETURNING file_name`, [id]));
    if (!f) return reply.code(404).send({ error: 'not_found' });
    fs.rmSync(path.join(fdir(), path.basename(f.file_name)), { force: true }); return { ok: true };
  });

  // ---- annual dates: birthdays / anniversaries / occasions / fixed solar holidays ----
  app.get('/api/family-dates', { preHandler: requireUser }, async (req) => withActor(req.actor!, (q) => q(`SELECT d.id, d.title, d.kind, d.jm, d.jd, d.person_id, d.notify, d.official FROM family_dates d ORDER BY d.jm, d.jd`)));
  const FD = z.object({ title: z.string().trim().min(1).max(100), kind: z.enum(['birthday', 'anniversary', 'occasion', 'holiday']), jm: z.number().int().min(1).max(12), jd: z.number().int().min(1).max(31), person_id: zId.nullish(), notify: z.boolean().default(true) }).strict();
  app.post('/api/family-dates', { preHandler: requireParent }, async (req, reply) => {
    const d = FD.parse(req.body);
    const [r] = await withActor(req.actor!, (q) => q(`INSERT INTO family_dates (title,kind,jm,jd,person_id,notify) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [d.title, d.kind, d.jm, d.jd, d.person_id ?? null, d.notify]));
    return reply.code(201).send(r);
  });
  app.delete('/api/family-dates/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM family_dates WHERE id=$1 RETURNING id`, [id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
