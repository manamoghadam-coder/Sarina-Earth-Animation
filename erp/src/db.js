import { DatabaseSync } from 'node:sqlite';
import { ENTITIES, MODULES } from './entities.js';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
}

const SQLTYPE = { text: 'TEXT', textarea: 'TEXT', date: 'TEXT', select: 'TEXT', password: 'TEXT', lines: 'TEXT', number: 'REAL', money: 'REAL', ref: 'INTEGER', bool: 'INTEGER' };

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'ریال',
      modules TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS counters (company_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, key));
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, user_id INTEGER, username TEXT, entity TEXT, rec_id INTEGER,
      action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE INDEX IF NOT EXISTS ix_audit_company ON audit_log(company_id, id DESC);
    CREATE TABLE IF NOT EXISTS gl_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, entry_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      date TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, memo TEXT);
    CREATE INDEX IF NOT EXISTS ix_gl_acc ON gl_lines(company_id, account_id, date);
    CREATE INDEX IF NOT EXISTS ix_gl_entry ON gl_lines(entry_id);
  `);
  if (!db.prepare('PRAGMA table_info(companies)').all().some((c) => c.name === 'lock_date')) db.exec('ALTER TABLE companies ADD COLUMN lock_date TEXT');
  for (const def of Object.values(ENTITIES)) {
    const t = 'e_' + def.key;
    const cols = def.fields.map((f) => `"${f.k}" ${SQLTYPE[f.type]}`);
    const cid = def.key === 'users' ? 'company_id INTEGER' : 'company_id INTEGER NOT NULL';
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${cid}, ${cols.join(', ')},
      created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`);
    const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    for (const f of def.fields) if (!have.has(f.k)) db.exec(`ALTER TABLE ${t} ADD COLUMN "${f.k}" ${SQLTYPE[f.type]}`);
    db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_c ON ${t}(company_id)`);
    for (const f of def.fields) {
      if (f.unique) {
        const on = def.key === 'users' ? `"${f.k}"` : `company_id, "${f.k}"`;
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_${t}_${f.k} ON ${t}(${on})`);
      }
      if (f.type === 'ref' || f.filter) db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_${f.k} ON ${t}(company_id, "${f.k}")`);
    }
  }
}

export const allModuleKeys = () => Object.keys(MODULES).filter((m) => m !== 'admin');
