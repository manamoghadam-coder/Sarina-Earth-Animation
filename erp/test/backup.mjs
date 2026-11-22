// تست پشتیبان‌گیری/بازیابی: چرخه‌ی کامل، رمزنگاری، دست‌کاری، چرخش نگهداری، پشتیبان‌گیری هنگام نوشتن
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/seed.js';
import { createBackup, verifyBackup, restoreBackup, listBackups } from '../src/backup.js';

process.env.ERP_SUPERADMIN_PASSWORD = 'Super-Pass-1';
const PG = process.env.TEST_DATABASE_URL || '';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
if (PG) {
  const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: PG });
  await c.connect(); await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await c.end();
}
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

const dir = tmp('erp-bk-'), out = path.join(dir, 'backups');
const { server, db, close } = await createApp({ dataDir: dir, quiet: true, databaseUrl: PG });
await seedDemo(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const login = async () => (await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp': '1' }, body: JSON.stringify({ username: 'demo_admin', password: 'demo1234' }) })).headers.get('set-cookie').split(';')[0];
const cookie = await login();
const api = async (m, u, b) => { const r = await fetch(base + '/api' + u, { method: m, headers: { cookie, 'x-erp': '1', 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
const PDF = Buffer.from('%PDF-1.4 محتوای محرمانه‌ی پیوست %%EOF');
const exId = (await api('GET', '/entities/expenses')).data.rows[0].id;
const up = await fetch(`${base}/api/attachments?entity=expenses&id=${exId}&name=${encodeURIComponent('رسید.pdf')}`, { method: 'POST', headers: { cookie, 'x-erp': '1', 'content-type': 'application/octet-stream' }, body: PDF });
assert.equal(up.status, 201); const att = await up.json();
const itemsBefore = (await api('GET', '/entities/items')).data.total;

let plain;
await t('پشتیبان ساده: فایل، جمع‌کنترل و بررسی صحت', async () => {
  plain = await createBackup({ dataDir: dir, databaseUrl: PG, outDir: out, key: '', keep: 10 });
  assert.ok(fs.existsSync(plain.file) && fs.existsSync(plain.file + '.sha256')); assert.equal(plain.encrypted, false);
  const v = await verifyBackup({ file: plain.file });
  assert.equal(v.ok, true); assert.equal(v.dialect, PG ? 'pg' : 'sqlite'); assert.ok(v.files >= 1);
  assert.equal(fs.statSync(plain.file).mode & 0o077, 0, 'فقط مالک به فایل پشتیبان دسترسی دارد');
});
await t('پشتیبان شامل سر راز نشست نیست', async () => {
  const list = spawnSync('tar', ['-tzf', plain.file], { encoding: 'utf8' }).stdout;
  assert.ok(!list.includes('secret.key')); assert.ok(list.includes('manifest.json'));
});
await t('بازیابی در دایرکتوری تازه: داده‌ها، پیوست (بایت‌به‌بایت) و ورود کاربران سالم است', async () => {
  const d2 = tmp('erp-restored-');
  let url2 = '';
  if (PG) { // بازیابی در دیتابیس دیگر
    spawnSync('psql', ['-h', 'localhost', '-p', '5433', '-U', 'postgres', '-d', 'postgres', '-c', 'DROP DATABASE IF EXISTS erp_restore'], { encoding: 'utf8' });
    assert.equal(spawnSync('psql', ['-h', 'localhost', '-p', '5433', '-U', 'postgres', '-d', 'postgres', '-c', 'CREATE DATABASE erp_restore'], { encoding: 'utf8' }).status, 0);
    url2 = PG.replace(/\/[^/]+$/, '/erp_restore');
  }
  const r = await restoreBackup({ file: plain.file, dataDir: d2, databaseUrl: url2 });
  assert.equal(r.restored, true);
  const app2 = await createApp({ dataDir: d2, quiet: true, databaseUrl: url2 });
  await new Promise((res) => app2.server.listen(0, '127.0.0.1', res));
  const b2 = `http://127.0.0.1:${app2.server.address().port}`;
  const l = await fetch(b2 + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp': '1' }, body: JSON.stringify({ username: 'demo_admin', password: 'demo1234' }) });
  assert.equal(l.status, 200); const c2 = l.headers.get('set-cookie').split(';')[0];
  const items = await (await fetch(b2 + '/api/entities/items', { headers: { cookie: c2 } })).json();
  assert.equal(items.total, itemsBefore);
  const dl = await fetch(`${b2}/api/attachments/${att.id}`, { headers: { cookie: c2, 'x-erp': '1' } });
  assert.equal(dl.status, 200); assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PDF);
  const tb = await (await fetch(b2 + '/api/reports/trial', { headers: { cookie: c2 } })).json();
  assert.equal(tb.totals.debit, tb.totals.credit); // دفتر کل بعد از بازیابی هنوز متوازن
  await app2.close(); fs.rmSync(d2, { recursive: true, force: true });
});
await t('بازیابی روی دیتابیس غیرخالی بدون --force رد می‌شود؛ با --force نسخه‌ی قبلی کنار گذاشته می‌شود', async () => {
  if (PG) return; // برای PG پوشش در تست قبلی (مقصد خالی) و بررسی count در خود تابع است
  const d3 = tmp('erp-force-'); fs.writeFileSync(path.join(d3, 'erp.db'), 'old');
  await assert.rejects(restoreBackup({ file: plain.file, dataDir: d3, databaseUrl: '' }), /--force/);
  assert.equal(fs.readFileSync(path.join(d3, 'erp.db'), 'utf8'), 'old'); // دست‌نخورده
  await restoreBackup({ file: plain.file, dataDir: d3, databaseUrl: '', force: true });
  assert.ok(fs.readdirSync(d3).some((f) => f.startsWith('erp.db.pre-restore-')));
  fs.rmSync(d3, { recursive: true, force: true });
});
let enc;
await t('پشتیبان رمزنگاری‌شده: محتوا خوانا نیست، گذرواژه‌ی غلط/نبودن رد می‌شود', async () => {
  enc = await createBackup({ dataDir: dir, databaseUrl: PG, outDir: out, key: 'کلید-پشتیبان-قوی-123', keep: 10 });
  assert.ok(enc.file.endsWith('.enc')); assert.equal(enc.encrypted, true);
  const raw = fs.readFileSync(enc.file);
  assert.ok(!raw.includes(Buffer.from('SQLite format 3')) && !raw.includes(Buffer.from('PGDMP')) && !raw.includes(PDF), 'متن ساده در فایل رمزنگاری‌شده نباید باشد');
  assert.equal((await verifyBackup({ file: enc.file, key: 'کلید-پشتیبان-قوی-123' })).ok, true);
  await assert.rejects(verifyBackup({ file: enc.file, key: 'غلط' }), /گذرواژه|رمزگشایی/);
  const saved = process.env.ERP_BACKUP_KEY; delete process.env.ERP_BACKUP_KEY;
  await assert.rejects(verifyBackup({ file: enc.file }), /ERP_BACKUP_KEY/);
  if (saved) process.env.ERP_BACKUP_KEY = saved;
});
await t('دست‌کاری فایل پشتیبان (رمزنگاری‌شده، ساده، و جمع‌کنترل) شناسایی می‌شود', async () => {
  const flip = (f, off) => { const b = fs.readFileSync(f); b[off] ^= 0xff; fs.writeFileSync(f, b); };
  // رمزنگاری‌شده: بدون فایل sha256 تا خود GCM تشخیص دهد
  const e2 = path.join(dir, 't-enc.tar.gz.enc'); fs.copyFileSync(enc.file, e2); flip(e2, 200);
  await assert.rejects(verifyBackup({ file: e2, key: 'کلید-پشتیبان-قوی-123' }), /رمزگشایی ناموفق|دست‌کاری/);
  // ساده با sha256 همراه
  const p2 = path.join(dir, 't-plain.tar.gz'); fs.copyFileSync(plain.file, p2); fs.copyFileSync(plain.file + '.sha256', p2 + '.sha256'); flip(p2, 100);
  await assert.rejects(verifyBackup({ file: p2 }), /جمع‌کنترل|دست‌کاری|خراب/);
  // ساده بدون sha256: باید از manifest/gzip فهمیده شود
  const p3 = path.join(dir, 't-plain2.tar.gz'); fs.copyFileSync(plain.file, p3); flip(p3, Math.floor(fs.statSync(p3).size / 2));
  await assert.rejects(verifyBackup({ file: p3 }));
  // فایل کوتاه‌شده
  const p4 = path.join(dir, 't-trunc.tar.gz.enc'); fs.writeFileSync(p4, fs.readFileSync(enc.file).subarray(0, 40));
  await assert.rejects(verifyBackup({ file: p4, key: 'کلید-پشتیبان-قوی-123' }));
});
await t('نگهداری چرخشی: فقط آخرین N پشتیبان می‌ماند', async () => {
  const o2 = path.join(dir, 'rot');
  for (let i = 0; i < 4; i++) await createBackup({ dataDir: dir, databaseUrl: PG, outDir: o2, key: '', keep: 2 });
  const l = listBackups(o2); assert.equal(l.length, 2);
  assert.equal(fs.readdirSync(o2).filter((f) => f.endsWith('.sha256')).length, 2); // sidecarهای قدیمی هم پاک شده
});
await t('پشتیبان‌گیری هنگام نوشتن هم‌زمان: نسخه‌ی یکپارچه و قابل بازیابی', async () => {
  let stop = false; let n = 0;
  const writer = (async () => { while (!stop) { await api('POST', '/entities/items', { code: `LIVE-${n++}`, name: 'هم‌زمان' }); } })();
  await new Promise((r) => setTimeout(r, 150));
  const b = await createBackup({ dataDir: dir, databaseUrl: PG, outDir: path.join(dir, 'live'), key: '', keep: 3 });
  stop = true; await writer;
  assert.equal((await verifyBackup({ file: b.file })).ok, true); assert.ok(n > 3, 'نویسنده فعال بوده است');
});
await t('CLI: backup/verify با کد خروج درست، و خطا برای فایل ناموجود', async () => {
  const env = { ...process.env, ERP_DATA_DIR: dir, DATABASE_URL: PG, ERP_BACKUP_DIR: path.join(dir, 'cli'), ERP_BACKUP_KEY: '' };
  const cli = (...a) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(path.dirname(new URL(import.meta.url).pathname), '../src/backup.js'), ...a], { env, encoding: 'utf8' });
  const r = cli('backup'); assert.equal(r.status, 0, r.stderr); const info = JSON.parse(r.stdout.trim());
  assert.equal(cli('verify', info.file).status, 0);
  const bad = cli('verify', '/no/such/file'); assert.equal(bad.status, 1); assert.match(bad.stderr, /یافت نشد/);
  assert.equal(cli('restore').status, 2);
  const hook = await createBackup({ dataDir: dir, databaseUrl: PG, outDir: path.join(dir, 'hook'), key: '', keep: 1, hook: `cp "$BACKUP_FILE" ${path.join(dir, 'offsite.tar.gz')}` });
  assert.ok(fs.existsSync(path.join(dir, 'offsite.tar.gz')) && hook.bytes > 0); // hook برای ارسال به مقصد بیرونی
});

console.log(`\n${passed} تست پشتیبان موفق`);
await close(); fs.rmSync(dir, { recursive: true, force: true });
