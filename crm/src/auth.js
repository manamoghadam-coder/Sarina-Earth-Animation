'use strict';
const crypto = require('node:crypto');

const SESSION_TTL = 8 * 3600 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const kb = Buffer.from(key, 'hex');
  return kb.length === k.length && crypto.timingSafeEqual(k, kb);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_TTL);
  return token;
}
function userFromToken(db, token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(sha(token), Date.now()) || null;
}
function destroySession(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token)); }
function destroyUserSessions(db, userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** محدودسازی تلاش ورود ناموفق: ۸ بار در ۱۵ دقیقه به ازای هر ip+username */
const attempts = new Map();
function loginThrottle(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.reset < now) attempts.delete(key);
  return (attempts.get(key)?.count || 0) >= 8;
}
function loginFail(key) {
  const now = Date.now();
  const a = attempts.get(key) || { count: 0, reset: now + 15 * 60000 };
  a.count++; attempts.set(key, a);
}
function loginOk(key) { attempts.delete(key); }

const ROLE_RANK = { sales: 1, manager: 2, admin: 3 };
const hasRole = (user, min) => user && ROLE_RANK[user.role] >= ROLE_RANK[min];

module.exports = { hashPassword, verifyPassword, createSession, userFromToken, destroySession,
  destroyUserSessions, parseCookies, loginThrottle, loginFail, loginOk, hasRole, SESSION_TTL };
