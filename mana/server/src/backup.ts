import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.ts';
import { sys } from './db.ts';
import { storeDir } from './files.ts';

export const backupDir = () => storeDir('backups');
const manifestPath = () => path.join(backupDir(), 'manifest.json');
type Manifest = { lastCheck?: string; db?: { fp: string; name: string; at: string }; files?: { fp: string; name: string; at: string } };
const readManifest = (): Manifest => { try { return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')); } catch { return {}; } };
const writeManifest = (m: Manifest) => fs.writeFileSync(manifestPath(), JSON.stringify(m), { mode: 0o600 });
const run = (cmd: string, args: string[]) => new Promise<void>((res, rej) => { const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => (err += d)); p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}: ${err.slice(0, 300)}`)))); });

/** Fingerprint of the data: change counters of every table (inserts/updates/deletes). Identical fingerprint = nothing changed = no new backup. */
export async function dbFingerprint() {
  const [r] = await sys(`SELECT md5(COALESCE(string_agg(relname || ':' || n_tup_ins || ':' || n_tup_upd || ':' || n_tup_del, ',' ORDER BY relname), '')) AS fp FROM pg_stat_user_tables`);
  return r.fp as string;
}
/** Fingerprint of uploaded files: name + size + mtime of everything under photos/library/recipes/taskfiles. */
export function filesFingerprint() {
  const root = path.resolve(config.storageDir); const h = crypto.createHash('sha256'); const subs = ['photos', 'library', 'recipes', 'taskfiles'].filter((s) => fs.existsSync(path.join(root, s)));
  for (const s of subs) for (const f of fs.readdirSync(path.join(root, s)).sort()) { const st = fs.statSync(path.join(root, s, f)); h.update(`${s}/${f}:${st.size}:${Math.floor(st.mtimeMs)};`); }
  return { fp: h.digest('hex'), subs };
}
export const getSettingNum = async (key: string, def: number) => { const [r] = await sys(`SELECT value FROM settings WHERE key=$1`, [key]); const n = Number(r?.value); return Number.isFinite(n) && n > 0 ? n : def; };

export type BackupResult = { db: string | null; files: string | null; skipped: ('db' | 'files')[] };
/** Creates a backup only for the parts that changed since the last one (database dump, files archive). force=true always backs up both. */
export async function runBackup(opts: { force?: boolean } = {}): Promise<BackupResult> {
  const dir = backupDir(); const m = readManifest(); const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); const out: BackupResult = { db: null, files: null, skipped: [] };
  const dfp = await dbFingerprint(); const { fp: ffp, subs } = filesFingerprint();
  if (opts.force || m.db?.fp !== dfp) { const name = `db-${stamp}.dump`; await run('pg_dump', ['--format=custom', '--file', path.join(dir, name), config.dbOwnerUrl]); fs.chmodSync(path.join(dir, name), 0o600); m.db = { fp: dfp, name, at: new Date().toISOString() }; out.db = name; } else out.skipped.push('db');
  if (opts.force || m.files?.fp !== ffp) {
    const name = `files-${stamp}.tgz`; const root = path.resolve(config.storageDir);
    if (subs.length) await run('tar', ['-czf', path.join(dir, name), '-C', root, ...subs]); else fs.writeFileSync(path.join(dir, name), '');
    fs.chmodSync(path.join(dir, name), 0o600); m.files = { fp: ffp, name, at: new Date().toISOString() }; out.files = name;
  } else out.skipped.push('files');
  m.lastCheck = new Date().toISOString(); writeManifest(m);
  const keep = await getSettingNum('backup_keep', Number(process.env.BACKUP_KEEP ?? 7));
  for (const prefix of ['db-', 'files-']) { const keepNames = new Set([m.db?.name, m.files?.name]); fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().reverse().slice(keep).filter((f) => !keepNames.has(f)).forEach((f) => fs.rmSync(path.join(dir, f), { force: true })); }
  return out;
}
export function listBackups() {
  const dir = backupDir();
  return fs.readdirSync(dir).filter((f) => /^(db|files)-\d{14}\.(dump|tgz)$/.test(f)).sort().reverse().map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}
export const backupStatus = async () => ({ lastCheck: readManifest().lastCheck ?? null, intervalHours: await getSettingNum('backup_interval_hours', Number(process.env.BACKUP_INTERVAL_HOURS ?? 24)), keep: await getSettingNum('backup_keep', Number(process.env.BACKUP_KEEP ?? 7)) });
/** Scheduler hook: is a check due? (interval elapsed since the last check; daily/longer intervals run after 03:00 Tehran.) */
export async function backupDue(nowHourTehran: number, now = new Date()) {
  const s = await backupStatus(); const last = s.lastCheck ? new Date(s.lastCheck).getTime() : 0;
  return now.getTime() - last >= s.intervalHours * 3600_000 && (s.intervalHours < 24 || nowHourTehran >= 3);
}
