import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { requireParent, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { zId } from '../util.ts';

const MAX = 8 * 1024 * 1024;
function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
const dir = () => { const d = path.resolve(config.storageDir, 'photos'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };

export default async function photoRoutes(app: FastifyInstance) {
  app.post('/api/users/:id/photos', { preHandler: requireParent }, async (req, reply) => {
    const owner = zId.parse((req.params as any).id);
    const file = await req.file({ limits: { fileSize: MAX, files: 1 } });
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const buf = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'too_large' });
    const kind = sniff(buf);
    if (!kind) return reply.code(415).send({ error: 'unsupported_type', hint: 'JPEG, PNG or WebP only' });
    const name = `${crypto.randomUUID()}.${kind.ext}`;
    const caption = typeof (file.fields.caption as any)?.value === 'string' ? (file.fields.caption as any).value.slice(0, 120) : null;
    fs.writeFileSync(path.join(dir(), name), buf, { mode: 0o600 });
    try {
      const row = await withActor(req.actor!, async (q) => (await q(`INSERT INTO photos (owner_id,file_name,mime,bytes,caption,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,owner_id,caption,created_at`, [owner, name, kind.mime, buf.length, caption, req.actor!.id]))[0]);
      return reply.code(201).send(row);
    } catch (e) { fs.rmSync(path.join(dir(), name), { force: true }); throw e; }
  });
  app.get('/api/photos', { preHandler: requireUser }, async (req) => {
    const owner = req.actor!.role === 'child' ? req.actor!.id : zId.parse((req.query as any).owner_id);
    return withActor(req.actor!, (q) => q(`SELECT id, caption, created_at FROM photos WHERE owner_id=$1 ORDER BY created_at DESC`, [owner]));
  });
  app.get('/api/photos/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [p] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime FROM photos WHERE id=$1`, [id]));   // RLS decides visibility
    if (!p) return reply.code(404).send({ error: 'not_found' });
    reply.header('Content-Type', p.mime).header('Cache-Control', 'private, max-age=300').header('Content-Disposition', 'inline');
    return reply.send(fs.createReadStream(path.join(dir(), path.basename(p.file_name))));
  });
  app.delete('/api/photos/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [p] = await withActor(req.actor!, (q) => q(`DELETE FROM photos WHERE id=$1 RETURNING file_name`, [id]));
    if (!p) return reply.code(404).send({ error: 'not_found' });
    fs.rmSync(path.join(dir(), path.basename(p.file_name)), { force: true });
    return { ok: true };
  });
  app.post('/api/photos/:id/avatar', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`UPDATE users SET avatar_photo_id=$1 WHERE id=(SELECT owner_id FROM photos WHERE id=$1) RETURNING id`, [id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  void pipeline; void z;
}
