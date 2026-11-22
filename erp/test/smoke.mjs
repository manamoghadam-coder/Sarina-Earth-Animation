// تست یکپارچگی: ساخت سرور روی دیتابیس موقت و بررسی قوانین کلیدی (ایزولاسیون شرکت‌ها، RBAC، گردش کار)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/seed.js';

process.env.ERP_SUPERADMIN_PASSWORD = 'Super-Pass-1';
process.env.ERP_MAX_UPLOAD_MB = '1';
if (process.env.TEST_DATABASE_URL) { // اجرای همان تست‌ها روی PostgreSQL: schema تازه
  const pg = (await import('pg')).default; const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect(); await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await c.end();
  console.log('  [PostgreSQL]');
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
const { server, db } = await createApp({ dataDir: dir, quiet: true, databaseUrl: process.env.TEST_DATABASE_URL || '' });
await seedDemo(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function client(username, password, company) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp': '1' }, body: JSON.stringify({ username, password }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return {
    ok: r.ok, status: r.status,
    async raw(url, buf) {
      const res = await fetch(base + '/api' + url, { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', 'x-erp': '1', ...(company ? { 'x-company': String(company) } : {}) }, body: buf });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    },
    async download(id) {
      const res = await fetch(base + '/api/attachments/' + id, { headers: { cookie, 'x-erp': '1', ...(company ? { 'x-company': String(company) } : {}) } });
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    },
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
  assert.equal(is.grossProfit, 73_500_000);   // ۳۰ × ۳٬۵۵۰٬۰۰۰ = ۱۰۶٫۵م بهای تمام‌شده
  assert.equal(is.netIncome, 25_500_000);     // ۱۸۰ - (۱۰۶٫۵ + ۹۰ اجاره - ۴۲ سربار جذب‌شده)
});
await t('ترازنامه: دارایی = بدهی + حقوق صاحبان سرمایه', async () => {
  const bs = (await admin.call('GET', '/reports/balance')).data;
  assert.equal(bs.difference, 0); assert.equal(bs.totalAssets, 5_551_700_000); assert.equal(bs.totalLiabilities, 526_200_000);
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
  assert.equal(r.data.unit_cost, 3_550_000); assert.equal(r.data.material_cost, 28_500_000); // ۱۰×(۳×۹۰۰k + ۰٫۵×۳۰۰k)
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

// ───────────── حساب تفصیلی ─────────────
await t('کارت حساب مشتری و تطبیق با حساب کل دریافتنی', async () => {
  const cu = (await admin.call('GET', '/entities/customers/lookup')).data[0];
  const sum = (await admin.call('GET', '/reports/party?type=customer')).data;
  assert.equal(sum.total, 138_000_000); assert.equal(sum.control, 138_000_000); assert.equal(sum.unassigned, 0);
  const st = (await admin.call('GET', `/reports/party?type=customer&party=${cu.id}`)).data;
  assert.equal(st.closing, 138_000_000); assert.equal(st.rows.length, 4); /* فروش، دریافت، برگشت دریافت، دریافت اصلاح‌شده */ assert.equal(st.rows[0].balance, 198_000_000);
});
await t('سند دستی با طرف حساب تفصیلی در کارت مشتری می‌آید', async () => {
  const cu = (await admin.call('GET', '/entities/customers/lookup')).data[0];
  const j = (await admin.call('POST', '/entities/journal_entries', { description: 'تعدیل', lines: [{ account_id: accId('1201'), debit: 1000, customer_id: cu.id }, { account_id: accId('4201'), credit: 1000 }] })).data;
  await admin.call('POST', `/entities/journal_entries/${j.id}/actions/post`);
  const sum = (await admin.call('GET', '/reports/party?type=customer')).data;
  assert.equal(sum.total, 138_001_000); assert.equal(sum.unassigned, 0);
  await admin.call('POST', `/entities/journal_entries/${j.id}/actions/reverse`);
  assert.equal((await admin.call('GET', '/reports/party?type=customer')).data.total, 138_000_000);
});
await t('کارت تأمین‌کننده با مانده‌ی بستانکار', async () => {
  const sum = (await admin.call('GET', '/reports/party?type=supplier')).data;
  assert.equal(sum.total, 508_200_000); assert.equal(sum.unassigned, 0);
});

// ───────────── ضایعات، مرکز کار، ظرفیت ─────────────
let wcId, bom2;
await t('دستور تولید با ضایعات: هزینه روی محصول سالم جذب می‌شود', async () => {
  wcId = (await admin.call('POST', '/entities/work_centers', { name: 'مونتاژ', capacity_hours_day: 8, hourly_rate: 100_000 })).data.id;
  const items = (await admin.call('GET', '/entities/items/lookup')).data;
  const fg = items.find((i) => i.label.includes('FG-010')), rm = items.find((i) => i.label.includes('RM-001'));
  const wh = (await admin.call('GET', '/entities/warehouses/lookup')).data[0];
  bom2 = (await admin.call('POST', '/entities/boms', { name: 'BOM با ضایعات', product_id: fg.id, output_qty: 1, work_center_id: wcId, hours_per_batch: 2, scrap_pct: 10, lines: [{ item_id: rm.id, qty: 3 }] })).data;
  const wo = (await admin.call('POST', '/entities/work_orders', { bom_id: bom2.id, qty: 5, scrap_qty: 1, warehouse_id: wh.id })).data;
  assert.equal(wo.planned_hours, 10);
  const cap = (await admin.call('GET', '/reports/capacity')).data.rows.find((r) => r.id === wcId);
  assert.equal(cap.hours, 10); assert.equal(cap.days, 1.25);
  const mr = (await admin.call('GET', '/reports/mrp')).data.rows.find((r) => r.code === 'RM-001'); assert.ok(mr.required >= 16.5);
  await admin.call('POST', `/entities/work_orders/${wo.id}/actions/release`);
  const r = await admin.call('POST', `/entities/work_orders/${wo.id}/actions/complete`);
  assert.equal(r.status, 200);
  assert.equal(r.data.material_cost, 16_200_000);          // ۱۸ کیلو (۵ سالم + ۱ ضایعه) × ۳ × ۹۰۰k
  assert.equal(r.data.conversion_cost, 1_200_000);         // ۱۲ ساعت × ۱۰۰k
  assert.equal(r.data.unit_cost, 3_480_000); assert.equal(r.data.scrap_cost, 3_480_000); assert.equal(r.data.yield_pct, 83.3);
  const tb = (await admin.call('GET', '/reports/trial')).data; assert.equal(tb.totals.debit, tb.totals.credit);
});

// ───────────── نگهداری و تعمیرات ─────────────
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
let mach;
await t('PM: ماشین دارای تأخیر شناسایی و دستورکار خودکار ساخته می‌شود (بدون تکرار)', async () => {
  mach = (await admin.call('POST', '/entities/machines', { code: 'T-1', name: 'ماشین تست', pm_interval_days: 30, last_pm_date: daysAgo(40) })).data;
  const row = (await admin.call('GET', '/reports/pm')).data.rows.find((r) => r.code === 'T-1');
  assert.equal(row.pm_state, 'overdue'); assert.equal(row.days_left, -10);
  const n1 = (await admin.call('POST', '/maintenance/generate')).data.created;
  assert.ok(n1 >= 1);
  assert.equal((await admin.call('POST', '/maintenance/generate')).data.created, 0);
});
await t('پایان دستورکار PM: تاریخ PM بعدی، وضعیت ماشین و هزینه در حسابداری', async () => {
  const mo = (await admin.call('GET', `/entities/maintenance_orders?f_machine_id=${mach.id}`)).data.rows[0];
  assert.equal((await admin.call('PUT', `/entities/maintenance_orders/${mo.id}`, { cost: 1_000_000, downtime_hours: 2 })).status, 200);
  assert.equal((await admin.call('POST', `/entities/maintenance_orders/${mo.id}/actions/complete`)).status, 200);
  const m = (await admin.call('GET', `/entities/machines/${mach.id}`)).data;
  assert.equal(m.last_pm_date, daysAgo(0)); assert.equal(m.status, 'operational');
  const row = (await admin.call('GET', '/reports/pm')).data.rows.find((r) => r.code === 'T-1'); assert.equal(row.pm_state, 'ok'); assert.equal(row.downtime90, 2);
  const tb = (await admin.call('GET', '/reports/trial')).data; assert.equal(T(tb.rows, '5207').closing, 1_000_000); assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal((await admin.call('PUT', `/entities/maintenance_orders/${mo.id}`, { cost: 5 })).status, 409);
});
await t('خرابی: دستورکار اصلاحی ماشین را «خراب» می‌کند و پایان آن برمی‌گرداند', async () => {
  const mo = (await admin.call('POST', '/entities/maintenance_orders', { machine_id: mach.id, kind: 'corrective', description: 'نشت روغن' })).data;
  assert.equal((await admin.call('GET', `/entities/machines/${mach.id}`)).data.status, 'down');
  await admin.call('POST', `/entities/maintenance_orders/${mo.id}/actions/complete`);
  assert.equal((await admin.call('GET', `/entities/machines/${mach.id}`)).data.status, 'operational');
});

// ───────────── بستن سال مالی ─────────────
await t('بستن سال: حساب‌های موقت صفر، سود به انباشته، ترازنامه متوازن، دوره قفل', async () => {
  const before = (await admin.call('GET', '/reports/income')).data;
  const d = new Date().toISOString().slice(0, 10);
  const r = await admin.call('POST', '/accounting/close-year', { date: d });
  assert.equal(r.status, 200); assert.equal(r.data.net, before.netIncome);
  const tb = (await admin.call('GET', '/reports/trial')).data;
  assert.equal(T(tb.rows, '4101').closing, 0); assert.equal(T(tb.rows, '5101').closing, 0);
  assert.equal(T(tb.rows, '3201').closing, -before.netIncome);
  assert.equal(tb.totals.debit, tb.totals.credit);
  const bs = (await admin.call('GET', '/reports/balance')).data; assert.equal(bs.difference, 0); assert.equal(bs.earnings, 0);
  assert.equal((await admin.call('GET', '/reports/income')).data.totalRevenue, before.totalRevenue); // سود و زیان تحت تأثیر سند بستن نیست
  assert.equal((await admin.call('POST', '/entities/expenses', { category: 'rent', description: 'x', amount: 5 })).status, 409);
  assert.equal((await admin.call('POST', '/accounting/close-year', { date: d })).status, 409);
});
await t('بازگشایی: برگشت سند بستن پس از برداشتن قفل', async () => {
  assert.equal((await admin.call('PUT', '/company', { lock_date: null })).status, 200);
  const cl = (await admin.call('GET', '/entities/journal_entries?f_source=closing')).data.rows[0];
  assert.equal((await admin.call('POST', `/entities/journal_entries/${cl.id}/actions/reverse`)).status, 200);
  const tb = (await admin.call('GET', '/reports/trial')).data;
  assert.equal(T(tb.rows, '4101').closing, -180_000_000); assert.equal(T(tb.rows, '3201').closing, 0);
  assert.equal((await admin.call('GET', '/reports/income')).data.totalRevenue, 180_000_000);
});

// ───────────── پیوست فایل ─────────────
const pdf = Buffer.from('%PDF-1.4\n% تست پیوست\n%%EOF');
let att, soId;
await t('آپلود، فهرست و دانلود پیوست (محتوا عین فایل اصلی)', async () => {
  soId = (await admin.call('GET', '/entities/sales_orders')).data.rows[0].id;
  const r = await admin.raw(`/attachments?entity=sales_orders&id=${soId}&name=${encodeURIComponent('قرارداد فروش.pdf')}`, pdf);
  assert.equal(r.status, 201); att = r.data;
  const list = (await admin.call('GET', `/attachments?entity=sales_orders&id=${soId}`)).data;
  assert.equal(list.length, 1); assert.equal(list[0].name, 'قرارداد فروش.pdf'); assert.equal(list[0].size, pdf.length);
  const d = await admin.download(att.id);
  assert.equal(d.status, 200); assert.deepEqual(d.buf, pdf);
  assert.match(d.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''/); assert.equal(d.headers.get('x-content-type-options'), 'nosniff');
});
await t('پسوند غیرمجاز، فایل خالی و حجم زیاد رد می‌شود', async () => {
  assert.equal((await admin.raw(`/attachments?entity=sales_orders&id=${soId}&name=virus.exe`, pdf)).status, 400);
  assert.equal((await admin.raw(`/attachments?entity=sales_orders&id=${soId}&name=a.pdf`, Buffer.alloc(0))).status, 400);
  assert.equal((await admin.raw(`/attachments?entity=sales_orders&id=${soId}&name=big.pdf`, Buffer.alloc(1.5 * 1048576, 1))).status, 413);
  assert.equal((await admin.raw(`/attachments?entity=users&id=1&name=a.pdf`, pdf)).status, 404);
});
await t('RBAC پیوست: HR به فروش دسترسی ندارد، مشاهده‌گر فقط می‌بیند/دانلود می‌کند', async () => {
  const hr2 = await client('demo_hr', 'demo1234');
  assert.equal((await hr2.raw(`/attachments?entity=sales_orders&id=${soId}&name=a.pdf`, pdf)).status, 403);
  assert.equal((await hr2.call('GET', `/attachments?entity=sales_orders&id=${soId}`)).status, 403);
  const v = await client('demo_viewer', 'demo1234');
  assert.equal((await v.call('GET', `/attachments?entity=sales_orders&id=${soId}`)).data.length, 1);
  assert.equal((await v.download(att.id)).status, 200);
  assert.equal((await v.raw(`/attachments?entity=sales_orders&id=${soId}&name=a.pdf`, pdf)).status, 403);
  assert.equal((await v.call('DELETE', `/attachments/${att.id}`)).status, 403);
});
await t('ایزولاسیون پیوست بین شرکت‌ها', async () => {
  assert.equal((await second.download(att.id)).status, 404);
  assert.equal((await second.call('DELETE', `/attachments/${att.id}`)).status, 404);
  assert.equal((await second.call('GET', `/attachments?entity=sales_orders&id=${soId}`)).status, 404);
});
await t('حذف رکورد، پیوست و فایل روی دیسک را هم پاک می‌کند', async () => {
  const ex = (await admin.call('POST', '/entities/expenses', { category: 'other', description: 'با پیوست', amount: 10, date: '2020-01-01' })).data;
  const a = (await admin.raw(`/attachments?entity=expenses&id=${ex.id}&name=fish.png`, Buffer.from([137, 80, 78, 71]))).data;
  const countFiles = () => { let n = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(path.join(d, e.name)) : n++; }; walk(path.join(dir, 'files')); return n; };
  const before = countFiles();
  assert.equal((await admin.call('DELETE', `/entities/expenses/${ex.id}`)).status, 200);
  assert.equal((await admin.download(a.id)).status, 404); assert.equal(countFiles(), before - 1);
});
await t('حذف پیوست توسط مجاز', async () => {
  assert.equal((await admin.call('DELETE', `/attachments/${att.id}`)).status, 200);
  assert.equal((await admin.call('GET', `/attachments?entity=sales_orders&id=${soId}`)).data.length, 0);
});

// ───────────── حقوق و دستمزد (شرکت دوم: دفتر کل خالی) ─────────────
let run, slipA, slipB;
await t('پارامترها: پله‌ی اول باید از ۰ شروع شود؛ فقط یک رکورد پارامتر', async () => {
  assert.equal((await second.call('POST', '/entities/payroll_params', { brackets: [{ from: 100, rate: 10 }] })).status, 400);
  const ok = await second.call('POST', '/entities/payroll_params', { insurance_employee_pct: 7, insurance_employer_pct: 23, overtime_multiplier: 1.4, daily_hours: 7.33, brackets: [{ from: 0, rate: 0 }, { from: 20_000_000, rate: 10 }, { from: 40_000_000, rate: 20 }] });
  assert.equal(ok.status, 201);
  assert.equal((await second.call('POST', '/entities/payroll_params', { insurance_employee_pct: 1 })).status, 409);
});
await t('ایجاد دوره‌ی حقوق: بازه‌ی شمسی (مهر ۱۴۰۵ = ۳۰ روز) و ممنوعیت دوره‌ی تکراری', async () => {
  const A = (await second.call('POST', '/entities/employees', { name: 'الف', salary: 30_000_000, housing_allowance: 3_000_000 })).data;
  const B = (await second.call('POST', '/entities/employees', { name: 'ب', salary: 15_000_000 })).data;
  const lv = (await second.call('POST', '/entities/leaves', { employee_id: B.id, kind: 'unpaid', from_date: '2026-09-25', to_date: '2026-09-27' })).data;
  assert.equal((await second.call('POST', `/entities/leaves/${lv.id}/actions/approve`)).status, 200);
  run = (await second.call('POST', '/entities/payroll_runs', { year: 1405, month: 7 })).data;
  assert.equal(run.start_date, '2026-09-23'); assert.equal(run.end_date, '2026-10-22'); assert.equal(run.days, 30);
  assert.equal((await second.call('POST', '/entities/payroll_runs', { year: 1405, month: 7 })).status, 409);
  assert.equal((await second.call('POST', '/entities/payroll_runs', { year: 1405, month: 13 })).status, 400);
  assert.equal((await second.call('POST', '/entities/payslips', { run_id: run.id })).status, 405);
});
await t('محاسبه‌ی فیش: مرخصی بدون حقوق، بیمه، مالیات پلکانی', async () => {
  assert.equal((await second.call('POST', `/entities/payroll_runs/${run.id}/actions/generate`)).status, 200);
  const slips = (await second.call('GET', `/entities/payslips?f_run_id=${run.id}`)).data.rows;
  assert.equal(slips.length, 2);
  slipA = slips.find((x) => x._l.employee_id.endsWith('· الف')); slipB = slips.find((x) => x._l.employee_id.endsWith('· ب'));
  assert.deepEqual([slipA.gross, slipA.ins_employee, slipA.ins_employer, slipA.tax, slipA.net], [33_000_000, 2_310_000, 7_590_000, 1_069_000, 29_621_000]);
  assert.deepEqual([slipB.unpaid_days, slipB.base_pay, slipB.ins_employee, slipB.tax, slipB.net], [3, 13_500_000, 945_000, 0, 12_555_000]);
});
await t('ویرایش فیش (اضافه‌کاری، پاداش، کسورات) بازمحاسبه و جمع دوره به‌روز می‌شود', async () => {
  const r = await second.call('PUT', `/entities/payslips/${slipA.id}`, { overtime_hours: 10, bonus: 1_000_000, other_deductions: 500_000 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.overtime_pay, r.data.gross, r.data.ins_employee, r.data.tax, r.data.net], [1_909_959, 35_909_959, 2_513_697, 1_339_626, 31_556_636]);
  run = (await second.call('GET', `/entities/payroll_runs/${run.id}`)).data;
  assert.deepEqual([run.total_gross, run.total_insurance, run.total_tax, run.total_net, run.employer_cost], [49_409_959, 3_458_697, 1_339_626, 44_111_636, 60_774_250]);
  assert.equal((await second.call('PUT', `/entities/payslips/${slipA.id}`, { other_deductions: 999_999_999 })).status, 400); // خالص منفی
});
await t('تأیید دوره: سند حسابداری متوازن؛ پس از آن فیش قابل ویرایش نیست', async () => {
  assert.equal((await second.call('POST', `/entities/payroll_runs/${run.id}/actions/approve`)).status, 200);
  const tb = (await second.call('GET', '/reports/trial')).data;
  const v = (code) => T(tb.rows, code)?.closing;
  assert.equal(v('5201'), 49_409_959); assert.equal(v('5208'), 11_364_291); assert.equal(v('2301'), -44_111_636);
  assert.equal(v('2302'), -14_822_988); assert.equal(v('2303'), -1_339_626); assert.equal(v('1601'), -500_000);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal((await second.call('PUT', `/entities/payslips/${slipA.id}`, { bonus: 1 })).status, 409);
  assert.equal((await second.call('POST', `/entities/payroll_runs/${run.id}/actions/generate`)).status, 409);
  assert.equal((await second.call('DELETE', `/entities/payslips/${slipA.id}`)).status, 409);
});
await t('ثبت پرداخت: بدهی حقوق صفر می‌شود و از بانک خارج می‌شود', async () => {
  assert.equal((await second.call('POST', `/entities/payroll_runs/${run.id}/actions/pay`)).status, 200);
  const tb = (await second.call('GET', '/reports/trial')).data;
  assert.equal(T(tb.rows, '2301').closing, 0); assert.equal(T(tb.rows, '1102').closing, -44_111_636); assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal((await second.call('POST', `/entities/payroll_runs/${run.id}/actions/cancel`)).status, 409); // پس از پرداخت لغو نمی‌شود
});
await t('لغو دوره‌ی تأییدشده، سند را برگشت می‌دهد و ماه آزاد می‌شود', async () => {
  const r2 = (await second.call('POST', '/entities/payroll_runs', { year: 1405, month: 8 })).data;
  await second.call('POST', `/entities/payroll_runs/${r2.id}/actions/generate`);
  await second.call('POST', `/entities/payroll_runs/${r2.id}/actions/approve`);
  const before = T((await second.call('GET', '/reports/trial')).data.rows, '5201').closing;
  assert.ok(before > 49_409_959);
  assert.equal((await second.call('POST', `/entities/payroll_runs/${r2.id}/actions/cancel`)).status, 200);
  assert.equal(T((await second.call('GET', '/reports/trial')).data.rows, '5201').closing, 49_409_959);
  assert.equal((await second.call('POST', '/entities/payroll_runs', { year: 1405, month: 8 })).status, 201); // ماه لغوشده دوباره قابل ثبت
});
await t('RBAC حقوق: HR و حسابدار دسترسی دارند، فروش و مشاهده‌گر ندارند', async () => {
  const hr3 = await client('demo_hr', 'demo1234'), ac = await client('demo_accountant', 'demo1234'), sl = await client('demo_sales', 'demo1234'), vw = await client('demo_viewer', 'demo1234');
  assert.equal((await hr3.call('GET', '/entities/payroll_runs')).status, 200); assert.equal((await ac.call('GET', '/entities/payslips')).status, 200);
  assert.equal((await sl.call('GET', '/entities/payslips')).status, 403); assert.equal((await vw.call('GET', '/entities/payslips')).status, 403);
  assert.equal((await admin.call('GET', '/entities/payslips')).data.total, 3);   // ایزولاسیون: شرکت اول فقط ۳ فیش نمونه‌ی خودش را می‌بیند
  assert.equal((await second.call('GET', '/entities/payslips')).data.total, 4);  // و شرکت دوم فقط فیش‌های خودش را (۲ دوره‌ی هفتم + ۲ دوره‌ی لغوشده‌ی هشتم)
});

console.log(`\n${passed} تست موفق`);
server.close(); await db.close();
fs.rmSync(dir, { recursive: true, force: true });
