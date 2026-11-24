// Usage: npx tsx --env-file=.env scripts/create-user.ts <username> "<display name>" <parent|member|child> "<password>" [young|teen]
import { sys, sysPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
const [u, name, role, pw, age] = process.argv.slice(2);
if (!u || !name || !['parent', 'member', 'child'].includes(role) || !pw) { console.error('usage: create-user.ts <username> "<name>" <parent|member|child> "<password>" [young|teen]'); process.exit(1); }
const [x] = await sys(`INSERT INTO users (username,display_name,role,password_hash,permissions,age_group) VALUES ($1,$2,$3,$4,'{}',$5) RETURNING id`, [u.toLowerCase(), name, role, await hashPassword(pw), role === 'child' ? (age ?? 'teen') : 'adult']);
if (role === 'child') await sys(`INSERT INTO child_settings (child_id) VALUES ($1)`, [x.id]);
console.log(`created ${u} (${role})`); await sysPool.end();
