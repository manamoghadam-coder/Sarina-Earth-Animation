import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { hashPassword, login, setCookie } from '../auth.ts';
import { sys, sysPool } from '../db.ts';

/** Creates the very first administrator. Refuses when any user already exists (checked under an advisory lock). */
export async function createFirstAdmin(c: pg.PoolClient, b: { username: string; display_name: string; password: string }) {
  await c.query('SELECT pg_advisory_xact_lock(5150)');
  const n = Number((await c.query('SELECT count(*) AS n FROM users')).rows[0].n);
  if (n > 0) return null;
  const r = await c.query(`INSERT INTO users (username, display_name, role, password_hash, permissions, age_group) VALUES ($1,$2,'parent',$3,'{}','adult') RETURNING id`, [b.username, b.display_name, await hashPassword(b.password)]);
  await c.query(`INSERT INTO audit_log (user_id, action, detail) VALUES ($1,'first_admin_created',$2)`, [r.rows[0].id, { username: b.username }]);
  return r.rows[0].id as string;
}

export default async function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async () => ({ needs_setup: Number((await sys(`SELECT count(*)::int AS n FROM users`))[0].n) === 0 }));
  app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (req.headers['x-requested-with'] !== 'mana') return reply.code(403).send({ error: 'csrf' });
    const b = z.object({ username: z.string().regex(/^[a-z0-9_]{3,32}$/), display_name: z.string().trim().min(1).max(40), password: z.string().min(8).max(100) }).strict().parse(req.body);
    const c = await sysPool.connect(); let id: string | null = null;
    try { await c.query('BEGIN'); id = await createFirstAdmin(c, b); await c.query(id ? 'COMMIT' : 'ROLLBACK'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    if (!id) return reply.code(409).send({ error: 'already_setup', message: 'راه‌اندازی اولیه قبلاً انجام شده است. با حساب مدیر وارد شوید.' });
    const r = await login(b.username, b.password, req.headers['user-agent'] as string | undefined);
    if (r && 'token' in r && r.token) { setCookie(reply, r.token); return reply.code(201).send({ user: r.user }); }
    return reply.code(201).send({ ok: true });
  });
}
