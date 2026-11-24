import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdult, requirePerm } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { removeStored, saveUpload, sendStored } from '../files.ts';
import { todayISO } from '../jalali.ts';
import { crud, zDate, zId, zText, zTime } from '../util.ts';

const OFFICE: Record<string, string> = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

export default async function extraRoutes(app: FastifyInstance) {
  // ----- people (names only) for pickers -----
  app.get('/api/people', { preHandler: requireAdult }, async () => sys(`SELECT id, display_name FROM users WHERE active ORDER BY role, display_name`));

  // ----- shared shopping list -----
  const CAT = z.enum(['food', 'home', 'school', 'health', 'other']);
  app.get('/api/shopping', { preHandler: requirePerm('shopping', 1) }, async (req) => withActor(req.actor!, (q) => q(`SELECT s.*, u.display_name AS added_by_name FROM shopping_items s LEFT JOIN users u ON u.id=s.added_by ORDER BY (s.status='bought'), s.category, s.added_at DESC LIMIT 400`)));
  app.post('/api/shopping', { preHandler: requirePerm('shopping', 2) }, async (req, reply) => {
    const b = z.object({ title: zText(120), qty: z.string().max(40).nullable().optional(), category: CAT.optional(), note: z.string().max(300).nullable().optional() }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO shopping_items (title,qty,category,note,added_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [b.title, b.qty ?? null, b.category ?? 'food', b.note ?? null, req.actor!.id]));
    return reply.code(201).send(r[0]);
  });
  app.post('/api/shopping/:id/status', { preHandler: requirePerm('shopping', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const { status } = z.object({ status: z.enum(['open', 'bought']) }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`UPDATE shopping_items SET status=$2, bought_at = CASE WHEN $2='bought' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`, [id, status]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/shopping/:id', { preHandler: requirePerm('shopping', 2) }, async (req, reply) => {
    const r = await withActor(req.actor!, (q) => q(`DELETE FROM shopping_items WHERE id=$1 RETURNING id`, [zId.parse((req.params as any).id)])); return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/api/shopping/clear-bought', { preHandler: requirePerm('shopping', 2) }, async (req) => ({ removed: (await withActor(req.actor!, (q) => q(`DELETE FROM shopping_items WHERE status='bought' RETURNING id`))).length }));
  // approve a child's purchase request and put it on the shopping list in one step
  app.post('/api/purchase-requests/:id/to-shopping', { preHandler: requirePerm('children', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [r] = await q(`SELECT r.title, r.category, u.display_name FROM purchase_requests r JOIN users u ON u.id=r.child_id WHERE r.id=$1`, [id]); if (!r) return reply.code(404).send({ error: 'not_found' });
      const cat = r.category === 'food' ? 'food' : r.category === 'school' || r.category === 'class_fee' ? 'school' : 'other';
      await q(`INSERT INTO shopping_items (title, category, note, added_by) VALUES ($1,$2,$3,$4)`, [r.title, cat, `درخواست ${r.display_name}`, req.actor!.id]);
      await q(`UPDATE purchase_requests SET status='approved', decided_at=now() WHERE id=$1 AND status='requested'`, [id]); return { ok: true };
    });
  });

  // ----- health records (vaccines, appointments, checkups) -----
  crud(app, 'health-records', 'health_records', z.object({ person_id: zId.nullable().optional(), person_label: z.string().max(40).nullable().optional(), kind: z.enum(['vaccine', 'appointment', 'checkup', 'dental', 'other']).optional(),
    title: zText(120), due_date: zDate.nullable().optional(), due_time: zTime.nullable().optional(), doctor: z.string().max(80).nullable().optional(), note: z.string().max(600).nullable().optional(), done: z.boolean().optional(), done_on: zDate.nullable().optional() }),
    'done, due_date NULLS LAST', [], 'health');
  app.post('/api/health-records/:id/done', { preHandler: requirePerm('health', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const { done } = z.object({ done: z.boolean() }).strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`UPDATE health_records SET done=$2, done_on = CASE WHEN $2 THEN $3::date ELSE NULL END WHERE id=$1 RETURNING *`, [id, done, todayISO()]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });

  // ----- task attachments (PDF, images, Word/Excel/PowerPoint) -----
  const MAXF = 25 * 1024 * 1024;
  app.get('/api/tasks/:id/files', { preHandler: requirePerm('tasks', 1) }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, orig_name, mime, bytes, created_at FROM task_files WHERE task_id=$1 ORDER BY created_at`, [zId.parse((req.params as any).id)])));
  app.post('/api/tasks/:id/files', { preHandler: requirePerm('tasks', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [t] = await withActor(req.actor!, (q) => q(`SELECT id FROM tasks WHERE id=$1`, [id])); if (!t) return reply.code(404).send({ error: 'not_found' });
    const file = await req.file({ limits: { fileSize: MAXF, files: 1 } }); if (!file) return reply.code(400).send({ error: 'no_file' });
    const orig = path.basename(file.filename || 'file').slice(0, 120); const ext = path.extname(orig).slice(1).toLowerCase();
    const r = await saveUpload(file as any, 'taskfiles', ['pdf', 'photo', 'office'], MAXF);
    if ('error' in r) return reply.code(r.error === 'too_large' ? 413 : 415).send({ error: r.error, hint: 'PDF، عکس یا فایل Word/Excel/PowerPoint تا ۲۵MB' });
    let mime = r.kind.mime;
    if (r.kind.kind === 'office') { if (!OFFICE[ext]) { removeStored('taskfiles', r.name); return reply.code(415).send({ error: 'unsupported_type' }); } mime = OFFICE[ext]; }
    try { const row = await withActor(req.actor!, async (q) => (await q(`INSERT INTO task_files (task_id,orig_name,file_name,mime,bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, orig_name, mime, bytes`, [id, orig, r.name, mime, r.bytes]))[0]); return reply.code(201).send(row); }
    catch (e) { removeStored('taskfiles', r.name); throw e; }
  });
  app.get('/api/task-files/:id/file', { preHandler: requirePerm('tasks', 1) }, async (req, reply) => {
    const [f] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime, orig_name FROM task_files WHERE id=$1`, [zId.parse((req.params as any).id)]));
    if (!f) return reply.code(404).send({ error: 'not_found' });
    const inline = f.mime === 'application/pdf' || f.mime.startsWith('image/');
    return sendStored(req, reply, 'taskfiles', f.file_name, f.mime, !inline);
  });
  app.delete('/api/task-files/:id', { preHandler: requirePerm('tasks', 2) }, async (req, reply) => {
    const [f] = await withActor(req.actor!, (q) => q(`DELETE FROM task_files WHERE id=$1 RETURNING file_name`, [zId.parse((req.params as any).id)]));
    if (!f) return reply.code(404).send({ error: 'not_found' }); removeStored('taskfiles', f.file_name); return { ok: true };
  });
}
