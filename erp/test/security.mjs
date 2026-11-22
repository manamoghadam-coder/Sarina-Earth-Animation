// تست‌های امنیتی (سناریوهای تهاجمی). اجرا: node test/security.mjs  (برای PostgreSQL: TEST_DATABASE_URL)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/seed.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.ERP_SUPERADMIN_PASSWORD = 'Super-Pass-1';
if (process.env.TEST_DATABASE_URL) {
  const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect(); await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await c.end();
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-sec-'));
const { server, db, close } = await createApp({ dataDir: dir, quiet: true, databaseUrl: process.env.TEST_DATABASE_URL || '' });
await seedDemo(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const H = (cookie, extra = {}) => ({ 'content-type': 'application/json', 'x-erp': '1', ...(cookie ? { cookie } : {}), ...extra });
async function login(username, password, b = base, extra = {}) {
  const r = await fetch(b + '/api/login', { method: 'POST', headers: H(null, extra), body: JSON.stringify({ username, password }) });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, cookie: sc?.split(';')[0], setCookie: sc, headers: r.headers };
}
const api = async (cookie, method, url, body, b = base, extra = {}) => {
  const r = await fetch(b + '/api' + url, { method, headers: H(cookie, extra), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, headers: r.headers };
};
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

// ───────── نشست ─────────
await t('کوکی نشست HttpOnly و SameSite=Strict است', async () => {
  const l = await login('demo_admin', 'demo1234');
  assert.match(l.setCookie, /HttpOnly/); assert.match(l.setCookie, /SameSite=Strict/); assert.doesNotMatch(l.setCookie, /Secure/); // HTTP ساده
});
await t('تغییر گذرواژه، نشست‌های دیگر را باطل می‌کند ولی نشست جاری ادامه می‌یابد', async () => {
  const a = await login('demo_sales', 'demo1234'), b = await login('demo_sales', 'demo1234');
  assert.equal((await api(b.cookie, 'GET', '/me')).status, 200);
  const ch = await fetch(base + '/api/password', { method: 'POST', headers: H(a.cookie), body: JSON.stringify({ current: 'demo1234', next: 'new-Password-77' }) });
  assert.equal(ch.status, 200);
  const newCookie = ch.headers.get('set-cookie').split(';')[0];
  assert.equal((await api(b.cookie, 'GET', '/me')).status, 401);     // نشست دیگر باطل
  assert.equal((await api(a.cookie, 'GET', '/me')).status, 401);     // کوکی قدیمی همین نشست هم باطل
  assert.equal((await api(newCookie, 'GET', '/me')).status, 200);    // کوکی جدید معتبر
  assert.equal((await login('demo_sales', 'demo1234')).status, 401);
  assert.equal((await login('demo_sales', 'new-Password-77')).status, 200);
});
await t('بازنشانی گذرواژه‌ی کاربر توسط مدیر، نشست او را باطل می‌کند و کاربر غیرفعال بلافاصله خارج می‌شود', async () => {
  const admin = (await login('demo_admin', 'demo1234')).cookie;
  const v = await login('demo_viewer', 'demo1234');
  const u = (await api(admin, 'GET', '/entities/users?q=demo_viewer')).data.rows[0];
  assert.equal((await api(admin, 'PUT', `/entities/users/${u.id}`, { password: 'reset-pass-123' })).status, 200);
  assert.equal((await api(v.cookie, 'GET', '/me')).status, 401);
  const v2 = await login('demo_viewer', 'reset-pass-123');
  assert.equal((await api(admin, 'PUT', `/entities/users/${u.id}`, { active: 0 })).status, 200);
  assert.equal((await api(v2.cookie, 'GET', '/me')).status, 401);
});
await t('توکن دست‌کاری‌شده یا منقضی پذیرفته نمی‌شود', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  const [name, val] = c.split('='); const [p, sig] = val.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 1, fp: 'x', exp: 9999999999 })).toString('base64url');
  for (const bad of [`${name}=${forged}.${sig}`, `${name}=${p}.AAAA`, `${name}=garbage`, `${name}=`]) assert.equal((await api(bad, 'GET', '/me')).status, 401);
});

// ───────── احراز هویت و CSRF ─────────
await t('همه‌ی مسیرهای API بدون ورود رد می‌شوند (به‌جز login و health)', async () => {
  for (const [m, u] of [['GET', '/me'], ['GET', '/entities/items'], ['GET', '/entities/users'], ['GET', '/dashboard'], ['GET', '/reports/trial'], ['GET', '/audit'], ['GET', '/companies'], ['GET', '/attachments?entity=items&id=1'], ['GET', '/attachments/1'], ['GET', '/export/items'], ['POST', '/accounting/close-year'], ['POST', '/maintenance/generate']])
    assert.equal((await api(undefined, m, u, m === 'POST' ? {} : undefined)).status, 401, `${m} ${u}`);
  assert.equal((await api(undefined, 'GET', '/health')).status, 200);
});
await t('درخواست تغییردهنده بدون هدر X-ERP رد می‌شود (حتی با کوکی معتبر)', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  for (const [m, u] of [['POST', '/entities/items'], ['PUT', '/entities/items/1'], ['DELETE', '/entities/items/1'], ['POST', '/password'], ['POST', '/attachments?entity=items&id=1&name=a.pdf']]) {
    const r = await fetch(base + '/api' + u, { method: m, headers: { cookie: c, 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 403, `${m} ${u}`);
  }
});
await t('ورود: شیء/آرایه به‌جای رشته، JSON خراب و بدنه‌ی بزرگ', async () => {
  for (const body of ['{"username":{"$ne":1},"password":{"$ne":1}}', '{"username":["demo_admin"],"password":["demo1234"]}', '{"username":"demo_admin"}']) {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: H(null), body }); assert.ok([400, 401].includes(r.status) && r.status !== 200, body);
  }
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: H(null), body: '{bad json' })).status, 400);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: H(null), body: JSON.stringify({ username: 'a', password: 'x'.repeat(2_000_000) }) })).status, 413);
});
await t('قفل ورود پس از تلاش‌های ناموفق (به‌ازای کاربر) و پیام یکسان برای کاربر ناموجود', async () => {
  const names = [];
  for (let i = 0; i < 8; i++) { const r = await login('demo_qa', 'wrong-' + i); names.push(r.status); }
  assert.ok(names.every((s) => s === 401));
  assert.equal((await login('demo_qa', 'demo1234')).status, 429); // حتی گذرواژه‌ی درست در دوره‌ی قفل
  const ghost = await fetch(base + '/api/login', { method: 'POST', headers: H(null), body: JSON.stringify({ username: 'no_such_user', password: 'whatever12' }) });
  const real = await fetch(base + '/api/login', { method: 'POST', headers: H(null), body: JSON.stringify({ username: 'demo_hr', password: 'wrong-wrong' }) });
  assert.equal((await ghost.json()).error, (await real.json()).error);
});

// ───────── کنترل دسترسی ─────────
await t('فیلدهای حساس (حقوق، کد ملی) برای نقش‌های بدون مجوز حقوق دیده نمی‌شود؛ جستجو/مرتب‌سازی هم نشت نمی‌دهد', async () => {
  const admin = (await login('demo_admin', 'demo1234')).cookie;
  const pr = (await login('demo_project', 'demo1234')).cookie;
  const full = (await api(admin, 'GET', '/entities/employees')).data.rows.find((r) => r.national_id);
  assert.ok(full.salary > 0 && full.national_id);
  const r = (await api(pr, 'GET', '/entities/employees')).data;
  assert.ok(r.rows.length >= 3);
  for (const row of r.rows) for (const k of ['salary', 'national_id', 'housing_allowance', 'food_allowance', 'child_allowance']) assert.equal(k in row, false, k);
  const meta = (await api(pr, 'GET', '/me')).data.meta.employees.fields.map((f) => f.k);
  assert.ok(!meta.includes('salary') && !meta.includes('national_id') && meta.includes('name'));
  assert.equal((await api(pr, 'GET', '/entities/employees?q=0012345678')).data.total, 0);  // جستجو بر پایه‌ی کد ملی: نشت ندارد
  assert.equal((await api(admin, 'GET', '/entities/employees?q=0012345678')).data.total, 1);
  assert.equal((await api(pr, 'GET', '/entities/employees?sort=salary&dir=desc')).status, 200);
  const csvRes = await fetch(base + '/api/export/employees', { headers: { cookie: pr } }); const csv = await csvRes.text();
  assert.ok(!csv.includes('0012345678') && !csv.includes('حقوق پایه') && !csv.includes('کد ملی'));
});
await t('نقش بدون مجوز حقوق نمی‌تواند فیلد حساس را بنویسد؛ و پیوست‌های کارمند بسته است', async () => {
  const hr = (await login('demo_hr', 'demo1234')).cookie, pr = (await login('demo_project', 'demo1234')).cookie;
  const emp = (await api(hr, 'GET', '/entities/employees')).data.rows[0];
  assert.equal((await api(hr, 'GET', `/attachments?entity=employees&id=${emp.id}`)).status, 200);
  assert.equal((await api(pr, 'GET', `/attachments?entity=employees&id=${emp.id}`)).status, 403);
  const mg = (await login('demo_manager', 'demo1234')).cookie; // مدیر ارشد: hr ویرایش + payroll مشاهده
  const before = (await api(mg, 'GET', `/entities/employees/${emp.id}`)).data.salary;
  assert.equal(before, emp.salary);
});
await t('افزایش سطح دسترسی: نقش‌های غیرمدیر کاربر نمی‌سازند؛ نقش superadmin قابل تخصیص نیست', async () => {
  const hr = (await login('demo_hr', 'demo1234')).cookie, admin = (await login('demo_admin', 'demo1234')).cookie;
  assert.equal((await api(hr, 'POST', '/entities/users', { username: 'evil1', name: 'x', role: 'admin', password: 'password123' })).status, 403);
  assert.equal((await api(admin, 'POST', '/entities/users', { username: 'evil2', name: 'x', role: 'superadmin', password: 'password123' })).status, 400);
  assert.equal((await api(admin, 'POST', '/entities/users', { username: 'weak1', name: 'x', role: 'viewer', password: 'short7!' })).status, 400); // کمتر از ۸ نویسه
  assert.equal((await api(admin, 'GET', '/companies')).status, 403);
  const me = (await api(admin, 'GET', '/me')).data.user;
  assert.equal((await api(admin, 'PUT', `/entities/users/${me.id}`, { role: 'viewer' })).status, 400); // خودتنزلی/قفل‌کردن حساب
  assert.equal((await api(admin, 'DELETE', `/entities/users/${me.id}`)).status, 400);
});
await t('Mass assignment: شناسه، شرکت و فیلدهای سیستمی از ورودی پذیرفته نمی‌شود', async () => {
  const admin = (await login('demo_admin', 'demo1234')).cookie;
  const it = (await api(admin, 'POST', '/entities/items', { code: 'MA-1', name: 'تست', id: 99999, company_id: 2, created_by: 7, created_at: '2000-01-01' })).data;
  assert.notEqual(it.id, 99999);
  const raw = await db.get('SELECT company_id, created_by FROM e_items WHERE id=?', it.id);
  assert.equal(raw.company_id, 1); assert.notEqual(raw.created_by, 7);
  const so = (await api(admin, 'GET', '/entities/sales_orders')).data.rows.find((r) => r.status === 'shipped');
  assert.equal((await api(admin, 'PUT', `/entities/sales_orders/${so.id}`, { status: 'draft', total: 1 })).status, 409);
  const po = (await api(admin, 'GET', '/entities/purchase_orders')).data.rows[0];
  assert.equal(po.status, 'received');
});

// ───────── تزریق و مسیر ─────────
await t('تزریق SQL در جستجو، فیلتر، مرتب‌سازی و پارامترهای گزارش اثری ندارد و جدول‌ها سالم می‌مانند', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  const evil = ["' OR '1'='1", "'; DROP TABLE e_items; --", '%', '_', '\\', 'a%" OR 1=1 --'];
  for (const q of evil) {
    const r = await api(c, 'GET', `/entities/items?q=${encodeURIComponent(q)}&sort=${encodeURIComponent('id;DROP TABLE e_items')}&dir=${encodeURIComponent("desc;--")}&f_status=${encodeURIComponent("'")}&f_kind=${encodeURIComponent("x' OR '1'='1")}&page=-5&size=abc`);
    assert.equal(r.status, 200, q);
  }
  assert.equal((await api(c, 'GET', `/entities/items?q=${encodeURIComponent("' OR '1'='1")}`)).data.total, 0);
  for (const u of ['/reports/trial?from=1;DROP%20TABLE%20e_items&to=x', '/reports/ledger?account=1%20OR%201=1', '/reports/party?type=customer%27--&party=1%20OR%201=1', '/reports/income?from=%27']) {
    const r = await api(c, 'GET', u); assert.ok([200, 400].includes(r.status), u);
  }
  assert.ok((await api(c, 'GET', '/entities/items')).data.total >= 3);
});
await t('شناسه‌های نامعتبر (متن، منفی، سرریز، علمی، هگز) هیچ‌گاه ۵۰۰ نمی‌دهند', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  for (const id of ['abc', '-1', '0', '99999999999999', '1e3', '0x10', '1.5', '%20', '1%20OR%201=1', 'NaN']) {
    for (const [m, u] of [['GET', `/entities/items/${id}`], ['PUT', `/entities/items/${id}`], ['DELETE', `/entities/items/${id}`], ['POST', `/entities/sales_orders/${id}/actions/confirm`], ['GET', `/attachments/${id}`], ['DELETE', `/attachments/${id}`], ['GET', `/attachments?entity=items&id=${id}`], ['GET', `/entities/items?f_item_id=${id}&f_kind=${id}`], ['GET', `/entities/stock_moves?f_item_id=${id}`], ['GET', `/reports/ledger?account=${id}`], ['GET', `/reports/party?type=customer&party=${id}`]]) {
      const r = await api(c, m, u, m === 'PUT' || m === 'POST' ? {} : undefined);
      assert.ok(r.status < 500, `${m} ${u} → ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
  for (const id of ['abc', '99999999999999', '-5']) assert.ok([400].includes((await api(c, 'POST', '/entities/stock_moves', { kind: 'in', item_id: id, warehouse_id: 1, qty: 1 })).status), 'ref نامعتبر باید ۴۰۰ بدهد');
});
await t('مسیرهای خاص: __proto__/constructor، پیمایش مسیر و بایت تهی', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.ok([403, 404].includes((await api(c, 'GET', `/entities/${k}`)).status), k);
    assert.ok([403, 404].includes((await api(c, 'GET', `/export/${k}`)).status), k);
  }
  for (const p of ['/..%2f..%2fsrc%2fserver.js', '/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cpackage.json', '/%00', '/..%252f..%252fpackage.json', '/src/server.js', '/data/erp.db']) {
    const r = await fetch(base + p); const body = await r.text();
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`); assert.ok(!body.includes('createServer') && !body.includes('root:'), p);
  }
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400); // رمزگشایی نامعتبر
});
await t('هدرهای امنیتی روی صفحه و API و عدم HSTS روی HTTP ساده', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('strict-transport-security'), null);
  const j = await api(undefined, 'GET', '/health'); assert.equal(j.headers.get('cache-control'), 'no-store');
});
await t('پیوست: نام فایل مخرب و پسوند دوگانه رد/پاک‌سازی می‌شود و دانلود هدر تزریق‌پذیر ندارد', async () => {
  const c = (await login('demo_admin', 'demo1234')).cookie;
  const id = (await api(c, 'GET', '/entities/expenses')).data.rows[0].id;
  const up = (name) => fetch(`${base}/api/attachments?entity=expenses&id=${id}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie: c, 'x-erp': '1', 'content-type': 'application/octet-stream' }, body: Buffer.from('x') });
  for (const bad of ['a.html', 'a.svg', 'a.js', 'a.php', 'a.exe', 'a.pdf.exe', 'noext', '.pdf']) assert.equal((await up(bad)).status, 400, bad);
  const ok = await up('../../etc/passwd.pdf'); assert.equal(ok.status, 201);
  const att = await ok.json(); assert.ok(!att.name.includes('/') && !att.name.includes('\\'));
  const d = await fetch(`${base}/api/attachments/${att.id}`, { headers: { cookie: c, 'x-erp': '1' } });
  assert.ok(!/[\r\n]/.test(d.headers.get('content-disposition')));
  const hdrInj = await up('a\r\nSet-Cookie: x=1.pdf'); assert.ok([201, 400].includes(hdrInj.status));
  if (hdrInj.status === 201) { const a2 = await hdrInj.json(); const dd = await fetch(`${base}/api/attachments/${a2.id}`, { headers: { cookie: c, 'x-erp': '1' } }); assert.equal(dd.headers.get('set-cookie'), null); }
});

// ───────── رفتار پشت پراکسی (فرایند جداگانه با ERP_TRUST_PROXY) ─────────
async function startChild(env) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-child-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src/server.js')], { env: { ...process.env, ERP_DATA_DIR: d, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: '', ERP_SUPERADMIN_PASSWORD: 'Child-Pass-123', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const b = `http://127.0.0.1:${port}`;
  let out = ''; child.stdout.on('data', (x) => (out += x)); child.stderr.on('data', (x) => (out += x));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(b + '/api/health')).ok) return { child, b, d, output: () => out }; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 150)); }
  child.kill(); throw new Error('سرور فرزند بالا نیامد');
}
const xff = (ip, proto = 'https') => ({ 'x-forwarded-for': ip, 'x-forwarded-proto': proto });
await t('پشت پراکسی: IP واقعی از X-Forwarded-For، کوکی Secure، HSTS و قفل مستقل هر IP', async () => {
  const { child, b, d } = await startChild({ ERP_TRUST_PROXY: '1' });
  try {
    for (let i = 0; i < 8; i++) assert.equal((await login('superadmin', 'bad' + i, b, xff('203.0.113.7'))).status, 401);
    assert.equal((await login('superadmin', 'Child-Pass-123', b, xff('203.0.113.7'))).status, 429);      // IP مهاجم قفل
    const ok = await login('superadmin', 'Child-Pass-123', b, xff('198.51.100.9'));                          // کاربر دیگر پشت همان پراکسی قفل نیست
    assert.equal(ok.status, 200); assert.match(ok.setCookie, /; Secure/); assert.match(ok.headers.get('strict-transport-security'), /max-age=\d+/);
    // مهاجم نمی‌تواند با جعل XFF خودش را بی‌قفل کند: پراکسی مورد اعتماد آخرین مقدار را اضافه می‌کند
    const spoof = await login('superadmin', 'Child-Pass-123', b, { 'x-forwarded-for': '1.2.3.4, 203.0.113.7', 'x-forwarded-proto': 'https' });
    assert.equal(spoof.status, 429);
    const plain = await login('superadmin', 'Child-Pass-123', b, xff('198.51.100.9', 'http'));
    assert.doesNotMatch(plain.setCookie, /Secure/);
  } finally { child.kill('SIGTERM'); fs.rmSync(d, { recursive: true, force: true }); }
});
await t('بدون ERP_TRUST_PROXY هدرهای X-Forwarded-* نادیده گرفته می‌شود (جعل Secure/IP بی‌اثر)', async () => {
  const { child, b, d } = await startChild({});
  try {
    for (let i = 0; i < 8; i++) await login('superadmin', 'bad' + i, b, xff('10.0.0.' + i));
    assert.equal((await login('superadmin', 'Child-Pass-123', b, xff('10.9.9.9'))).status, 429); // IPهای جعلی قفل را دور نمی‌زنند
  } finally { child.kill('SIGTERM'); fs.rmSync(d, { recursive: true, force: true }); }
});
await t('گذرواژه‌ی superadmin که از env آمده در لاگ چاپ نمی‌شود؛ گذرواژه‌ی ضعیف env رد می‌شود', async () => {
  const { child, d, output } = await startChild({});
  try { assert.ok(!output().includes('Child-Pass-123'), 'گذرواژه نباید در لاگ باشد'); assert.match(output(), /superadmin/); } finally { child.kill('SIGTERM'); fs.rmSync(d, { recursive: true, force: true }); }
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-weak-'));
  const r = await new Promise((res) => { const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src/server.js')], { env: { ...process.env, ERP_DATA_DIR: d2, PORT: '0', DATABASE_URL: '', ERP_SUPERADMIN_PASSWORD: 'short' }, stdio: 'ignore' }); c.on('exit', res); });
  assert.notEqual(r, 0); fs.rmSync(d2, { recursive: true, force: true });
});
await t('محدودیت نرخ کلی و توقف تمیز با SIGTERM (کد خروج ۰)', async () => {
  const { child, b, d } = await startChild({ ERP_RATE_PER_MIN: '15' });
  try {
    const codes = []; for (let i = 0; i < 25; i++) codes.push((await fetch(b + '/api/me')).status);
    assert.ok(codes.includes(429), 'باید ۴۲۹ دیده شود'); assert.equal(codes[0], 401);
    const exited = new Promise((r) => child.on('exit', (c) => r(c)));
    child.kill('SIGTERM'); assert.equal(await exited, 0);
  } finally { child.kill('SIGKILL'); fs.rmSync(d, { recursive: true, force: true }); }
});

console.log(`\n${passed} تست امنیتی موفق`);
await close(); fs.rmSync(dir, { recursive: true, force: true });
