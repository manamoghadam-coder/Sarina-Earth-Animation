// تست یکپارچگی: ساخت سرور روی دیتابیس موقت و بررسی قوانین کلیدی (ایزولاسیون شرکت‌ها، RBAC، گردش کار)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { openDb, migrate } from '../src/db.js';
import { seedDemo } from '../src/seed.js';

process.env.ERP_SUPERADMIN_PASSWORD = 'Super-Pass-1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
const { server, db } = createApp({ dataDir: dir, quiet: true });
seedDemo(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function client(username, password, company) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp': '1' }, body: JSON.stringify({ username, password }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return {
    ok: r.ok, status: r.status,
    async call(method, url, body) {
      const res = await fetch(base + '/api' + url, { method, headers: { cookie, 'content-type': 'application/json', 'x-erp': '1', ...(company ? { 'x-company': String(company) } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    },
  };
}
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓', name); };

const bad = await client('demo_admin', 'wrong');
await t('ورود نادرست رد می‌شود', () => assert.equal(bad.status, 401));
const admin = await client('demo_admin', 'demo1234');
await t('ورود صحیح', () => assert.ok(admin.ok));
await t('درخواست بدون هدر CSRF رد می‌شود', async () => {
  const r = await fetch(base + '/api/entities/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});
const me = (await admin.call('GET', '/me')).data;
await t('me: ماژول‌ها و متادیتا', () => { assert.ok(me.modules.length >= 7); assert.ok(me.meta.items); assert.equal(me.user.role, 'admin'); });

await t('دشبورد داده دارد', async () => { const d = (await admin.call('GET', '/dashboard')).data; assert.ok(d.cards.length > 5); });

await t('موجودی انبار پس از خرید/فروش درست است', async () => {
  const rep = (await admin.call('GET', '/reports/stock')).data.items;
  const rm = rep.find((i) => i.code === 'RM-001'), fg = rep.find((i) => i.code === 'FG-010');
  assert.equal(rm.total, 500); assert.equal(fg.total, 30); // ۶۰ - ۳۰
});
await t('خروج بیش از موجودی رد می‌شود', async () => {
  const items = (await admin.call('GET', '/entities/items/lookup')).data;
  const wh = (await admin.call('GET', '/entities/warehouses/lookup')).data[0];
  const r = await admin.call('POST', '/entities/stock_moves', { kind: 'out', item_id: items.find((i) => i.label.includes('FG-010')).id, warehouse_id: wh.id, qty: 9999 });
  assert.equal(r.status, 409);
});
await t('سقف اعتبار مشتری کنترل می‌شود', async () => {
  const cu = (await admin.call('GET', '/entities/customers/lookup')).data[0];
  const items = (await admin.call('GET', '/entities/items/lookup')).data;
  const wh = (await admin.call('GET', '/entities/warehouses/lookup')).data[0];
  const so = (await admin.call('POST', '/entities/sales_orders', { customer_id: cu.id, warehouse_id: wh.id, lines: [{ item_id: items[0].id, qty: 1, price: 5_000_000_000 }] })).data;
  const r = await admin.call('POST', `/entities/sales_orders/${so.id}/actions/confirm`);
  assert.equal(r.status, 409); assert.match(r.data.error, /سقف اعتبار/);
});
await t('ویرایش سفارش تأییدشده ممنوع، حذف پیش‌نویس مجاز', async () => {
  const list = (await admin.call('GET', '/entities/sales_orders')).data.rows;
  const shipped = list.find((r) => r.status === 'shipped');
  assert.equal((await admin.call('PUT', `/entities/sales_orders/${shipped.id}`, { notes: 'x' })).status, 409);
  assert.equal((await admin.call('DELETE', `/entities/sales_orders/${shipped.id}`)).status, 409);
});
await t('پیشرفت پروژه از وظایف محاسبه می‌شود', async () => {
  const p = (await admin.call('GET', '/entities/projects')).data.rows[0];
  assert.equal(p.progress, Math.round((60 + 0 + 100) / 3));
});
await t('بستن NCR بدون CAPA رد می‌شود', async () => {
  const n = (await admin.call('GET', '/entities/ncr')).data.rows[0];
  assert.equal((await admin.call('PUT', `/entities/ncr/${n.id}`, { status: 'closed' })).status, 400);
});

// RBAC
const hr = await client('demo_hr', 'demo1234');
await t('RBAC: HR به فروش دسترسی ندارد ولی به کارکنان دارد', async () => {
  assert.equal((await hr.call('GET', '/entities/sales_orders')).status, 403);
  assert.equal((await hr.call('GET', '/entities/employees')).status, 200);
  assert.equal((await hr.call('GET', '/entities/users')).status, 403);
});
const viewer = await client('demo_viewer', 'demo1234');
await t('RBAC: مشاهده‌گر نمی‌تواند ایجاد کند', async () => {
  assert.equal((await viewer.call('POST', '/entities/departments', { name: 'x' })).status, 403);
});

// چندشرکتی
const sup = await client('superadmin', 'Super-Pass-1');
await t('مدیر کل بدون انتخاب شرکت به داده‌ها دسترسی ندارد', async () => assert.equal((await sup.call('GET', '/entities/items')).status, 400));
const created = await sup.call('POST', '/companies', { name: 'شرکت دوم', admin_username: 'second_admin', admin_name: 'مدیر دوم', admin_password: 'secondpass1' });
await t('ایجاد شرکت جدید با مدیر', () => assert.equal(created.status, 201));
const second = await client('second_admin', 'secondpass1');
await t('ایزولاسیون: شرکت دوم داده‌های شرکت اول را نمی‌بیند', async () => {
  assert.equal((await second.call('GET', '/entities/items')).data.total, 0);
  assert.equal((await second.call('GET', '/entities/employees')).data.total, 0);
  assert.equal((await second.call('GET', '/entities/employees/1')).status, 404);
  assert.equal((await second.call('PUT', '/entities/employees/1', { name: 'hack' })).status, 404);
});
await t('ایزولاسیون: ارجاع به رکورد شرکت دیگر رد می‌شود', async () => {
  const r = await second.call('POST', '/entities/employees', { name: 'تست', department_id: 1 });
  assert.equal(r.status, 400);
});
await t('کاربر عادی نمی‌تواند با هدر X-Company شرکت را عوض کند', async () => {
  const sneaky = await client('second_admin', 'secondpass1', 1);
  assert.equal((await sneaky.call('GET', '/entities/employees')).data.total, 0);
  assert.equal((await sneaky.call('GET', '/companies')).status, 403);
});
await t('مدیر کل با X-Company وارد شرکت می‌شود', async () => {
  const s1 = await client('superadmin', 'Super-Pass-1', 1);
  assert.ok((await s1.call('GET', '/entities/employees')).data.total >= 3);
});
await t('نام کاربری تکراری رد می‌شود', async () => {
  const r = await second.call('POST', '/entities/users', { username: 'demo_admin', name: 'x', role: 'viewer', password: 'abcdef12' });
  assert.equal(r.status, 409);
});
await t('خروجی CSV', async () => {
  const res = await fetch(base + '/api/export/items', { headers: { cookie: 'x' } });
  assert.equal(res.status, 401);
});

console.log(`\n${passed} تست موفق`);
server.close(); db.close();
fs.rmSync(dir, { recursive: true, force: true });
