import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { sys, type Actor } from './db.ts';
import { verify as verifyTotp } from './totp.ts';

const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const got = await scrypt(pw, Buffer.from(s, 'hex'));
  const want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
export const COOKIE = 'mana_session';

/** Progressive lockout: every 5th consecutive failure locks the account for 10 min x 2^(n-1) (max 24 h). Protects short PINs on children's accounts. */
async function failLogin(id: string) {
  await sys(`UPDATE users SET failed_logins = failed_logins + 1,
    locked_until = CASE WHEN (failed_logins + 1) % 5 = 0 THEN now() + LEAST(interval '24 hours', interval '10 minutes' * power(2, ((failed_logins + 1) / 5) - 1)) ELSE locked_until END WHERE id = $1`, [id]);
}
export async function login(username: string, password: string, ua?: string, totp?: string) {
  const [u] = await sys(`SELECT id, role, display_name, password_hash, active, locked_until, failed_logins, totp_enabled, totp_secret FROM users WHERE username = $1`, [username.toLowerCase()]);
  // Always run a hash to keep timing similar for unknown users
  const ok = u ? await verifyPassword(password, u.password_hash) : (await verifyPassword(password, 'scrypt$00$00'), false);
  if (!u || !u.active) return null;
  if (u.locked_until && new Date(u.locked_until) > new Date()) return { locked: true as const };
  if (!ok) {
    await failLogin(u.id);
    return null;
  }
  if (u.totp_enabled) {
    if (!totp) return { totp_required: true as const };
    if (!u.totp_secret || !verifyTotp(u.totp_secret, totp)) {
      await failLogin(u.id);
      return null;
    }
  }
  await sys(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [u.id]);
  const token = crypto.randomBytes(32).toString('base64url');
  await sys(`INSERT INTO sessions (user_id, token_hash, user_agent, expires_at) VALUES ($1,$2,$3, now() + $4::int * interval '1 day')`, [u.id, sha(token), ua?.slice(0, 200) ?? null, config.sessionDays]);
  return { token, user: { id: u.id as string, role: u.role as Actor['role'], display_name: u.display_name as string } };
}
export async function logout(token: string) { await sys(`DELETE FROM sessions WHERE token_hash = $1`, [sha(token)]); }
export async function revokeAll(userId: string) { await sys(`DELETE FROM sessions WHERE user_id = $1`, [userId]); }

export function setCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.prod, path: '/', maxAge: config.sessionDays * 86400 });
}

declare module 'fastify' { interface FastifyRequest { actor?: Actor } }

/** Resolves the session cookie into req.actor. Rejects with 401 when missing/expired. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[COOKIE];
  if (!token) return reply.code(401).send({ error: 'unauthenticated' });
  const [s] = await sys(`SELECT u.id, u.role, u.permissions FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [sha(token)]);
  if (!s) return reply.code(401).send({ error: 'unauthenticated' });
  req.actor = { id: s.id, role: s.role, perms: s.role === 'parent' ? undefined : s.permissions };
  // CSRF defence in depth (cookie is SameSite=Strict): state-changing requests must be same-origin XHR/fetch
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'mana') return reply.code(403).send({ error: 'csrf' });
}
export async function requireParent(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.actor!.role !== 'parent') return reply.code(403).send({ error: 'forbidden' });
}

/** Work modules: only Mana and adult members (Vahid) can ever hold them. */
export const MODULES = ['tasks', 'events', 'finance', 'debts', 'goals', 'children', 'photos', 'library', 'recipes', 'shopping', 'health'] as const;
/** Personal features for EVERY non-parent account (children and members); Mana always has full access. Defaults apply until Mana sets a value. */
export const FEATURE_DEFAULTS = { diary: 2, chat: 2, inbox: 1, avatar: 2, wishes: 2 } as const;
export const FEATURES = Object.keys(FEATURE_DEFAULTS) as (keyof typeof FEATURE_DEFAULTS)[];
export const level = (a: Actor, m: string) => {
  if (a.role === 'parent') return 2;
  const clamp = (n: number) => Math.min(2, Math.max(0, n));
  if (m in FEATURE_DEFAULTS) return clamp(Number(a.perms?.[m] ?? FEATURE_DEFAULTS[m as keyof typeof FEATURE_DEFAULTS]));
  return a.role === 'member' ? clamp(Number(a.perms?.[m] ?? 0)) : 0;
};
/** API-level gate (the database enforces the same rule through RLS). need: 1=read, 2=write. */
export const requirePerm = (m: (typeof MODULES)[number] | (typeof FEATURES)[number], need: 1 | 2) => async (req: FastifyRequest, reply: FastifyReply) => {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (level(req.actor!, m) < need) return reply.code(403).send({ error: 'forbidden' });
};
/** Mana or the father (any adult account); never children. */
export async function requireAdult(req: FastifyRequest, reply: FastifyReply) {
  await requireUser(req, reply);
  if (reply.sent) return;
  if (req.actor!.role === 'child') return reply.code(403).send({ error: 'forbidden' });
}
