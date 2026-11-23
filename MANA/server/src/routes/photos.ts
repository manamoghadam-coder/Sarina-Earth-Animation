import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { requirePerm, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { zId } from '../util.ts';

export const MAX = 8 * 1024 * 1024;
export function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
export const dir = () => { const d = path.resolve(config.storageDir, 'photos'); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };

export default async function photoRoutes(app: FastifyInstance) {
  app.post('/api/users/:id/photos', { preHandler: requirePerm('photos', 2) }, async (req, reply) => {
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
    return withActor(req.actor!, (q) => q(`SELECT id, caption, created_at FROM photos WHERE owner_id=$1 AND kind='gallery' ORDER BY created_at DESC`, [owner]));
  });
  app.get('/api/photos/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [p] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime FROM photos WHERE id=$1`, [id]));   // RLS decides visibility
    if (!p) return reply.code(404).send({ error: 'not_found' });
    reply.header('Content-Type', p.mime).header('Cache-Control', 'private, max-age=300').header('Content-Disposition', 'inline');
    return reply.send(fs.createReadStream(path.join(dir(), path.basename(p.file_name))));
  });
  app.delete('/api/photos/:id', { preHandler: requirePerm('photos', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [p] = await withActor(req.actor!, (q) => q(`DELETE FROM photos WHERE id=$1 RETURNING file_name`, [id]));
    if (!p) return reply.code(404).send({ error: 'not_found' });
    fs.rmSync(path.join(dir(), path.basename(p.file_name)), { force: true });
    return { ok: true };
  });
  app.post('/api/photos/:id/avatar', { preHandler: requirePerm('photos', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const r = await withActor(req.actor!, (q) => q(`UPDATE users SET avatar_photo_id=$1 WHERE id=(SELECT owner_id FROM photos WHERE id=$1) RETURNING id`, [id]));
    return r[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
  // Every person changes THEIR OWN profile photo: upload a new picture (multipart `file`) or pick one from their own gallery (JSON {photo_id}).
  app.post('/api/me/avatar', { preHandler: requirePerm('avatar', 2) }, async (req, reply) => {
    const me = req.actor!.id;
    if (req.isMultipart()) {
      const file = await req.file({ limits: { fileSize: MAX, files: 1 } });
      if (!file) return reply.code(400).send({ error: 'no_file' });
      const buf = await file.toBuffer();
      if (file.file.truncated) return reply.code(413).send({ error: 'too_large' });
      const kind = sniff(buf);
      if (!kind) return reply.code(415).send({ error: 'unsupported_type', hint: 'JPEG, PNG or WebP only' });
      const name = `${crypto.randomUUID()}.${kind.ext}`;
      fs.writeFileSync(path.join(dir(), name), buf, { mode: 0o600 });
      try {
        const id = await withActor(req.actor!, async (q) => {
          const [p] = await q(`INSERT INTO photos (owner_id,file_name,mime,bytes,caption,uploaded_by,kind) VALUES ($1,$2,$3,$4,'پروفایل',$1,'avatar') RETURNING id`, [me, name, kind.mime, buf.length]);
          const [ok] = await q(`SELECT set_my_avatar($1) AS ok`, [p.id]);
          if (!ok.ok) throw Object.assign(new Error('forbidden'), { code: '42501' });
          return p.id as string;
        });
        return reply.code(201).send({ ok: true, avatar_photo_id: id });
      } catch (e) { fs.rmSync(path.join(dir(), name), { force: true }); throw e; }
    }
    const { photo_id } = z.object({ photo_id: zId }).strict().parse(req.body);
    const [ok] = await withActor(req.actor!, (q) => q(`SELECT set_my_avatar($1) AS ok`, [photo_id]));
    return ok.ok ? { ok: true, avatar_photo_id: photo_id } : reply.code(404).send({ error: 'not_found' });
  });
  void pipeline;
}
