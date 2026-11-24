import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE, MODULES, hashPassword, level, login, logout, requireUser, requireParent, revokeAll, setCookie, verifyPassword } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { zId } from '../util.ts';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { rateLimit: { max: Number(process.env.LOGIN_RATE_MAX ?? 10), timeWindow: '1 minute' } } }, async (req, reply) => {
    const { username, password, totp } = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() }).strict().parse(req.body);
    if (req.headers['x-requested-with'] !== 'mana') return reply.code(403).send({ error: 'csrf' });
    const r = await login(username, password, req.headers['user-agent'], totp);
    if (r && 'totp_required' in r) return reply.code(401).send({ error: 'totp_required', message: 'کد تأیید دومرحله‌ای را وارد کنید.' });
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
    const [u] = await q(`SELECT id, username, display_name, role, avatar_photo_id, age_group, totp_enabled FROM users WHERE id=$1`, [req.actor!.id]);
    const [s] = u.role === 'child' ? await q(`SELECT * FROM child_settings WHERE child_id=$1`, [u.id]) : [null];
    const permissions = Object.fromEntries(MODULES.map((m) => [m, level(req.actor!, m)]));
    return { ...u, settings: s, permissions };
  }));
  // parent changes own password (requires current)
  app.post('/api/auth/password', { preHandler: requireUser }, async (req, reply) => {
    if (req.actor!.role === 'child') return reply.code(403).send({ error: 'forbidden' });
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
  // ----- Mana defines what other adults (e.g. Vahid) may do -----
  app.get('/api/members', { preHandler: requireParent }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, username, display_name, active, permissions FROM users WHERE role='member' ORDER BY display_name`)));
  app.patch('/api/members/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const lv = z.number().int().min(0).max(2);
    const b = z.object({ permissions: z.object(Object.fromEntries(MODULES.map((m) => [m, lv.optional()])) as any).strict().optional(), active: z.boolean().optional() }).strict().parse(req.body);
    const r = await withActor(req.actor!, async (q) => {
      const [u] = await q(`SELECT permissions FROM users WHERE id=$1 AND role='member'`, [id]);
      if (!u) return null;
      const perms = { ...u.permissions, ...(b.permissions ?? {}) };
      const [x] = await q(`UPDATE users SET permissions=$2, active=COALESCE($3, active) WHERE id=$1 RETURNING id, username, display_name, active, permissions`, [id, perms, b.active ?? null]);
      await q(`INSERT INTO audit_log (user_id, action, detail) VALUES ($1,'member_permissions',$2)`, [req.actor!.id, { member: id, permissions: x.permissions, active: x.active }]);
      return x;
    });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (!r.active) await revokeAll(id);
    return r;
  });
  app.post('/api/members/:id/password', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { password } = z.object({ password: z.string().min(8).max(100) }).strict().parse(req.body);
    const hash = await hashPassword(password);
    const rows = await withActor(req.actor!, (q) => q(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE id=$1 AND role='member' RETURNING id`, [id, hash]));
    if (!rows[0]) return reply.code(404).send({ error: 'not_found' });
    await revokeAll(id);
    return { ok: true };
  });
}
