import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.ts';
import { storeDir } from './files.ts';

const KEEP = Number(process.env.BACKUP_KEEP ?? 7);
export const backupDir = () => storeDir('backups');
const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) => new Promise<void>((res, rej) => { const p = spawn(cmd, args, { env, stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => (err += d)); p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}: ${err.slice(0, 300)}`)))); });

/** Database dump + archive of uploaded files. Both land in storage/backups and old ones are pruned. */
export async function runBackup() {
  const dir = backupDir(); const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const db = path.join(dir, `db-${stamp}.dump`); const files = path.join(dir, `files-${stamp}.tgz`);
  await run('pg_dump', ['--format=custom', '--file', db, config.dbOwnerUrl]);
  const root = path.resolve(config.storageDir); const subs = ['photos', 'library', 'recipes'].filter((s) => fs.existsSync(path.join(root, s)));
  if (subs.length) await run('tar', ['-czf', files, '-C', root, ...subs]); else fs.writeFileSync(files, '');
  for (const prefix of ['db-', 'files-']) fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().reverse().slice(KEEP).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
  fs.chmodSync(db, 0o600); fs.chmodSync(files, 0o600);
  return { db: path.basename(db), files: path.basename(files) };
}
export function listBackups() {
  const dir = backupDir();
  return fs.readdirSync(dir).filter((f) => /^(db|files)-\d{14}\.(dump|tgz)$/.test(f)).sort().reverse().map((f) => ({ name: f, bytes: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }));
}
export const todaysBackupExists = (dayCompact: string) => fs.readdirSync(backupDir()).some((f) => f.startsWith(`db-${dayCompact}`));
