import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { removeStored, saveUpload, sendStored } from '../files.ts';
import { zId, zText } from '../util.ts';

const field = (f: any, k: string) => (typeof f?.[k]?.value === 'string' ? f[k].value : undefined);
const MAX = { pdf: 40 * 1024 * 1024, audio: 150 * 1024 * 1024, photo: 8 * 1024 * 1024, video: 250 * 1024 * 1024 };

export default async function libraryRoutes(app: FastifyInstance) {
  // ----- library: PDFs and audio stories -----
  app.post('/api/library', { preHandler: requirePerm('library', 2) }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX.audio, files: 1 } });
    if (!file) return reply.code(400).send({ error: 'no_file' });
    const meta = z.object({ title: zText(120), description: z.string().max(500).optional(), category: z.string().max(30).default('story'), audience: z.enum(['all', 'young', 'teen', 'adults']).default('all') })
      .parse({ title: field(file.fields, 'title') ?? file.filename?.replace(/\.[^.]+$/, ''), description: field(file.fields, 'description'), category: field(file.fields, 'category'), audience: field(file.fields, 'audience') });
    const r = await saveUpload(file as any, 'library', ['pdf', 'audio'], MAX.audio);
    if ('error' in r) return reply.code(r.error === 'too_large' ? 413 : 415).send({ error: r.error, hint: 'PDF تا ۴۰MB یا صوت (MP3/M4A/OGG/WAV) تا ۱۵۰MB' });
    if (r.kind.kind === 'pdf' && r.bytes > MAX.pdf) { removeStored('library', r.name); return reply.code(413).send({ error: 'too_large' }); }
    try {
      const row = await withActor(req.actor!, async (q) => (await q(`INSERT INTO library_items (kind,title,description,category,audience,file_name,mime,bytes,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,kind,title`,
        [r.kind.kind, meta.title, meta.description ?? null, meta.category, meta.audience, r.name, r.kind.mime, r.bytes, req.actor!.id]))[0]);
      return reply.code(201).send(row);
    } catch (e) { removeStored('library', r.name); throw e; }
  });
  app.get('/api/library', { preHandler: requireUser }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, kind, title, description, category, audience, bytes, created_at FROM library_items ORDER BY created_at DESC LIMIT 300`)));
  app.get('/api/library/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [it] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime FROM library_items WHERE id=$1`, [id]));   // RLS: audience / permission
    return it ? sendStored(req, reply, 'library', it.file_name, it.mime) : reply.code(404).send({ error: 'not_found' });
  });
  app.patch('/api/library/:id', { preHandler: requirePerm('library', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const b = z.object({ title: zText(120), description: z.string().max(500).nullable(), category: z.string().max(30), audience: z.enum(['all', 'young', 'teen', 'adults']) }).partial().strict().parse(req.body);
    const keys = Object.keys(b); if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const r = await withActor(req.actor!, (q) => q(`UPDATE library_items SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING id,title`, [id, ...keys.map((k) => (b as any)[k])]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/library/:id', { preHandler: requirePerm('library', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [it] = await withActor(req.actor!, (q) => q(`DELETE FROM library_items WHERE id=$1 RETURNING file_name`, [id]));
    if (!it) return reply.code(404).send({ error: 'not_found' });
    removeStored('library', it.file_name); return { ok: true };
  });

  // ----- recipes (family-wide; photos + video upload or link) -----
  const rcat = z.object({ name: zText(40), icon: z.string().max(8).optional(), sort: z.number().int().min(0).max(99).optional() });
  app.get('/api/recipe-categories', { preHandler: requireUser }, async (req) => withActor(req.actor!, (q) => q(`SELECT c.*, (SELECT count(*)::int FROM recipes r WHERE r.category_id=c.id) AS n FROM recipe_categories c ORDER BY sort, name`)));
  app.post('/api/recipe-categories', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => { const b = rcat.strict().parse(req.body); return reply.code(201).send((await withActor(req.actor!, (q) => q(`INSERT INTO recipe_categories (name,icon,sort) VALUES ($1,$2,$3) RETURNING *`, [b.name, b.icon ?? '🍽️', b.sort ?? 5])))[0]); });
  app.delete('/api/recipe-categories/:id', { preHandler: requirePerm('recipes', 2) }, async (req) => { await withActor(req.actor!, (q) => q(`DELETE FROM recipe_categories WHERE id=$1`, [zId.parse((req.params as any).id)])); return { ok: true }; });

  const recipe = z.object({ category_id: zId.nullable().optional(), title: zText(120), description: z.string().max(1000).nullable().optional(), ingredients: z.string().max(4000).nullable().optional(), steps: z.string().max(8000).nullable().optional(),
    minutes: z.number().int().min(0).max(1440).nullable().optional(), servings: z.number().int().min(0).max(100).nullable().optional(), video_url: z.string().url().max(500).nullable().optional() });
  app.get('/api/recipes', { preHandler: requireUser }, async (req) => {
    const { category_id } = z.object({ category_id: zId.optional() }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT r.id, r.title, r.description, r.category_id, r.minutes, r.servings, (SELECT id FROM recipe_media m WHERE m.recipe_id=r.id AND m.kind='photo' ORDER BY m.created_at LIMIT 1) AS cover_id
      FROM recipes r WHERE ($1::uuid IS NULL OR r.category_id=$1) ORDER BY r.created_at DESC LIMIT 200`, [category_id ?? null]));
  });
  app.get('/api/recipes/:id', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [r] = await q(`SELECT r.*, c.name AS category FROM recipes r LEFT JOIN recipe_categories c ON c.id=r.category_id WHERE r.id=$1`, [id]);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      return { ...r, media: await q(`SELECT id, kind, caption, bytes FROM recipe_media WHERE recipe_id=$1 ORDER BY created_at`, [id]) };
    });
  });
  app.post('/api/recipes', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => {
    const b = recipe.strict().parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO recipes (category_id,title,description,ingredients,steps,minutes,servings,video_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [b.category_id ?? null, b.title, b.description ?? null, b.ingredients ?? null, b.steps ?? null, b.minutes ?? null, b.servings ?? null, b.video_url ?? null]));
    return reply.code(201).send(r[0]);
  });
  app.patch('/api/recipes/:id', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const b = recipe.partial().strict().parse(req.body) as Record<string, any>; const keys = Object.keys(b);
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const r = await withActor(req.actor!, (q) => q(`UPDATE recipes SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING id`, [id, ...keys.map((k) => b[k])]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/recipes/:id', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const media = await q(`SELECT file_name FROM recipe_media WHERE recipe_id=$1`, [id]);
      const r = await q(`DELETE FROM recipes WHERE id=$1 RETURNING id`, [id]); if (!r[0]) return reply.code(404).send({ error: 'not_found' });
      media.forEach((m: any) => removeStored('recipes', m.file_name)); return { ok: true };
    });
  });
  app.post('/api/recipes/:id/media', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const file = await req.file({ limits: { fileSize: MAX.video, files: 1 } }); if (!file) return reply.code(400).send({ error: 'no_file' });
    const r = await saveUpload(file as any, 'recipes', ['photo', 'video'], MAX.video);
    if ('error' in r) return reply.code(r.error === 'too_large' ? 413 : 415).send({ error: r.error, hint: 'عکس JPEG/PNG/WebP تا ۸MB؛ ویدیو MP4/WebM تا ۲۵۰MB' });
    if (r.kind.kind === 'photo' && r.bytes > MAX.photo) { removeStored('recipes', r.name); return reply.code(413).send({ error: 'too_large' }); }
    try {
      const m = await withActor(req.actor!, async (q) => (await q(`INSERT INTO recipe_media (recipe_id,kind,file_name,mime,bytes,caption) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,kind`, [id, r.kind.kind, r.name, r.kind.mime, r.bytes, field(file.fields, 'caption') ?? null]))[0]);
      return reply.code(201).send(m);
    } catch (e) { removeStored('recipes', r.name); throw e; }
  });
  app.get('/api/recipe-media/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const [m] = await withActor(req.actor!, (q) => q(`SELECT file_name, mime FROM recipe_media WHERE id=$1`, [id]));
    return m ? sendStored(req, reply, 'recipes', m.file_name, m.mime) : reply.code(404).send({ error: 'not_found' });
  });
  app.delete('/api/recipe-media/:id', { preHandler: requirePerm('recipes', 2) }, async (req, reply) => {
    const [m] = await withActor(req.actor!, (q) => q(`DELETE FROM recipe_media WHERE id=$1 RETURNING file_name`, [zId.parse((req.params as any).id)]));
    if (!m) return reply.code(404).send({ error: 'not_found' }); removeStored('recipes', m.file_name); return { ok: true };
  });
}
