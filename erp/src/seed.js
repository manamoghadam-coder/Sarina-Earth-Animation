// داده‌ی نمونه‌ی آزمایشی: node src/seed.js   (شرکت «نمونه» + کاربران همه‌ی نقش‌ها، گذرواژه demo1234)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, tx, allModuleKeys } from './db.js';
import { ENTITIES } from './entities.js';
import * as E from './engine.js';
import { initSecret } from './auth.js';
import { seedChart } from './accounting.js';

export function seedDemo(db) {
  const exists = db.prepare(`SELECT id FROM companies WHERE name='شرکت نمونه'`).get();
  if (exists) return exists.id;
  const sys = { id: 0, username: 'seed' };
  return tx(db, () => {
    const cid = Number(db.prepare('INSERT INTO companies (name,currency,modules) VALUES (?,?,?)').run('شرکت نمونه', 'ریال', JSON.stringify(allModuleKeys())).lastInsertRowid);
    seedChart(db, cid);
    const ctx = { db, companyId: cid, user: sys };
    const mk = (k, d) => E.create(ctx, ENTITIES[k], d);
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

    const roles = ['admin', 'manager', 'hr', 'inventory', 'purchasing', 'sales', 'finance', 'accountant', 'production', 'project', 'qa', 'viewer'];
    for (const r of roles) mk('users', { username: 'demo_' + r, name: 'کاربر ' + r, role: r, password: 'demo1234', active: 1 });

    const accId = (key) => db.prepare('SELECT id FROM e_accounts WHERE company_id=? AND sys_key=?').get(cid, key).id;
    const cap = mk('journal_entries', { date: day(-60), description: 'تزریق سرمایه اولیه', lines: [{ account_id: accId('bank'), debit: 5000000000 }, { account_id: accId('equity'), credit: 5000000000 }] });
    E.runAction(ctx, ENTITIES.journal_entries, cap.id, 'post');
    const dep = mk('departments', { name: 'مهندسی', manager: 'مریم احمدی' });
    const dep2 = mk('departments', { name: 'بازرگانی', manager: 'رضا کاظمی' });
    const e1 = mk('employees', { name: 'مریم احمدی', department_id: dep.id, position: 'مدیر مهندسی', hire_date: '2022-03-01', salary: 180000000, national_id: '0012345678' });
    const e2 = mk('employees', { name: 'علی رضایی', department_id: dep.id, position: 'مهندس پروژه', hire_date: '2023-06-15', salary: 120000000 });
    mk('employees', { name: 'رضا کاظمی', department_id: dep2.id, position: 'مدیر بازرگانی', hire_date: '2021-01-10', salary: 160000000 });
    mk('leaves', { employee_id: e2.id, kind: 'annual', from_date: day(5), to_date: day(7), reason: 'مسافرت' });

    const w = mk('warehouses', { name: 'انبار مرکزی', location: 'تهران' });
    const i1 = mk('items', { code: 'RM-001', name: 'ورق فولادی ۳ میلی‌متر', category: 'مواد اولیه', kind: 'raw', unit: 'کیلوگرم', cost: 900000, price: 1100000, min_stock: 100 });
    const i2 = mk('items', { code: 'FG-010', name: 'قطعه ماشین‌کاری شده A', category: 'محصول', kind: 'finished', unit: 'عدد', cost: 4200000, price: 6000000, min_stock: 20 });
    const i3 = mk('items', { code: 'CS-100', name: 'روغن صنعتی', category: 'مصرفی', unit: 'لیتر', cost: 300000, price: 420000, min_stock: 50 });

    const s = mk('suppliers', { name: 'فولاد البرز', contact: 'آقای محمدی', phone: '02122334455' });
    const po = mk('purchase_orders', { supplier_id: s.id, warehouse_id: w.id, tax_percent: 10, lines: [{ item_id: i1.id, qty: 500, price: 900000 }, { item_id: i3.id, qty: 40, price: 300000 }] });
    E.runAction(ctx, ENTITIES.purchase_orders, po.id, 'approve');
    E.runAction(ctx, ENTITIES.purchase_orders, po.id, 'receive');

    const bom = mk('boms', { name: 'قطعه ماشین‌کاری شده A', product_id: i2.id, output_qty: 1, conversion_cost: 500000, lines: [{ item_id: i1.id, qty: 3 }, { item_id: i3.id, qty: 0.5 }] });
    const wo1 = mk('work_orders', { bom_id: bom.id, qty: 60, warehouse_id: w.id, due_date: day(-5) });
    for (const a of ['release', 'complete']) E.runAction(ctx, ENTITIES.work_orders, wo1.id, a);
    const wo = mk('work_orders', { bom_id: bom.id, qty: 10, warehouse_id: w.id, due_date: day(7) });
    E.runAction(ctx, ENTITIES.work_orders, wo.id, 'release');

    const c = mk('customers', { name: 'صنایع پارس', contact: 'خانم کریمی', phone: '02188776655', credit_limit: 800000000 });
    const so = mk('sales_orders', { customer_id: c.id, warehouse_id: w.id, tax_percent: 10, lines: [{ item_id: i2.id, qty: 30, price: 6000000 }] });
    E.runAction(ctx, ENTITIES.sales_orders, so.id, 'confirm');
    E.runAction(ctx, ENTITIES.sales_orders, so.id, 'ship');
    mk('payments', { kind: 'receipt', customer_id: c.id, amount: 100000000, method: 'bank', reference: 'TRX-1001' });
    mk('expenses', { category: 'rent', description: 'اجاره دفتر مرکزی', amount: 90000000, paid_to: 'مالک ساختمان' });

    const p = mk('projects', { name: 'خط تولید جدید', customer_id: c.id, manager_id: e1.id, start_date: day(-30), end_date: day(90), budget: 2000000000, status: 'active' });
    mk('tasks', { project_id: p.id, title: 'طراحی نقشه‌ها', assignee_id: e2.id, due_date: day(-3), status: 'doing', progress: 60, priority: 'high' });
    mk('tasks', { project_id: p.id, title: 'خرید تجهیزات', assignee_id: e1.id, due_date: day(20), status: 'todo', priority: 'normal' });
    mk('tasks', { project_id: p.id, title: 'مطالعات اولیه', assignee_id: e1.id, due_date: day(-20), status: 'done' });

    mk('ncr', { title: 'ابعاد قطعه خارج از تلورانس', project_id: p.id, severity: 'major', source: 'inspection', description: 'سه قطعه از لات ۱۲ خارج از تلورانس است', owner_id: e2.id, due_date: day(10) });
    mk('documents', { code: 'QP-01', title: 'رویه کنترل مدارک', doc_type: 'procedure', revision: '02', owner: 'تضمین کیفیت', status: 'approved', effective_date: day(-100) });
    return cid;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.env.ERP_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  initSecret(dir);
  const db = openDb(path.join(dir, 'erp.db'));
  migrate(db);
  const id = seedDemo(db);
  console.log(`شرکت نمونه آماده است (id=${id}). کاربران: demo_admin ... demo_viewer — گذرواژه: demo1234`);
}
