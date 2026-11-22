import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
}

let SECRET;
export function initSecret(dir) {
  const f = path.join(dir, 'secret.key');
  if (process.env.ERP_SECRET) SECRET = process.env.ERP_SECRET;
  else if (fs.existsSync(f)) SECRET = fs.readFileSync(f, 'utf8');
  else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, SECRET, { mode: 0o600 }); }
}
const b64 = (b) => Buffer.from(b).toString('base64url');
export function signToken(uid, ttlSec = 12 * 3600) {
  const p = b64(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  return `${p}.${sig}`;
}
export function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [p, sig] = tok.split('.');
  const exp = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() / 1000 ? d : null;
  } catch { return null; }
}

// دسترسی نقش‌ها: v=مشاهده c=ایجاد e=ویرایش d=حذف
export const ROLES = {
  superadmin: { label: 'مدیر کل سامانه' },
  admin: { label: 'مدیر شرکت', perms: { '*': 'vced' } },
  manager: { label: 'مدیر ارشد', perms: { hr: 'vce', inventory: 'vce', purchasing: 'vce', sales: 'vce', finance: 'vce', projects: 'vce', quality: 'vce' } },
  hr: { label: 'منابع انسانی', perms: { hr: 'vced', projects: 'v' } },
  inventory: { label: 'انبارداری', perms: { inventory: 'vced', purchasing: 'v', sales: 'v' } },
  purchasing: { label: 'خرید', perms: { purchasing: 'vced', inventory: 'v', finance: 'v' } },
  sales: { label: 'فروش', perms: { sales: 'vced', inventory: 'v', finance: 'v' } },
  finance: { label: 'مالی', perms: { finance: 'vced', sales: 'v', purchasing: 'v', projects: 'v' } },
  project: { label: 'کنترل پروژه (PMO)', perms: { projects: 'vced', quality: 'v', hr: 'v' } },
  qa: { label: 'تضمین کیفیت (QA)', perms: { quality: 'vced', projects: 'v' } },
  viewer: { label: 'مشاهده‌گر', perms: { hr: 'v', inventory: 'v', purchasing: 'v', sales: 'v', finance: 'v', projects: 'v', quality: 'v' } },
};
export function can(role, module, act) {
  if (role === 'superadmin') return true;
  const p = ROLES[role]?.perms;
  if (!p) return false;
  const s = p[module] ?? p['*'] ?? '';
  return s.includes(act);
}
