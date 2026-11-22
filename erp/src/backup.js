// پشتیبان‌گیری و بازیابی: دیتابیس (SQLite یا PostgreSQL) + فایل‌های پیوست در یک آرشیو tar.gz (اختیاری: رمزنگاری AES-256-GCM)
//
//   node src/backup.js backup                 ← ساخت پشتیبان
//   node src/backup.js verify  <فایل>         ← بررسی صحت (بدون تغییر چیزی)
//   node src/backup.js restore <فایل> [--force]  ← بازیابی (سرور را قبلاً متوقف کنید)
//   node src/backup.js list                   ← فهرست پشتیبان‌ها
//
// متغیرها: ERP_DATA_DIR, DATABASE_URL, ERP_FILES_DIR, ERP_BACKUP_DIR (پیش‌فرض <data>/backups), ERP_BACKUP_KEEP (۱۴),
//          ERP_BACKUP_KEY (گذرواژه‌ی رمزنگاری؛ خالی = بدون رمزنگاری), ERP_BACKUP_HOOK (دستور shell پس از ساخت؛ مسیر فایل در BACKUP_FILE)
// سر راز نشست (secret.key) عمداً در پشتیبان نیست.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const MAGIC = Buffer.from('ERPB1');
const isPg = (url) => !!url && /^postgres(ql)?:\/\//.test(url);
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.error) throw new Error(`اجرای ${cmd} ممکن نیست: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} با خطا تمام شد: ${(r.stderr || '').trim().slice(0, 400)}`);
  return r.stdout;
};
const stamp = () => { const d = new Date(), p = (n, w = 2) => String(n).padStart(w, '0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`; };

// اتصال PostgreSQL: گذرواژه از طریق env (نه آرگومان) تا در فهرست پردازش‌ها دیده نشود
function pgArgs(url) {
  const u = new URL(url);
  const env = { ...process.env };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  if (u.searchParams.get('sslmode')) env.PGSSLMODE = u.searchParams.get('sslmode');
  const args = ['-h', u.hostname || 'localhost', '-p', u.port || '5432', '-U', decodeURIComponent(u.username || 'postgres')];
  return { args, env, db: u.pathname.replace(/^\//, '') };
}

// ─── رمزنگاری جریانی: ERPB1 | salt(16) | iv(12) | ciphertext | tag(16) ───
async function encryptFile(src, dst, passphrase) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv);
  const out = fs.createWriteStream(dst);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(src), cipher, out, { end: false }); // tag پس از پایان نوشته می‌شود
  await new Promise((res, rej) => out.end(cipher.getAuthTag(), (e) => (e ? rej(e) : res())));
}
async function decryptFile(src, dst, passphrase) {
  const size = fs.statSync(src).size;
  if (size < MAGIC.length + 28 + 16) throw new Error('فایل پشتیبان ناقص است');
  const fd = fs.openSync(src, 'r'); const head = Buffer.alloc(MAGIC.length + 28), tag = Buffer.alloc(16);
  fs.readSync(fd, head, 0, head.length, 0); fs.readSync(fd, tag, 0, 16, size - 16); fs.closeSync(fd);
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('فرمت فایل رمزنگاری‌شده‌ی پشتیبان نامعتبر است');
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16), iv = head.subarray(MAGIC.length + 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  try { await pipeline(fs.createReadStream(src, { start: head.length, end: size - 17 }), decipher, fs.createWriteStream(dst)); }
  catch { throw new Error('رمزگشایی ناموفق: گذرواژه‌ی پشتیبان اشتباه است یا فایل دست‌کاری/خراب شده است'); }
}

// ─── ساخت پشتیبان ───
export async function createBackup({ dataDir, databaseUrl, filesDir, outDir, key, keep = 14, hook } = {}) {
  dataDir = path.resolve(dataDir || process.env.ERP_DATA_DIR || 'data');
  databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? '';
  filesDir = path.resolve(filesDir || process.env.ERP_FILES_DIR || path.join(dataDir, 'files'));
  outDir = path.resolve(outDir || process.env.ERP_BACKUP_DIR || path.join(dataDir, 'backups'));
  key = key ?? process.env.ERP_BACKUP_KEY ?? '';
  keep = Number(keep ?? process.env.ERP_BACKUP_KEEP ?? 14);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(path.join(outDir, '.tmp-'));
  try {
    const manifest = { format: 1, app: 'persian-erp', created: new Date().toISOString(), dialect: isPg(databaseUrl) ? 'pg' : 'sqlite', files: {} };
    if (manifest.dialect === 'pg') {
      const { args, env, db } = pgArgs(databaseUrl);
      sh('pg_dump', [...args, '-d', db, '--format=custom', '--no-owner', '--file', path.join(tmp, 'db.pgc')], { env });
      manifest.db = 'db.pgc';
    } else {
      const src = path.join(dataDir, 'erp.db');
      if (!fs.existsSync(src)) throw new Error(`دیتابیس یافت نشد: ${src}`);
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(src);
      try { raw.exec('PRAGMA busy_timeout=10000'); raw.exec(`VACUUM INTO '${path.join(tmp, 'erp.db').replace(/'/g, "''")}'`); } finally { raw.close(); } // نسخه‌ی یکپارچه حتی هنگام کار سرور
      manifest.db = 'erp.db';
    }
    if (fs.existsSync(filesDir)) fs.cpSync(filesDir, path.join(tmp, 'files'), { recursive: true });
    else fs.mkdirSync(path.join(tmp, 'files'));
    manifest.files[manifest.db] = sha256File(path.join(tmp, manifest.db));
    const walk = (d, rel = 'files') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = `${rel}/${e.name}`; e.isDirectory() ? walk(p, r) : (manifest.files[r] = sha256File(p)); } };
    walk(path.join(tmp, 'files'));
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const base = `erp-backup-${stamp()}.tar.gz`;
    const tar = path.join(tmp, base);
    sh('tar', ['-czf', tar, '-C', tmp, 'manifest.json', manifest.db, 'files']);
    let final = path.join(outDir, base);
    if (key) { final += '.enc'; await encryptFile(tar, final, key); } else fs.renameSync(tar, final);
    fs.chmodSync(final, 0o600);
    const digest = sha256File(final);
    fs.writeFileSync(final + '.sha256', `${digest}  ${path.basename(final)}\n`);

    // نگهداری چرخشی: فقط آخرین keep پشتیبان
    const all = fs.readdirSync(outDir).filter((f) => /^erp-backup-.*\.tar\.gz(\.enc)?$/.test(f)).sort();
    if (keep > 0) for (const f of all.slice(0, Math.max(0, all.length - keep))) { fs.rmSync(path.join(outDir, f)); fs.rmSync(path.join(outDir, f + '.sha256'), { force: true }); }

    hook = hook ?? process.env.ERP_BACKUP_HOOK;
    if (hook) { const r = spawnSync(hook, { shell: true, stdio: 'inherit', env: { ...process.env, BACKUP_FILE: final } }); if (r.status !== 0) throw new Error(`hook پشتیبان با کد ${r.status} تمام شد (فایل پشتیبان ساخته شده است: ${final})`); }
    return { file: final, bytes: fs.statSync(final).size, sha256: digest, encrypted: !!key, dialect: manifest.dialect, created: manifest.created };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// استخراج به پوشه‌ی موقت + بررسی صحت؛ پوشه‌ی استخراج‌شده و manifest را برمی‌گرداند
async function unpack(file, key) {
  file = path.resolve(file);
  if (!fs.existsSync(file)) throw new Error(`فایل یافت نشد: ${file}`);
  const side = file + '.sha256';
  if (fs.existsSync(side)) { const want = fs.readFileSync(side, 'utf8').split(/\s+/)[0]; if (want !== sha256File(file)) throw new Error('جمع‌کنترل (sha256) فایل پشتیبان با فایل .sha256 مطابقت ندارد؛ فایل خراب یا دست‌کاری شده است'); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-restore-'));
  try {
    let tar = file;
    if (file.endsWith('.enc')) {
      if (!key) throw new Error('این پشتیبان رمزنگاری شده است؛ ERP_BACKUP_KEY را تنظیم کنید');
      tar = path.join(work, 'dec.tar.gz'); await decryptFile(file, tar, key);
    }
    const out = path.join(work, 'x'); fs.mkdirSync(out);
    sh('tar', ['-xzf', tar, '-C', out, '--no-same-owner']);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    if (manifest.app !== 'persian-erp' || manifest.format !== 1) throw new Error('فرمت پشتیبان ناشناخته است');
    for (const [rel, want] of Object.entries(manifest.files)) {
      const p = path.resolve(out, rel);
      if (!p.startsWith(out + path.sep) || !fs.existsSync(p)) throw new Error(`فایل ${rel} در پشتیبان نیست`);
      if (sha256File(p) !== want) throw new Error(`جمع‌کنترل ${rel} نادرست است؛ پشتیبان خراب شده`);
    }
    if (manifest.dialect === 'sqlite') {
      const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(path.join(out, manifest.db), { readOnly: true });
      const ic = d.prepare('PRAGMA integrity_check').get(); d.close();
      if (Object.values(ic)[0] !== 'ok') throw new Error('بررسی یکپارچگی SQLite ناموفق است');
    } else sh('pg_restore', ['-l', path.join(out, manifest.db)]);
    return { work, out, manifest };
  } catch (e) { fs.rmSync(work, { recursive: true, force: true }); throw e; }
}

export async function verifyBackup({ file, key }) {
  const { work, manifest } = await unpack(file, key ?? process.env.ERP_BACKUP_KEY);
  fs.rmSync(work, { recursive: true, force: true });
  return { ok: true, created: manifest.created, dialect: manifest.dialect, files: Object.keys(manifest.files).length - 1 };
}

export async function restoreBackup({ file, dataDir, databaseUrl, filesDir, key, force = false }) {
  dataDir = path.resolve(dataDir || process.env.ERP_DATA_DIR || 'data');
  databaseUrl = databaseUrl ?? process.env.DATABASE_URL ?? '';
  filesDir = path.resolve(filesDir || process.env.ERP_FILES_DIR || path.join(dataDir, 'files'));
  const { work, out, manifest } = await unpack(file, key ?? process.env.ERP_BACKUP_KEY);
  try {
    if ((manifest.dialect === 'pg') !== isPg(databaseUrl)) throw new Error(`نوع دیتابیس پشتیبان (${manifest.dialect}) با تنظیمات فعلی (${isPg(databaseUrl) ? 'pg' : 'sqlite'}) یکی نیست`);
    const ts = stamp(); fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const sideline = (p) => { if (fs.existsSync(p)) { if (!force) throw new Error(`مقصد خالی نیست: ${p} — برای جایگزینی از --force استفاده کنید (نسخه‌ی قبلی کنار گذاشته می‌شود)`); fs.renameSync(p, `${p}.pre-restore-${ts}`); } };
    if (manifest.dialect === 'sqlite') {
      const dbFile = path.join(dataDir, 'erp.db');
      sideline(dbFile); for (const x of ['-wal', '-shm']) fs.rmSync(dbFile + x, { force: true });
      fs.copyFileSync(path.join(out, manifest.db), dbFile);
    } else {
      const { args, env, db } = pgArgs(databaseUrl);
      const n = Number(sh('psql', [...args, '-d', db, '-tA', '-c', "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], { env }).trim());
      if (n > 0 && !force) throw new Error('دیتابیس مقصد خالی نیست؛ برای جایگزینی از --force استفاده کنید');
      sh('pg_restore', [...args, '-d', db, '--clean', '--if-exists', '--no-owner', '--exit-on-error', path.join(out, manifest.db)], { env });
    }
    sideline(filesDir);
    fs.cpSync(path.join(out, 'files'), filesDir, { recursive: true });
    return { restored: true, created: manifest.created, dialect: manifest.dialect };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

export function listBackups(outDir) {
  outDir = path.resolve(outDir || process.env.ERP_BACKUP_DIR || path.join(process.env.ERP_DATA_DIR || 'data', 'backups'));
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir).filter((f) => /^erp-backup-.*\.tar\.gz(\.enc)?$/.test(f)).sort().map((f) => ({ file: path.join(outDir, f), bytes: fs.statSync(path.join(outDir, f)).size }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, file, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'backup') console.log(JSON.stringify(await createBackup()));
    else if (cmd === 'verify' && file) console.log(JSON.stringify(await verifyBackup({ file })));
    else if (cmd === 'restore' && file) console.log(JSON.stringify(await restoreBackup({ file, force: rest.includes('--force') })));
    else if (cmd === 'list') for (const b of listBackups()) console.log(`${(b.bytes / 1048576).toFixed(2)} MB  ${b.file}`);
    else { console.error('استفاده: node src/backup.js backup | verify <فایل> | restore <فایل> [--force] | list'); process.exit(2); }
  } catch (e) { console.error('خطا:', e.message); process.exit(1); }
}
