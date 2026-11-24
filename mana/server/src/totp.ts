import crypto from 'node:crypto';
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const newSecret = () => { const b = crypto.randomBytes(20); let bits = '', out = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const decode = (s: string) => { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export function code(secret: string, t = Date.now(), step = 30) {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = crypto.createHmac('sha1', decode(secret)).update(ctr).digest(); const o = h[19] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
/** Accepts the current code and one step either side (clock drift). */
export const verify = (secret: string, c: string, t = Date.now()) => /^\d{6}$/.test(c) && [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(code(secret, t + d * 30000)), Buffer.from(c)));
export const otpauth = (secret: string, account: string) => `otpauth://totp/${encodeURIComponent('Our Little World')}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent('Our Little World')}&digits=6&period=30`;
