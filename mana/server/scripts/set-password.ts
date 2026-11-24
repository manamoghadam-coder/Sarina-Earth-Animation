// Usage: npx tsx --env-file=.env scripts/set-password.ts <username> <password>
import { sys, sysPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
const [u, p] = process.argv.slice(2); if (!u || !p) { console.error('usage: set-password.ts <username> <password>'); process.exit(1); }
const r = await sys(`UPDATE users SET password_hash=$2, failed_logins=0, locked_until=NULL WHERE username=$1 RETURNING username`, [u.toLowerCase(), await hashPassword(p)]);
await sys(`DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=$1)`, [u.toLowerCase()]);
console.log(r.length ? `password updated for ${u}` : 'user not found'); await sysPool.end();
