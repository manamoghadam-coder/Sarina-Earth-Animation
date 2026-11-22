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
  assert.equal(rm.total, 320); assert.equal(fg.total, 30); // خرید ۵۰۰ - مصرف تولید ۱۸۰ ؛ تولید ۶۰ - فروش ۳۰
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

// ───────────── حسابداری ─────────────
const T = (rows, code) => rows.find((r) => r.code === code);
await t('ترازنامه‌ی آزمایشی متوازن است و دفتر کل از اسناد خودکار پر شده', async () => {
  const tb = (await admin.call('GET', '/reports/trial')).data;
  assert.equal(tb.totals.debit, tb.totals.credit); assert.equal(tb.totals.closing, 0);
  assert.equal(T(tb.rows, '1201').closing, 98_000_000);       // مطالبات = ۱۹۸م فروش - ۱۰۰م دریافت
  assert.equal(T(tb.rows, '2201').closing, -18_000_000);      // مالیات فروش
});
await t('صورت سود و زیان: بهای تمام‌شده بر پایه‌ی میانگین تولید', async () => {
  const is = (await admin.call('GET', '/reports/income')).data;
  assert.equal(is.totalRevenue, 180_000_000);
  assert.equal(is.grossProfit, 79_500_000);   // ۳۰ × ۳٬۳۵۰٬۰۰۰ = ۱۰۰٫۵م بهای تمام‌شده
  assert.equal(is.netIncome, 19_500_000);     // ۱۸۰ - (۱۰۰٫۵ + ۹۰ اجاره - ۳۰ سربار جذب‌شده)
});
await t('ترازنامه: دارایی = بدهی + حقوق صاحبان سرمایه', async () => {
  const bs = (await admin.call('GET', '/reports/balance')).data;
  assert.equal(bs.difference, 0); assert.equal(bs.totalAssets, 5_545_700_000); assert.equal(bs.totalLiabilities, 526_200_000);
});
await t('دفتر کل حساب بانک با مانده‌ی جاری', async () => {
  const bank = (await admin.call('GET', '/entities/accounts?q=بانک')).data.rows[0];
  const l = (await admin.call('GET', `/reports/ledger?account=${bank.id}`)).data;
  assert.equal(l.closing, 5_010_000_000); assert.equal(l.rows.length, 3);
});
const accs = (await admin.call('GET', '/entities/accounts/lookup')).data;
const accId = (code) => accs.find((a) => a.label.startsWith(code)).id;
await t('سند نامتوازن رد می‌شود', async () => {
  const r = await admin.call('POST', '/entities/journal_entries', { description: 'x', lines: [{ account_id: accId('1101'), debit: 100 }, { account_id: accId('3101'), credit: 90 }] });
  assert.equal(r.status, 400); assert.match(r.data.error, /تراز/);
});
let jv;
await t('سند دستی: پیش‌نویس ← قطعی ← غیرقابل ویرایش ← برگشت', async () => {
  jv = (await admin.call('POST', '/entities/journal_entries', { description: 'تست', lines: [{ account_id: accId('1101'), debit: 1000 }, { account_id: accId('3101'), credit: 1000 }] })).data;
  assert.equal(jv.status, 'draft');
  assert.equal((await admin.call('POST', `/entities/journal_entries/${jv.id}/actions/post`)).status, 200);
  assert.equal((await admin.call('PUT', `/entities/journal_entries/${jv.id}`, { description: 'y' })).status, 409);
  assert.equal((await admin.call('DELETE', `/entities/journal_entries/${jv.id}`)).status, 409);
  const cash = (await admin.call('GET', `/reports/ledger?account=${accId('1101')}`)).data;
  assert.equal(cash.closing, 1000);
  assert.equal((await admin.call('POST', `/entities/journal_entries/${jv.id}/actions/reverse`)).status, 200);
  assert.equal((await admin.call('GET', `/reports/ledger?account=${accId('1101')}`)).data.closing, 0);
});
await t('سند خودکار را نمی‌توان دستی برگشت داد', async () => {
  const auto = (await admin.call('GET', '/entities/journal_entries?f_source=sales_orders')).data.rows[0];
  assert.equal((await admin.call('POST', `/entities/journal_entries/${auto.id}/actions/reverse`)).status, 409);
});
await t('ویرایش سند دریافت، سند خودکار را اصلاح و تراز می‌ماند', async () => {
  const pay = (await admin.call('GET', '/entities/payments')).data.rows[0];
  assert.equal((await admin.call('PUT', `/entities/payments/${pay.id}`, { amount: 60_000_000 })).status, 200);
  const tb = (await admin.call('GET', '/reports/trial')).data;
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(T(tb.rows, '1201').closing, 138_000_000);
});
await t('حساب سیستمی/دارای گردش حذف نمی‌شود', async () => {
  assert.equal((await admin.call('DELETE', `/entities/accounts/${accId('1102')}`)).status, 409);
});
await t('قفل دوره‌ی مالی از ثبت سند جلوگیری می‌کند', async () => {
  const d = new Date().toISOString().slice(0, 10);
  assert.equal((await admin.call('PUT', '/company', { lock_date: d })).status, 200);
  const r = await admin.call('POST', '/entities/expenses', { category: 'rent', description: 'x', amount: 5, date: d });
  assert.equal(r.status, 409); assert.match(r.data.error, /بسته/);
  await admin.call('PUT', '/company', { lock_date: null });
  assert.equal((await admin.call('POST', '/entities/expenses', { category: 'rent', description: 'x', amount: 5, date: d })).status, 201);
});
const acct = await client('demo_accountant', 'demo1234');
await t('RBAC: حسابدار به دفتر کل دسترسی دارد، ولی فروش‌دار ندارد', async () => {
  assert.equal((await acct.call('GET', '/reports/trial')).status, 200);
  const sales = await client('demo_sales', 'demo1234');
  assert.equal((await sales.call('GET', '/reports/trial')).status, 403);
  assert.equal((await sales.call('GET', '/entities/journal_entries')).status, 403);
});

// ───────────── تولید ─────────────
await t('MRP: نیاز دستور باز در برابر موجودی', async () => {
  const m = (await admin.call('GET', '/reports/mrp')).data;
  assert.equal(m.workOrders, 1);
  const rm = m.rows.find((r) => r.code === 'RM-001'); assert.equal(rm.required, 30); assert.equal(rm.onhand, 320); assert.equal(rm.shortage, 0);
});
await t('تکمیل دستور تولید: مصرف مواد، ورود محصول، بهای تمام‌شده و سند', async () => {
  const wo = (await admin.call('GET', '/entities/work_orders?f_status=released')).data.rows[0];
  const r = await admin.call('POST', `/entities/work_orders/${wo.id}/actions/complete`);
  assert.equal(r.status, 200);
  assert.equal(r.data.unit_cost, 3_350_000); assert.equal(r.data.material_cost, 28_500_000); // ۱۰×(۳×۹۰۰k + ۰٫۵×۳۰۰k)
  const rep = (await admin.call('GET', '/reports/stock')).data.items;
  assert.equal(rep.find((i) => i.code === 'FG-010').total, 40); assert.equal(rep.find((i) => i.code === 'RM-001').total, 290);
  const tb = (await admin.call('GET', '/reports/trial')).data; assert.equal(tb.totals.debit, tb.totals.credit);
});
await t('دستور تولید با مواد ناکافی رد می‌شود', async () => {
  const boms = (await admin.call('GET', '/entities/boms')).data.rows;
  const wh = (await admin.call('GET', '/entities/warehouses/lookup')).data[0];
  const wo = (await admin.call('POST', '/entities/work_orders', { bom_id: boms[0].id, qty: 100000, warehouse_id: wh.id })).data;
  await admin.call('POST', `/entities/work_orders/${wo.id}/actions/release`);
  const r = await admin.call('POST', `/entities/work_orders/${wo.id}/actions/complete`);
  assert.equal(r.status, 409); assert.match(r.data.error, /کافی نیست/);
  const m = (await admin.call('GET', '/reports/mrp')).data.rows.find((x) => x.code === 'RM-001'); assert.ok(m.shortage > 0);
});
await t('BOM: محصول نمی‌تواند جزو مواد خودش باشد', async () => {
  const items = (await admin.call('GET', '/entities/items/lookup')).data; const fg = items.find((i) => i.label.includes('FG-010'));
  const r = await admin.call('POST', '/entities/boms', { name: 'x', product_id: fg.id, lines: [{ item_id: fg.id, qty: 1 }] });
  assert.equal(r.status, 400);
});
await t('RBAC: کاربر تولید دستور می‌سازد ولی دفتر کل نمی‌بیند', async () => {
  const pr = await client('demo_production', 'demo1234');
  assert.equal((await pr.call('GET', '/entities/work_orders')).status, 200);
  assert.equal((await pr.call('GET', '/reports/trial')).status, 403);
});
await t('شرکت جدید سرفصل پیش‌فرض دارد و جدا از شرکت اول است', async () => {
  const a2 = (await second.call('GET', '/entities/accounts')).data;
  assert.ok(a2.total >= 20); assert.equal((await second.call('GET', '/reports/trial')).data.rows.length, 0);
});

console.log(`\n${passed} تست موفق`);
server.close(); db.close();
fs.rmSync(dir, { recursive: true, force: true });
