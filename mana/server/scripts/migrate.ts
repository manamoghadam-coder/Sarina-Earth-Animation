import fs from 'node:fs';
import path from 'node:path';
import { sysPool } from '../src/db.ts';

const dir = path.resolve(import.meta.dirname, '../migrations');
await sysPool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())`);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const done = await sysPool.query('SELECT 1 FROM schema_migrations WHERE name=$1', [f]);
  if (done.rowCount) continue;
  const c = await sysPool.connect();
  try { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]); await c.query('COMMIT'); console.log('applied', f); }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
// grants for the RLS-bound application role (sessions is deliberately NOT granted)
await sysPool.query(`
  GRANT USAGE ON SCHEMA public TO mana_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mana_app;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mana_app;
  REVOKE ALL ON sessions, schema_migrations FROM mana_app;`);
const { seedContent } = await import('./seed-content.ts'); await seedContent();
console.log('migrations OK');
await sysPool.end();
