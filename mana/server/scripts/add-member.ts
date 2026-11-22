// Usage: npx tsx --env-file=.env scripts/add-member.ts <username> "<display name>"
// Creates an adult "member" account with NO access; Mana grants modules in the app (Settings > Accounts & access).
import crypto from 'node:crypto';
import { sys, sysPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
const [username, name] = process.argv.slice(2);
if (!username || !name) { console.error('usage: add-member.ts <username> "<display name>"'); process.exit(1); }
const pw = process.env.MEMBER_PASSWORD ?? crypto.randomBytes(9).toString('base64url');
await sys(`INSERT INTO users (username,display_name,role,password_hash,permissions) VALUES ($1,$2,'member',$3,'{}')`, [username.toLowerCase(), name, await hashPassword(pw)]);
console.log(`created ${username}; initial password (shown once): ${pw}`);
await sysPool.end();
