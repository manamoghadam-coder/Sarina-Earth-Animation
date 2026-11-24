import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, requireParent, revokeAll, verifyPassword } from '../auth.ts';
import { backupDir, backupStatus, listBackups, runBackup } from '../backup.ts';
import { sys, withActor } from '../db.ts';
import { zId, zText } from '../util.ts';
import { newSecret, otpauth, verify } from '../totp.ts';

export default async function adminRoutes(app: FastifyInstance) {
  // ----- accounts (Mana only) -----
  app.get('/api/users', { preHandler: requireParent }, async (req) => withActor(req.actor!, (q) => q(`SELECT id, username, display_name, role, age_group, active FROM users ORDER BY role, display_name`)));
  app.post('/api/users', { preHandler: requireParent }, async (req, reply) => {
    const b = z.object({ username: z.string().regex(/^[a-z0-9_]{3,32}$/), display_name: zText(40), role: z.enum(['member', 'child']), age_group: z.enum(['young', 'teen', 'adult']).optional(), password: z.string().min(4).max(100) }).strict().parse(req.body);
    const age = b.role === 'member' ? 'adult' : (b.age_group === 'adult' || !b.age_group ? 'teen' : b.age_group);
    const hash = await hashPassword(b.password);
    const row = await withActor(req.actor!, async (q) => {
      const [u] = await q(`INSERT INTO users (username, display_name, role, password_hash, age_group, permissions) VALUES ($1,$2,$3,$4,$5,'{}') RETURNING id, username, display_name, role, age_group`, [b.username, b.display_name, b.role, hash, age]);
      if (b.role === 'child') await q(`INSERT INTO child_settings (child_id) VALUES ($1)`, [u.id]);
      await q(`INSERT INTO audit_log (user_id, action, detail) VALUES ($1,'user_created',$2)`, [req.actor!.id, { username: b.username, role: b.role }]);
      return u;
    });
    return reply.code(201).send(row);
  });
  app.patch('/api/users/:id', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id); const b = z.object({ display_name: zText(40), active: z.boolean(), age_group: z.enum(['young', 'teen', 'adult']) }).partial().strict().parse(req.body);
    if (id === req.actor!.id && b.active === false) return reply.code(409).send({ error: 'cannot_deactivate_self' });
    const keys = Object.keys(b); if (!keys.length) return reply.code(400).send({ error: 'empty' });
    const r = await withActor(req.actor!, (q) => q(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING id, username, active`, [id, ...keys.map((k) => (b as any)[k])]));
    if (!r[0]) return reply.code(404).send({ error: 'not_found' }); if (b.active === false) await revokeAll(id); return r[0];
  });

  // ----- backups -----
  app.get('/api/backups', { preHandler: requireParent }, async () => ({ items: listBackups(), ...(await backupStatus()) }));
  app.put('/api/backups/settings', { preHandler: requireParent }, async (req) => {
    const b = z.object({ interval_hours: z.number().int().min(1).max(168), keep: z.number().int().min(2).max(60) }).strict().parse(req.body);
    for (const [k, v] of [['backup_interval_hours', b.interval_hours], ['backup_keep', b.keep]] as const) await sys(`INSERT INTO settings (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(v)]);
    return { ok: true };
  });
  app.post('/api/backups/run', { preHandler: requireParent }, async (req, reply) => { try { return await runBackup({ force: (req.query as any).force === '1' }); } catch (e: any) { req.log.error(e); return reply.code(500).send({ error: 'backup_failed', message: String(e.message).slice(0, 200) }); } });
  app.get('/api/backups/:name', { preHandler: requireParent }, async (req, reply) => {
    const name = z.string().regex(/^(db|files)-\d{14}\.(dump|tgz)$/).parse((req.params as any).name); const p = path.join(backupDir(), name);
    if (!fs.existsSync(p)) return reply.code(404).send({ error: 'not_found' });
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${name}"`).send(fs.createReadStream(p));
  });

  // ----- two-factor (TOTP) for Mana -----
  app.post('/api/auth/2fa/setup', { preHandler: requireParent }, async (req) => {
    const [u] = await sys(`SELECT username, totp_enabled FROM users WHERE id=$1`, [req.actor!.id]);
    if (u.totp_enabled) return { enabled: true };
    const secret = newSecret(); await sys(`UPDATE users SET totp_secret=$2 WHERE id=$1`, [req.actor!.id, secret]);
    return { enabled: false, secret, uri: otpauth(secret, u.username) };
  });
  app.post('/api/auth/2fa/enable', { preHandler: requireParent }, async (req, reply) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
    const [u] = await sys(`SELECT totp_secret FROM users WHERE id=$1`, [req.actor!.id]);
    if (!u?.totp_secret || !verify(u.totp_secret, code)) return reply.code(400).send({ error: 'bad_code', message: 'کد درست نیست. ساعت گوشی را بررسی و دوباره امتحان کنید.' });
    await sys(`UPDATE users SET totp_enabled=true WHERE id=$1`, [req.actor!.id]); return { ok: true };
  });
  app.post('/api/auth/2fa/disable', { preHandler: requireParent }, async (req, reply) => {
    const { password, code } = z.object({ password: z.string(), code: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
    const [u] = await sys(`SELECT password_hash, totp_secret FROM users WHERE id=$1`, [req.actor!.id]);
    if (!(await verifyPassword(password, u.password_hash)) || !u.totp_secret || !verify(u.totp_secret, code)) return reply.code(400).send({ error: 'bad_credentials' });
    await sys(`UPDATE users SET totp_enabled=false, totp_secret=NULL WHERE id=$1`, [req.actor!.id]); return { ok: true };
  });
}
