import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { requireParent } from './auth.ts';
import { withActor } from './db.ts';

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const zId = z.string().uuid();
export const zText = (max = 300) => z.string().trim().min(1).max(max);

/** Minimal CRUD for parent-only tables. Column names come from the zod schema keys (never from user input). */
export function crud(app: FastifyInstance, path: string, table: string, schema: z.ZodObject<any>, orderBy = 'created_at DESC', filterCols: string[] = []) {
  const cols = Object.keys(schema.shape);
  const patch = schema.partial().strict();
  const body = schema.strict();
  app.get(`/api/${path}`, { preHandler: requireParent }, async (req) => {
    const qs = req.query as Record<string, string>;
    const where: string[] = []; const params: any[] = [];
    for (const f of filterCols) if (qs[f] !== undefined) { params.push(qs[f]); where.push(`${f} = $${params.length}`); }
    return withActor(req.actor!, (q) => q(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy} LIMIT 500`, params));
  });
  app.post(`/api/${path}`, { preHandler: requireParent }, async (req, reply) => {
    const d = body.parse(req.body) as Record<string, any>;
    const keys = cols.filter((c) => d[c] !== undefined);
    const rows = await withActor(req.actor!, (q) => q(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, keys.map((k) => d[k])));
    return reply.code(201).send(rows[0]);
  });
  app.patch(`/api/${path}/:id`, { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const d = patch.parse(req.body) as Record<string, any>;
    const keys = cols.filter((c) => d[c] !== undefined);
    if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const rows = await withActor(req.actor!, (q) => q(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(',')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => d[k])]));
    return rows[0] ?? reply.code(404).send({ error: 'not_found' });
  });
  app.delete(`/api/${path}/:id`, { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const rows = await withActor(req.actor!, (q) => q(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]));
    return rows[0] ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
export const fmtMoney = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
