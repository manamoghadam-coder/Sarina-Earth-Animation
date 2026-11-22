// تست XSS ذخیره‌شده در مرورگر واقعی (نیازمند playwright؛ در غیر این صورت رد می‌شود)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { seedDemo } from '../src/seed.js';

let chromium;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { console.log('  (playwright نصب نیست؛ تست XSS رد شد)'); process.exit(0); }
process.env.ERP_SUPERADMIN_PASSWORD = 'Super-Pass-1';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-xss-'));
const { server, db, close } = await createApp({ dataDir: dir, quiet: true, databaseUrl: process.env.TEST_DATABASE_URL || '' });
await seedDemo(db);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = `"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><svg onload=window.__xss=3>'</td></tr></table>`;
const browser = await chromium.launch(); const page = await browser.newPage();
const problems = [];
page.on('dialog', async (d) => { problems.push('dialog: ' + d.message()); await d.dismiss(); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|inline/i.test(m.text())) problems.push('CSP: ' + m.text().slice(0, 120)); });
await page.goto(base); await page.fill('#u', 'demo_admin'); await page.fill('#p', 'demo1234'); await page.click('button.btn.pri'); await page.waitForSelector('.cards');

const post = (url, body, method = 'POST') => page.evaluate(async ([u, b, m]) => { const r = await fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-ERP': '1' }, body: JSON.stringify(b) }); return { s: r.status, d: await r.json().catch(() => ({})) }; }, [url, body, method]);
const ids = {};
const mk = async (key, body) => { const r = await post(`/entities/${key}`, body); assert.equal(r.s, 201, `${key}: ${JSON.stringify(r.d)}`); ids[key] = r.d.id; return r.d; };
await mk('departments', { name: P, manager: P, description: P });
const emp = await mk('employees', { name: P, position: P });
const item = await mk('items', { code: P, name: P, category: P, unit: P, kind: 'raw' });
const wh = await mk('warehouses', { name: P, location: P });
const sup = await mk('suppliers', { name: P, contact: P });
const cu = await mk('customers', { name: P, contact: P });
const prj = await mk('projects', { name: P, customer_id: cu.id, manager_id: emp.id });
await mk('tasks', { project_id: prj.id, title: P, assignee_id: emp.id });
await mk('ncr', { title: P, description: P, root_cause: P, corrective_action: P, project_id: prj.id });
await mk('documents', { code: P, title: P, owner: P });
const acc = await mk('accounts', { code: '9999', name: P, type: 'asset' });
await mk('expenses', { description: P, paid_to: P, category: 'other', amount: 5 });
const wc = await mk('work_centers', { name: P });
await mk('machines', { code: P, name: P, work_center_id: wc.id, pm_interval_days: 10, last_pm_date: '2020-01-01' });
await mk('boms', { name: P, product_id: item.id, lines: [{ item_id: item.id + 0 === item.id ? (await post('/entities/items', { code: 'RAW-X', name: 'x', kind: 'raw' })).d.id : 0, qty: 1 }], work_center_id: wc.id });
await mk('journal_entries', { description: P, lines: [{ account_id: acc.id, debit: 1, memo: P }, { account_id: acc.id, credit: 1, memo: P }] });
await mk('purchase_orders', { supplier_id: sup.id, warehouse_id: wh.id, notes: P, lines: [{ item_id: item.id, qty: 1, price: 1 }] });
await mk('users', { username: 'xss_user', name: P, role: 'viewer', password: 'password123' });
await post('/company', { name: P, currency: P }, 'PUT');
await page.evaluate(async ([id, name]) => fetch(`/api/attachments?entity=expenses&id=${id}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'X-ERP': '1', 'Content-Type': 'application/octet-stream' }, body: new Blob(['x']) }), [ids.expenses, `<img src=x onerror=window.__xss=4>${'.'}pdf`.replace('.pdf', '') + '.pdf']);

const keys = ['departments', 'employees', 'items', 'warehouses', 'stock_moves', 'suppliers', 'customers', 'projects', 'tasks', 'ncr', 'documents', 'accounts', 'expenses', 'work_centers', 'machines', 'boms', 'journal_entries', 'purchase_orders', 'users', 'payroll_runs', 'payslips', 'leaves', 'sales_orders', 'payments', 'work_orders', 'maintenance_orders'];
let pages = 0;
const visit = async (hash) => { await page.goto(base + '/' + hash); await page.waitForTimeout(350); pages++; const x = await page.evaluate(() => window.__xss); if (x) problems.push(`window.__xss=${x} در ${hash}`); };
await visit('#/e/departments');
assert.ok((await page.locator('tbody').innerText()).includes('<script>window.__xss=2'), 'داده‌ی مخرب باید به‌صورت متن خام نمایش داده شود (تست حساس است)');
for (const k of keys) {
  await visit('#/e/' + k);
  const edit = page.locator('[data-edit]').first();
  if (await edit.count()) { await edit.click(); await page.waitForTimeout(350); pages++; const x = await page.evaluate(() => window.__xss); if (x) problems.push(`window.__xss=${x} در فرم ${k}`); const cn = page.locator('#cn'); if (await cn.count()) await cn.click(); }
}
for (const h of ['#/', '#/report/stock', '#/report/balances', '#/report/trial', '#/report/ledger?account=' + acc.id, '#/report/party?type=customer', '#/report/party?type=customer&party=' + cu.id, '#/report/party?type=supplier', '#/report/income', '#/report/balance', '#/report/mrp', '#/report/capacity', '#/report/pm', '#/settings', '#/audit', '#/companies']) await visit(h);
// پارامترهای مخرب در آدرس
for (const h of [`#/report/party?type=${encodeURIComponent(P)}&party=${encodeURIComponent(P)}`, `#/report/trial?from=${encodeURIComponent(P)}&to=${encodeURIComponent(P)}`, `#/e/${encodeURIComponent(P)}`, `#/report/${encodeURIComponent(P)}`, `#/e/payslips?f_run_id=${encodeURIComponent(P)}`]) await visit(h);

await browser.close(); await close(); fs.rmSync(dir, { recursive: true, force: true });
assert.deepEqual(problems, [], problems.join('\n'));
console.log(`  ✓ XSS: ${pages} صفحه/فرم با داده‌ی مخرب بررسی شد؛ هیچ اسکریپتی اجرا نشد`);
