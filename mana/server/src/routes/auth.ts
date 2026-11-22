import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE, hashPassword, login, logout, requireUser, requireParent, revokeAll, setCookie, verifyPassword } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { zId } from '../util.ts';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password } = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).strict().parse(req.body);
    if (req.headers['x-requested-with'] !== 'mana') return reply.code(403).send({ error: 'csrf' });
    const r = await login(username, password, req.headers['user-agent']);
    if (r && 'locked' in r) return reply.code(429).send({ error: 'locked', message: 'به‌دلیل تلاش‌های ناموفق، ورود موقتاً قفل شد.' });
    if (!r) return reply.code(401).send({ error: 'bad_credentials', message: 'نام کاربری یا رمز عبور درست نیست.' });
    setCookie(reply, r.token);
    return { user: r.user };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const t = req.cookies[COOKIE];
    if (t) await logout(t);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/me', { preHandler: requireUser }, async (req) => withActor(req.actor!, async (q) => {
    const [u] = await q(`SELECT id, username, display_name, role, avatar_photo_id FROM users WHERE id=$1`, [req.actor!.id]);
    const [s] = u.role === 'child' ? await q(`SELECT * FROM child_settings WHERE child_id=$1`, [u.id]) : [null];
    return { ...u, settings: s };
  }));
  // parent changes own password (requires current)
  app.post('/api/auth/password', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role !== 'parent') return reply.code(403).send({ error: 'forbidden' });
    const { current, next } = z.object({ current: z.string(), next: z.string().min(8).max(100) }).strict().parse(req.body);
    const [u] = await sys(`SELECT password_hash FROM users WHERE id=$1`, [req.actor!.id]);
    if (!(await verifyPassword(current, u.password_hash))) return reply.code(401).send({ error: 'bad_credentials' });
    await sys(`UPDATE users SET password_hash=$2 WHERE id=$1`, [req.actor!.id, await hashPassword(next)]);
    await revokeAll(req.actor!.id); reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true, relogin: true };
  });
  app.get('/api/settings', { preHandler: requireUser }, async (req) => withActor(req.actor!, (q) => q(`SELECT key, value FROM settings`)));
  app.put('/api/settings/:key', { preHandler: requireParent }, async (req) => {
    const key = z.enum(['currency']).parse((req.params as any).key);
    const { value } = z.object({ value: z.string().min(1).max(20) }).parse(req.body);
    await withActor(req.actor!, (q) => q(`UPDATE settings SET value=$2::jsonb WHERE key=$1`, [key, JSON.stringify(value)]));
    return { ok: true };
  });
  void zId;
}
