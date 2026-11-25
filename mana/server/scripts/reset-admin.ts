// Emergency/first-use: creates or resets an ADMINISTRATOR account (works even if nobody remembers any password).
// Usage: npx tsx --env-file=.env scripts/reset-admin.ts <username> "<password>" ["display name"]
import { sys, sysPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
const [u, pw, name] = process.argv.slice(2);
if (!u || !pw) { console.error('usage: reset-admin.ts <username> "<password>" ["display name"]'); process.exit(1); }
if (!/^[a-z0-9_]{3,32}$/.test(u)) { console.error('username must be 3-32 chars: a-z, 0-9, _'); process.exit(1); }
if (pw.length < 8) { console.error('admin password must be at least 8 characters'); process.exit(1); }
const hash = await hashPassword(pw);
const r = await sys(`INSERT INTO users (username,display_name,role,password_hash,permissions,age_group,active) VALUES ($1,$2,'parent',$3,'{}','adult',true)
  ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, role='parent', active=true, failed_logins=0, locked_until=NULL, totp_enabled=false, totp_secret=NULL RETURNING username`, [u, name ?? u, hash]);
await sys(`DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=$1)`, [u]);
console.log(`OK: administrator "${r[0].username}" is ready. You can sign in now.`); await sysPool.end();
