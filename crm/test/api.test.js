'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { hashPassword } = require('../src/auth');

let server, base, db;
before(async () => {
  process.env.CRM_ADMIN_PASSWORD = 'AdminPass123';
  db = openDb(':memory:');
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(cookie, method, path, body, extra = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}
async function login(username, password) {
  const r = await call(null, 'POST', '/api/auth/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}

let admin, sales1, sales2;
test('احراز هویت و کنترل دسترسی', async () => {
  assert.equal((await call(null, 'GET', '/api/contacts')).status, 401);
  assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'admin', password: 'bad' })).status, 401);
  admin = await login('admin', 'AdminPass123');
  assert.equal((await call(admin, 'GET', '/api/auth/me')).data.role, 'admin');
  // CSRF: بدون هدر سفارشی رد می‌شود
  const noHdr = await fetch(base + '/api/contacts', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: admin }, body: '{}' });
  assert.equal(noHdr.status, 403);
  for (const u of ['ali', 'sara']) {
    const r = await call(admin, 'POST', '/api/users', { username: u, name: u, role: 'sales', password: 'Password123' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.equal((await call(admin, 'POST', '/api/users', { username: 'ali', name: 'x', password: 'Password123' })).status, 409);
  assert.equal((await call(admin, 'POST', '/api/users', { username: 'q', name: 'x', password: '1' })).status, 422);
  sales1 = await login('ali', 'Password123'); sales2 = await login('sara', 'Password123');
  assert.equal((await call(sales1, 'GET', '/api/users')).status, 403);
  assert.equal((await call(sales1, 'GET', '/api/audit')).status, 403);
});

test('اعتبارسنجی مخاطب و شرکت', async () => {
  let r = await call(sales1, 'POST', '/api/contacts', { last_name: 'x' });
  assert.equal(r.status, 422); assert.ok(r.data.details.first_name);
  r = await call(sales1, 'POST', '/api/contacts', { first_name: 'a', email: 'bad' });
  assert.equal(r.status, 422); assert.ok(r.data.details.email);
  r = await call(sales1, 'POST', '/api/contacts', { first_name: 'a', company_id: 999 });
  assert.equal(r.status, 422);
  r = await call(sales1, 'POST', '/api/companies', { name: 'شرکت آلفا', size: 50 });
  assert.equal(r.status, 200); assert.equal(r.data.owner_name, 'ali');
});

test('ایزوله‌سازی داده‌ی کاربران فروش', async () => {
  const c = (await call(sales1, 'POST', '/api/contacts', { first_name: 'محرمانه', owner_id: 1 })).data;
  assert.equal(c.owner_id, 2, 'کاربر فروش نمی‌تواند مالک را عوض کند'); // ali = id 2
  assert.equal((await call(sales2, 'GET', `/api/contacts/${c.id}`)).status, 404);
  assert.equal((await call(sales2, 'PUT', `/api/contacts/${c.id}`, { first_name: 'x' })).status, 404);
  assert.equal((await call(sales2, 'GET', `/api/activities?entity_type=contact&entity_id=${c.id}`)).status, 404);
  assert.equal((await call(sales2, 'GET', '/api/contacts')).data.total, 0);
  assert.equal((await call(admin, 'GET', '/api/contacts')).data.total >= 1, true);
  assert.equal((await call(sales1, 'DELETE', `/api/contacts/${c.id}`)).status, 403, 'حذف فقط مدیر');
  assert.equal((await call(admin, 'DELETE', `/api/contacts/${c.id}`)).status, 200);
});

test('چرخه معامله، تغییر مرحله و داشبورد', async () => {
  const d = (await call(sales1, 'POST', '/api/deals', { title: 'پروژه A', value: 1000 })).data;
  assert.equal(d.stage, 'new'); assert.equal(d.probability, 10);
  let r = await call(sales1, 'PUT', `/api/deals/${d.id}`, { stage: 'won' });
  assert.equal(r.data.stage, 'won'); assert.equal(r.data.probability, 100); assert.ok(r.data.closed_at);
  r = await call(sales1, 'PUT', `/api/deals/${d.id}`, { stage: 'bogus' });
  assert.equal(r.status, 422);
  const acts = (await call(sales1, 'GET', `/api/activities?entity_type=deal&entity_id=${d.id}`)).data;
  assert.ok(acts.some((a) => a.body.includes('برنده')));
  const dash = (await call(sales1, 'GET', '/api/dashboard')).data;
  assert.equal(dash.won_month.value, 1000); assert.equal(dash.win_rate, 100);
  const dash2 = (await call(sales2, 'GET', '/api/dashboard')).data;
  assert.equal(dash2.won_month.value, 0);
  assert.equal((await call(sales2, 'GET', '/api/dashboard')).data.recent.length, 0);
  // اقلام معامله → ارزش
  r = await call(sales1, 'PUT', `/api/deals/${d.id}/items`, { items: [{ name: 'x', qty: 2, price: 300 }, { name: 'y', qty: 1, price: 50 }] });
  assert.equal(r.data.length, 2);
  assert.equal((await call(sales1, 'GET', `/api/deals/${d.id}`)).data.value, 650);
  assert.equal((await call(sales1, 'PUT', `/api/deals/${d.id}/items`, { items: [{ name: 'x', qty: 0, price: 1 }] })).status, 422);
});

test('تبدیل سرنخ', async () => {
  const l = (await call(sales1, 'POST', '/api/leads', { first_name: 'رضا', last_name: 'کریمی', company_name: 'شرکت آلفا', email: 'R@X.com' })).data;
  assert.equal(l.email, 'r@x.com');
  const r = await call(sales1, 'POST', `/api/leads/${l.id}/convert`, { create_deal: true, deal_value: 500 });
  assert.equal(r.status, 200); assert.ok(r.data.contact_id && r.data.deal_id);
  const co = (await call(admin, 'GET', '/api/companies?q=آلفا')).data;
  assert.equal(co.total, 1, 'شرکت موجود دوباره ساخته نشود');
  assert.equal((await call(sales1, 'POST', `/api/leads/${l.id}/convert`, {})).status, 409);
  assert.equal((await call(sales1, 'PUT', `/api/leads/${l.id}`, { status: 'new' })).status, 409);
});

test('وظایف، جست‌وجو و مرتب‌سازی امن', async () => {
  const t = (await call(sales1, 'POST', '/api/tasks', { title: 'تماس', due_date: '2020-01-01', related_type: 'deal', related_id: 1 })).data;
  assert.equal(t.assignee_id, 2);
  assert.equal((await call(sales1, 'POST', '/api/tasks', { title: 'x', due_date: '2020-02-31' })).status, 422);
  const done = (await call(sales1, 'PUT', `/api/tasks/${t.id}`, { status: 'done' })).data;
  assert.ok(done.completed_at);
  assert.equal((await call(sales1, 'GET', '/api/contacts?sort=id;DROP TABLE users')).status, 200);
  assert.equal((await call(sales1, 'GET', "/api/contacts?q=' OR 1=1 --")).data.total, 0);
  assert.equal((await call(sales1, 'GET', '/api/contacts?q=%25')).data.total, 0, 'wildcard escape');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 3);
});

test('محصولات، CSV و مدیریت کاربران', async () => {
  assert.equal((await call(sales1, 'POST', '/api/products', { name: 'p' })).status, 403);
  assert.equal((await call(admin, 'POST', '/api/products', { name: 'P', sku: 'S1', price: 10 })).status, 200);
  assert.equal((await call(admin, 'POST', '/api/products', { name: 'P2', sku: 'S1', price: 10 })).status, 409);
  await call(admin, 'POST', '/api/contacts', { first_name: '=HYPERLINK("x")' });
  const csv = await call(admin, 'GET', '/api/contacts/export.csv');
  assert.equal(csv.status, 200); assert.ok(csv.data.includes("'=HYPERLINK"));
  assert.equal((await call(sales1, 'GET', '/api/contacts/export.csv')).status, 403);
  const users = (await call(admin, 'GET', '/api/users')).data;
  const ali = users.find((u) => u.username === 'ali');
  await call(admin, 'PUT', `/api/users/${ali.id}`, { active: false });
  assert.equal((await call(sales1, 'GET', '/api/contacts')).status, 401, 'نشست کاربر غیرفعال باطل شود');
  assert.equal((await call(admin, 'PUT', `/api/users/1`, { role: 'sales' })).status, 409);
});

test('فایل ایستا و محدودسازی ورود', async () => {
  assert.equal((await fetch(base + '/../package.json')).status === 200, false);
  assert.ok([403, 404].includes((await fetch(base + '/%2e%2e/package.json')).status));
  for (let i = 0; i < 8; i++) await call(null, 'POST', '/api/auth/login', { username: 'sara', password: 'wrong' });
  assert.equal((await call(null, 'POST', '/api/auth/login', { username: 'sara', password: 'Password123' })).status, 429);
});
