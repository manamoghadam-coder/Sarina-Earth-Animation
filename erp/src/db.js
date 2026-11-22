// لایه‌ی دیتابیس async با دو پشتیبان: SQLite (پیش‌فرض، داخلی Node) و PostgreSQL (با DATABASE_URL و بسته‌ی اختیاری pg)
import { ENTITIES, MODULES } from './entities.js';

// ───────────── SQLite ─────────────
async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  let queue = Promise.resolve();
  const db = {
    dialect: 'sqlite',
    async get(sql, ...p) { return raw.prepare(sql).get(...clean(p)); },
    async all(sql, ...p) { return raw.prepare(sql).all(...clean(p)); },
    async run(sql, ...p) { const r = raw.prepare(sql).run(...clean(p)); return { changes: Number(r.changes) }; },
    async insert(sql, ...p) { return Number(raw.prepare(sql).run(...clean(p)).lastInsertRowid); },
    async exec(sql) { raw.exec(sql); },
    async columns(t) { return new Set(raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)); },
    async lock() {},
    // یک اتصال واحد: درخواست‌ها پشت‌سرهم اجرا می‌شوند تا تراکنش‌ها درهم نیامیزند
    serialize(fn) { const r = queue.then(fn, fn); queue = r.catch(() => {}); return r; },
    async tx(fn) {
      raw.exec('BEGIN IMMEDIATE');
      try { const r = await fn(db); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
    legacyVersion() { return raw.prepare('PRAGMA user_version').get().user_version; },
    async close() { raw.close(); },
    ddl: { pk: 'INTEGER PRIMARY KEY AUTOINCREMENT', now: "(datetime('now'))", real: 'REAL' },
  };
  return db;
}
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

// ───────────── PostgreSQL ─────────────
async function openPg(url) {
  let pg;
  try { pg = (await import('pg')).default; } catch { throw new Error('برای PostgreSQL باید بسته‌ی «pg» نصب باشد: npm install pg'); }
  pg.types.setTypeParser(20, (v) => Number(v));   // bigint (COUNT, SUM)
  pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (AVG)
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PGPOOL) || 10 });
  const NOW = "to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')";
  const TODAY = "to_char(now() at time zone 'utc','YYYY-MM-DD')";
  const tr = (sql) => {
    let n = 0;
    return sql.replace(/datetime\('now'\)/g, NOW).replace(/date\('now'\)/g, TODAY).replace(/ LIKE /g, ' ILIKE ').replace(/\?/g, () => `$${++n}`);
  };
  const make = (client) => {
    const q = async (sql, p) => { const r = await client.query(tr(sql), clean(p)); return r; };
    const o = {
      dialect: 'pg',
      async get(sql, ...p) { return (await q(sql, p)).rows[0]; },
      async all(sql, ...p) { return (await q(sql, p)).rows; },
      async run(sql, ...p) { return { changes: (await q(sql, p)).rowCount }; },
      async insert(sql, ...p) { return Number((await q(sql + ' RETURNING id', p)).rows[0].id); },
      async exec(sql) { await client.query(sql); },
      async columns(t) { return new Set((await client.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND table_schema=current_schema()', [t])).rows.map((r) => r.column_name)); },
      async lock(companyId) { await client.query('SELECT pg_advisory_xact_lock($1)', [Number(companyId) || 0]); }, // جلوگیری از رقابت روی موجودی/شماره‌گذاری یک شرکت
      serialize: (fn) => fn(),
      ddl: { pk: 'SERIAL PRIMARY KEY', now: `(${NOW})`, real: 'DOUBLE PRECISION' },
    };
    return o;
  };
  const db = make(pool);
  db.tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(make(c));
      await c.query('COMMIT');
      return r;
    } catch (e) { try { await c.query('ROLLBACK'); } catch { /* ignore */ } throw e; }
    finally { c.release(); }
  };
  db.close = () => pool.end();
  return db;
}

export async function openDb({ file, url }) {
  return url && /^postgres(ql)?:\/\//.test(url) ? openPg(url) : openSqlite(file);
}

// ───────────── طرح پایگاه داده ─────────────
const TYPE = (db) => ({ text: 'TEXT', textarea: 'TEXT', date: 'TEXT', select: 'TEXT', password: 'TEXT', lines: 'TEXT', number: db.ddl.real, money: db.ddl.real, ref: 'INTEGER', bool: 'INTEGER' });

export async function migrate(db) {
  const { pk, now, real } = db.ddl;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id ${pk}, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'ریال',
      modules TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT ${now});
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS counters (company_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, key));
    CREATE TABLE IF NOT EXISTS audit_log (
      id ${pk}, company_id INTEGER, user_id INTEGER, username TEXT, entity TEXT, rec_id INTEGER,
      action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL DEFAULT ${now});
    CREATE INDEX IF NOT EXISTS ix_audit_company ON audit_log(company_id, id DESC);
    CREATE TABLE IF NOT EXISTS gl_lines (
      id ${pk}, company_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      date TEXT NOT NULL, debit ${real} NOT NULL DEFAULT 0, credit ${real} NOT NULL DEFAULT 0, memo TEXT, party_type TEXT, party_id INTEGER);
    CREATE INDEX IF NOT EXISTS ix_gl_acc ON gl_lines(company_id, account_id, date);
    CREATE INDEX IF NOT EXISTS ix_gl_entry ON gl_lines(entry_id);
    CREATE INDEX IF NOT EXISTS ix_gl_party ON gl_lines(company_id, party_type, party_id, date);
    CREATE TABLE IF NOT EXISTS attachments (
      id ${pk}, company_id INTEGER NOT NULL, entity TEXT NOT NULL, rec_id INTEGER NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL,
      sha256 TEXT, stored TEXT NOT NULL, created_by INTEGER, created_by_name TEXT, created_at TEXT NOT NULL DEFAULT ${now});
    CREATE INDEX IF NOT EXISTS ix_att_rec ON attachments(company_id, entity, rec_id);
  `);
  if (!(await db.columns('gl_lines')).has('party_type')) { await db.exec('ALTER TABLE gl_lines ADD COLUMN party_type TEXT'); await db.exec('ALTER TABLE gl_lines ADD COLUMN party_id INTEGER'); }
  if (!(await db.columns('companies')).has('lock_date')) await db.exec('ALTER TABLE companies ADD COLUMN lock_date TEXT');
  const types = TYPE(db);
  for (const def of Object.values(ENTITIES)) {
    const t = 'e_' + def.key;
    const cols = def.fields.map((f) => `"${f.k}" ${types[f.type]}`);
    const cid = def.key === 'users' ? 'company_id INTEGER' : 'company_id INTEGER NOT NULL';
    await db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id ${pk}, ${cid}, ${cols.join(', ')},
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT ${now}, updated_at TEXT)`);
    const have = await db.columns(t);
    for (const f of def.fields) if (!have.has(f.k)) await db.exec(`ALTER TABLE ${t} ADD COLUMN "${f.k}" ${types[f.type]}`);
    await db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_c ON ${t}(company_id)`);
    for (const f of def.fields) {
      if (f.unique) {
        const on = def.key === 'users' ? `"${f.k}"` : `company_id, "${f.k}"`;
        await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_${f.k} ON ${t}(${on})`);
      }
      if (f.type === 'ref' || f.filter) await db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_${f.k} ON ${t}(company_id, "${f.k}")`);
    }
  }
}

export async function schemaVersion(db) {
  const r = await db.get(`SELECT value FROM meta WHERE key='schema'`);
  if (r) return Number(r.value);
  return db.legacyVersion ? db.legacyVersion() : 0; // پایگاه‌های SQLite قدیمی از user_version استفاده می‌کردند
}
export async function setSchemaVersion(db, v) {
  await db.run(`INSERT INTO meta (key,value) VALUES ('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(v));
}

export const allModuleKeys = () => Object.keys(MODULES).filter((m) => m !== 'admin');
