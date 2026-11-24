// Emergency: disable two-factor for a user (needs server access). Usage: npx tsx --env-file=.env scripts/reset-2fa.ts <username>
import { sys, sysPool } from '../src/db.ts';
const u = process.argv[2]; if (!u) { console.error('usage: reset-2fa.ts <username>'); process.exit(1); }
const r = await sys(`UPDATE users SET totp_enabled=false, totp_secret=NULL WHERE username=$1 RETURNING username`, [u.toLowerCase()]);
console.log(r.length ? `2FA disabled for ${u}` : 'user not found'); await sysPool.end();
