import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(20, (v) => Number(v));           // bigint -> number (amounts fit in 2^53)
pg.types.setTypeParser(1082, (v) => v);                 // date -> 'YYYY-MM-DD' string
pg.types.setTypeParser(1083, (v) => v.slice(0, 5));     // time -> 'HH:MM'
pg.types.setTypeParser(1183 as any, (v) => (v === '{}' ? [] : v.slice(1, -1).split(',').map((x) => x.slice(0, 5))));   // time[] -> ['HH:MM']

/** Request pool: connects as mana_app (RLS enforced). */
export const appPool = new pg.Pool({ connectionString: config.dbUrl, max: 10 });
/** System pool: owner role. Only auth.ts, scheduler.ts and scripts may import this. */
export const sysPool = new pg.Pool({ connectionString: config.dbOwnerUrl, max: 4 });

export type Actor = { id: string; role: 'parent' | 'member' | 'child'; perms?: Record<string, number> };
export type Q = <T = any>(sql: string, params?: any[]) => Promise<T[]>;

/** Runs fn inside a transaction with the DB session bound to the actor, so Row Level Security applies. */
export async function withActor<T>(actor: Actor, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true)`, [actor.id, actor.role]);
    const q: Q = async (sql, params) => (await c.query(sql, params)).rows;
    const out = await fn(q);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}
export const sys = async <T = any>(sql: string, params?: any[]) => (await sysPool.query(sql, params)).rows as T[];
