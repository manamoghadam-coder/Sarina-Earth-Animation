import { HttpError, bad, daysBetween } from './util.js';
import { stockOf, insertMove, applyAvgCost, invKey } from './stock.js';
import * as ACC from './accounting.js';
import { completeWorkOrder, completeMaintenance, nextPm, plannedHours } from './industry.js';
import { addDays, today, jalaliMonthRange } from './util.js';
import { recalcSlip, updateRunTotals, generatePayslips, approveRun, payRun, cancelRun } from './payroll.js';
export { stockOf };

export const MODULES = {
  hr: { title: 'منابع انسانی', icon: '👥' },
  inventory: { title: 'انبار و موجودی', icon: '📦' },
  purchasing: { title: 'خرید', icon: '🛒' },
  sales: { title: 'فروش', icon: '💼' },
  finance: { title: 'مالی', icon: '💰' },
  accounting: { title: 'حسابداری', icon: '📒' },
  production: { title: 'تولید', icon: '🏭' },
  payroll: { title: 'حقوق و دستمزد', icon: '💵' },
  projects: { title: 'پروژه‌ها (PMO)', icon: '📐' },
  quality: { title: 'کیفیت (QA/QMS)', icon: '✅' },
  admin: { title: 'مدیریت سامانه', icon: '⚙️' },
};

// c = رنگ نشانگر وضعیت: ok / warn / bad / info / mute
const S = (...a) => a.map(([v, l, c]) => ({ v, l, c }));
const ACTIVE = S(['active', 'فعال', 'ok'], ['inactive', 'غیرفعال', 'mute']);

async function prepLines(ctx, rec) {
  const lines = Array.isArray(rec.lines) ? rec.lines : [];
  if (!lines.length) throw bad('حداقل یک ردیف کالا لازم است');
  let sub = 0;
  const out = [];
  for (const [i, l] of lines.entries()) {
    const item = await ctx.db.get('SELECT id FROM e_items WHERE id=? AND company_id=?', Number(l.item_id), ctx.companyId);
    if (!item) throw bad(`ردیف ${i + 1}: کالا نامعتبر است`);
    const qty = Number(l.qty), price = Number(l.price);
    if (!(qty > 0)) throw bad(`ردیف ${i + 1}: تعداد باید بزرگ‌تر از صفر باشد`);
    if (!(price >= 0)) throw bad(`ردیف ${i + 1}: قیمت نامعتبر است`);
    sub += qty * price;
    out.push({ item_id: item.id, qty, price });
  }
  rec.lines = out;
  const tax = Number(rec.tax_percent || 0);
  if (tax < 0 || tax > 100) throw bad('درصد مالیات نامعتبر است');
  rec.tax_percent = tax;
  rec.subtotal = Math.round(sub);
  rec.total = Math.round(sub * (1 + tax / 100));
}

const ITEM_LINE_COLS = (price) => [
  { k: 'item_id', label: 'کالا', type: 'ref', ref: 'items' }, { k: 'qty', label: 'تعداد', type: 'number' },
  ...(price ? [{ k: 'price', label: 'قیمت واحد', type: 'number' }] : []),
];
const itemInfo = async (ctx, id) => (await ctx.db.get('SELECT id,name,cost,kind FROM e_items WHERE id=? AND company_id=?', id, ctx.companyId));

const orderRules = (what) => ({
  async validate(ctx, rec, old) {
    if (old && old.status !== 'draft') throw new HttpError(409, `فقط ${what} پیش‌نویس قابل ویرایش است`);
    await prepLines(ctx, rec);
  },
  editWhen: ['draft'],
  async canDelete(rec) { if (!['draft', 'cancelled'].includes(rec.status)) throw new HttpError(409, 'فقط پیش‌نویس یا لغوشده قابل حذف است'); },
});

const dateField = (k, label, extra = {}) => ({ k, label, type: 'date', ...extra });

export const ENTITIES = {
  // ───────────── منابع انسانی ─────────────
  departments: {
    module: 'hr', title: 'واحدهای سازمانی', singular: 'واحد', label: ['name'],
    fields: [
      { k: 'name', label: 'نام واحد', type: 'text', required: true, list: true, unique: true },
      { k: 'manager', label: 'مدیر واحد', type: 'text', list: true },
      { k: 'description', label: 'توضیحات', type: 'textarea' },
    ],
  },
  employees: {
    module: 'hr', title: 'کارکنان', singular: 'کارمند', label: ['number', 'name'], numbering: 'EMP', search: ['number', 'name', 'national_id', 'position'], attachModule: 'payroll',
    fields: [
      { k: 'number', label: 'کد پرسنلی', type: 'text', readonly: true, list: true },
      { k: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, list: true },
      { k: 'national_id', label: 'کد ملی', type: 'text', sensitive: true, pattern: '^\\d{10}$', patternMsg: 'کد ملی باید ۱۰ رقم باشد' },
      { k: 'department_id', label: 'واحد', type: 'ref', ref: 'departments', list: true },
      { k: 'position', label: 'سمت', type: 'text', list: true },
      dateField('hire_date', 'تاریخ استخدام'),
      { k: 'salary', label: 'حقوق پایه (ماهانه)', type: 'money', min: 0 , sensitive: true },
      { k: 'housing_allowance', label: 'حق مسکن', type: 'money', min: 0 , sensitive: true },
      { k: 'food_allowance', label: 'حق خواروبار', type: 'money', min: 0 , sensitive: true },
      { k: 'child_allowance', label: 'حق اولاد', type: 'money', min: 0 , sensitive: true },
      { k: 'insured', label: 'مشمول بیمه', type: 'bool', default: 1 },
      { k: 'taxable', label: 'مشمول مالیات', type: 'bool', default: 1 },
      { k: 'status', label: 'وضعیت', type: 'select', options: S(['active', 'شاغل', 'ok'], ['leave', 'مرخصی بلندمدت', 'warn'], ['terminated', 'ترک کار', 'mute']), default: 'active', list: true, filter: true },
      { k: 'phone', label: 'تلفن', type: 'text' },
      { k: 'email', label: 'ایمیل', type: 'text' },
    ],
  },
  leaves: {
    module: 'hr', title: 'مرخصی‌ها', singular: 'مرخصی', label: ['id'], numbering: 'LV',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'employee_id', label: 'کارمند', type: 'ref', ref: 'employees', required: true, list: true },
      { k: 'kind', label: 'نوع', type: 'select', options: S(['annual', 'استحقاقی'], ['sick', 'استعلاجی'], ['unpaid', 'بدون حقوق'], ['other', 'سایر']), default: 'annual', list: true },
      dateField('from_date', 'از تاریخ', { required: true, list: true }),
      dateField('to_date', 'تا تاریخ', { required: true, list: true }),
      { k: 'days', label: 'تعداد روز', type: 'number', readonly: true, list: true },
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'pending', options: S(['pending', 'در انتظار تأیید', 'warn'], ['approved', 'تأیید شده', 'ok'], ['rejected', 'رد شده', 'bad']), list: true, filter: true },
      { k: 'reason', label: 'توضیحات', type: 'textarea' },
    ],
    editWhen: ['pending'],
    async validate(ctx, rec, old) {
      if (old && old.status !== 'pending') throw new HttpError(409, 'درخواست بررسی‌شده قابل ویرایش نیست');
      if (rec.to_date < rec.from_date) throw bad('تاریخ پایان قبل از شروع است');
      rec.days = daysBetween(rec.from_date, rec.to_date) + 1;
    },
    actions: [
      { key: 'approve', label: 'تأیید', from: ['pending'], to: 'approved', style: 'ok' },
      { key: 'reject', label: 'رد', from: ['pending'], to: 'rejected', style: 'bad', confirm: 'این درخواست رد شود؟' },
    ],
  },

  // ───────────── انبار ─────────────
  items: {
    module: 'inventory', title: 'کالاها', singular: 'کالا', label: ['code', 'name'], search: ['code', 'name', 'category'],
    fields: [
      { k: 'code', label: 'کد کالا', type: 'text', required: true, unique: true, list: true },
      { k: 'name', label: 'نام کالا', type: 'text', required: true, list: true },
      { k: 'category', label: 'گروه', type: 'text', list: true },
      { k: 'kind', label: 'نوع کالا', type: 'select', options: S(['raw', 'ماده اولیه', 'info'], ['finished', 'کالای ساخته‌شده', 'ok'], ['other', 'سایر', 'mute']), default: 'other', list: true, filter: true },
      { k: 'unit', label: 'واحد', type: 'text', default: 'عدد', list: true },
      { k: 'cost', label: 'قیمت تمام‌شده (میانگین)', type: 'money', min: 0 },
      { k: 'price', label: 'قیمت فروش', type: 'money', min: 0, list: true },
      { k: 'min_stock', label: 'حداقل موجودی', type: 'number', min: 0, default: 0 },
      { k: 'status', label: 'وضعیت', type: 'select', options: ACTIVE, default: 'active' },
    ],
  },
  warehouses: {
    module: 'inventory', title: 'انبارها', singular: 'انبار', label: ['name'],
    fields: [
      { k: 'name', label: 'نام انبار', type: 'text', required: true, unique: true, list: true },
      { k: 'location', label: 'موقعیت', type: 'text', list: true },
    ],
  },
  stock_moves: {
    module: 'inventory', title: 'ورود و خروج انبار', singular: 'تراکنش انبار', label: ['id'], noEdit: true, sortDefault: 'date', search: ['reference', 'note', 'source'],
    fields: [
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'kind', label: 'نوع', type: 'select', required: true, options: S(['in', 'ورود', 'ok'], ['out', 'خروج', 'warn']), list: true, filter: true },
      { k: 'item_id', label: 'کالا', type: 'ref', ref: 'items', required: true, list: true },
      { k: 'warehouse_id', label: 'انبار', type: 'ref', ref: 'warehouses', required: true, list: true },
      { k: 'qty', label: 'تعداد', type: 'number', required: true, min: 0.0001, list: true },
      { k: 'reference', label: 'مرجع', type: 'text', list: true },
      { k: 'note', label: 'توضیحات', type: 'text' },
      { k: 'source', label: 'منبع سیستمی', type: 'text', readonly: true },
    ],
    async validate(ctx, rec) {
      if (rec.kind === 'out' && await stockOf(ctx.db, ctx.companyId, rec.item_id, rec.warehouse_id) < rec.qty)
        throw new HttpError(409, 'موجودی انبار برای این خروج کافی نیست');
    },
    async canDelete(rec) { if (rec.source) throw new HttpError(409, 'تراکنش سیستمی (ناشی از سفارش) قابل حذف نیست'); },
  },

  // ───────────── خرید ─────────────
  suppliers: {
    module: 'purchasing', title: 'تأمین‌کنندگان', singular: 'تأمین‌کننده', label: ['name'], search: ['name', 'contact', 'phone'],
    fields: [
      { k: 'name', label: 'نام', type: 'text', required: true, unique: true, list: true },
      { k: 'contact', label: 'نماینده', type: 'text', list: true },
      { k: 'phone', label: 'تلفن', type: 'text', list: true },
      { k: 'email', label: 'ایمیل', type: 'text' },
      { k: 'address', label: 'نشانی', type: 'textarea' },
      { k: 'status', label: 'وضعیت', type: 'select', options: ACTIVE, default: 'active', list: true },
    ],
  },
  purchase_orders: {
    module: 'purchasing', title: 'سفارش‌های خرید', singular: 'سفارش خرید', label: ['number'], numbering: 'PO', sortDefault: 'id',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'supplier_id', label: 'تأمین‌کننده', type: 'ref', ref: 'suppliers', required: true, list: true },
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'warehouse_id', label: 'انبار تحویل', type: 'ref', ref: 'warehouses', list: false },
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['approved', 'تأیید شده', 'info'], ['received', 'دریافت شده', 'ok'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'lines', label: 'اقلام', type: 'lines', cols: ITEM_LINE_COLS(true) },
      { k: 'tax_percent', label: 'مالیات (٪)', type: 'number', default: 0, min: 0 },
      { k: 'subtotal', label: 'جمع جزء', type: 'money', readonly: true },
      { k: 'total', label: 'مبلغ کل', type: 'money', readonly: true, list: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    ...orderRules('سفارش'),
    actions: [
      { key: 'approve', label: 'تأیید', from: ['draft'], to: 'approved', style: 'ok' },
      {
        key: 'receive', label: 'دریافت کالا به انبار', from: ['approved'], to: 'received', style: 'ok', confirm: 'کالاها به انبار وارد شوند؟',
        async run(ctx, rec) {
          if (!rec.warehouse_id) throw bad('ابتدا «انبار تحویل» را در سفارش مشخص کنید');
          const byAcc = {};
          for (const l of rec.lines) {
            await applyAvgCost(ctx, l.item_id, l.qty, l.price); // قبل از ورود به انبار
            await insertMove(ctx, { kind: 'in', item_id: l.item_id, warehouse_id: rec.warehouse_id, qty: l.qty, ref: rec.number, note: 'دریافت سفارش خرید', source: rec.number });
            const k = invKey((await itemInfo(ctx, l.item_id)).kind); byAcc[k] = (byAcc[k] || 0) + l.qty * l.price;
          }
          await ACC.autoPost(ctx, {
            date: new Date().toISOString().slice(0, 10), description: `دریافت سفارش خرید ${rec.number}`, source: 'purchase_orders', source_ref: rec.id,
            lines: [...(await Promise.all(Object.entries(byAcc).map(async ([k, v]) => ({ account_id: await ACC.acct(ctx, k), debit: Math.round(v) })))),
              { account_id: await ACC.acct(ctx, 'vat_in'), debit: rec.total - rec.subtotal }, { account_id: await ACC.acct(ctx, 'ap'), credit: rec.total, supplier_id: rec.supplier_id }],
          });
        },
      },
      { key: 'cancel', label: 'لغو', from: ['draft', 'approved'], to: 'cancelled', style: 'bad', confirm: 'سفارش لغو شود؟' },
    ],
  },

  // ───────────── فروش ─────────────
  customers: {
    module: 'sales', title: 'مشتریان', singular: 'مشتری', label: ['name'], search: ['name', 'contact', 'phone'],
    fields: [
      { k: 'name', label: 'نام', type: 'text', required: true, unique: true, list: true },
      { k: 'contact', label: 'نماینده', type: 'text', list: true },
      { k: 'phone', label: 'تلفن', type: 'text', list: true },
      { k: 'email', label: 'ایمیل', type: 'text' },
      { k: 'credit_limit', label: 'سقف اعتبار (۰ = نامحدود)', type: 'money', min: 0, default: 0, list: true },
      { k: 'address', label: 'نشانی', type: 'textarea' },
      { k: 'status', label: 'وضعیت', type: 'select', options: ACTIVE, default: 'active', list: true },
    ],
  },
  sales_orders: {
    module: 'sales', title: 'سفارش‌ها و فاکتورهای فروش', singular: 'سفارش فروش', label: ['number'], numbering: 'SO', sortDefault: 'id',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customers', required: true, list: true },
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'warehouse_id', label: 'انبار ارسال', type: 'ref', ref: 'warehouses' },
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['confirmed', 'تأیید شده', 'info'], ['shipped', 'ارسال و فاکتور شده', 'ok'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'lines', label: 'اقلام', type: 'lines', cols: ITEM_LINE_COLS(true) },
      { k: 'tax_percent', label: 'مالیات (٪)', type: 'number', default: 0, min: 0 },
      { k: 'subtotal', label: 'جمع جزء', type: 'money', readonly: true },
      { k: 'total', label: 'مبلغ کل', type: 'money', readonly: true, list: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    ...orderRules('سفارش'),
    actions: [
      {
        key: 'confirm', label: 'تأیید سفارش', from: ['draft'], to: 'confirmed', style: 'ok',
        async run(ctx, rec) {
          const cu = (await ctx.db.get('SELECT credit_limit FROM e_customers WHERE id=? AND company_id=?', rec.customer_id, ctx.companyId));
          if (cu?.credit_limit > 0) {
            const bal = await customerBalance(ctx.db, ctx.companyId, rec.customer_id);
            if (bal + rec.total > cu.credit_limit) throw new HttpError(409, `سقف اعتبار مشتری رد می‌شود (مانده فعلی ${bal.toLocaleString('fa-IR')} + این سفارش ${rec.total.toLocaleString('fa-IR')})`);
          }
        },
      },
      {
        key: 'ship', label: 'ارسال و صدور فاکتور', from: ['confirmed'], to: 'shipped', style: 'ok', confirm: 'کالا از انبار خارج و فاکتور صادر شود؟',
        async run(ctx, rec) {
          if (!rec.warehouse_id) throw bad('ابتدا «انبار ارسال» را در سفارش مشخص کنید');
          const need = new Map();
          for (const l of rec.lines) need.set(l.item_id, (need.get(l.item_id) || 0) + l.qty);
          for (const [id, q] of need) {
            const have = await stockOf(ctx.db, ctx.companyId, id, rec.warehouse_id);
            if (have < q) {
              const it = (await ctx.db.get('SELECT code,name FROM e_items WHERE id=?', id));
              throw new HttpError(409, `موجودی «${it.name}» کافی نیست (موجودی ${have}، نیاز ${q})`);
            }
          }
          const cogs = {}; let cogsTotal = 0;
          for (const l of rec.lines) {
            const it = await itemInfo(ctx, l.item_id), v = l.qty * (it.cost || 0);
            await insertMove(ctx, { kind: 'out', item_id: l.item_id, warehouse_id: rec.warehouse_id, qty: l.qty, ref: rec.number, note: 'ارسال سفارش فروش', source: rec.number });
            const k = invKey(it.kind); cogs[k] = (cogs[k] || 0) + v; cogsTotal += v;
          }
          await ACC.autoPost(ctx, {
            date: rec.date, description: `فاکتور فروش ${rec.number}`, source: 'sales_orders', source_ref: rec.id,
            lines: [{ account_id: await ACC.acct(ctx, 'ar'), debit: rec.total, customer_id: rec.customer_id }, { account_id: await ACC.acct(ctx, 'sales'), credit: rec.subtotal }, { account_id: await ACC.acct(ctx, 'vat_out'), credit: rec.total - rec.subtotal },
              { account_id: await ACC.acct(ctx, 'cogs'), debit: Math.round(cogsTotal) }, ...(await Promise.all(Object.entries(cogs).map(async ([k, v]) => ({ account_id: await ACC.acct(ctx, k), credit: Math.round(v) }))))],
          });
        },
      },
      { key: 'cancel', label: 'لغو', from: ['draft', 'confirmed'], to: 'cancelled', style: 'bad', confirm: 'سفارش لغو شود؟' },
    ],
  },

  // ───────────── مالی ─────────────
  payments: {
    module: 'finance', title: 'دریافت و پرداخت', singular: 'سند دریافت/پرداخت', label: ['number'], numbering: 'PAY', sortDefault: 'date',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'kind', label: 'نوع', type: 'select', required: true, list: true, filter: true, options: S(['receipt', 'دریافت از مشتری', 'ok'], ['payment', 'پرداخت به تأمین‌کننده', 'warn']) },
      { k: 'customer_id', label: 'مشتری', type: 'ref', ref: 'customers', list: true },
      { k: 'supplier_id', label: 'تأمین‌کننده', type: 'ref', ref: 'suppliers', list: true },
      { k: 'amount', label: 'مبلغ', type: 'money', required: true, min: 1, list: true },
      { k: 'method', label: 'روش', type: 'select', options: S(['cash', 'نقد'], ['bank', 'حواله بانکی'], ['cheque', 'چک'], ['card', 'کارت']), default: 'bank', list: true },
      { k: 'reference', label: 'شماره مرجع/چک', type: 'text' },
      { k: 'note', label: 'توضیحات', type: 'textarea' },
    ],
    async validate(ctx, rec) {
      if (rec.kind === 'receipt') { if (!rec.customer_id) throw bad('برای دریافت، مشتری الزامی است'); rec.supplier_id = null; }
      if (rec.kind === 'payment') { if (!rec.supplier_id) throw bad('برای پرداخت، تأمین‌کننده الزامی است'); rec.customer_id = null; }
    },
    async afterSave(ctx, rec, old) {
      if (old) await ACC.reverseBySource(ctx, 'payments', rec.id);
      const cash = await ACC.accountingOn(ctx) ? await ACC.acct(ctx, rec.method === 'cash' ? 'cash' : 'bank') : null;
      if (!cash) return;
      const recv = rec.kind === 'receipt';
      await ACC.autoPost(ctx, { date: rec.date, description: `${recv ? 'دریافت' : 'پرداخت'} ${rec.number}`, source: 'payments', source_ref: rec.id,
        lines: recv ? [{ account_id: cash, debit: rec.amount }, { account_id: await ACC.acct(ctx, 'ar'), credit: rec.amount, customer_id: rec.customer_id }]
          : [{ account_id: await ACC.acct(ctx, 'ap'), debit: rec.amount, supplier_id: rec.supplier_id }, { account_id: cash, credit: rec.amount }] });
    },
    async afterDelete(ctx, rec) { await ACC.reverseBySource(ctx, 'payments', rec.id); },
  },
  expenses: {
    module: 'finance', title: 'هزینه‌ها', singular: 'هزینه', label: ['description'], sortDefault: 'date', search: ['description', 'paid_to'],
    fields: [
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'category', label: 'دسته', type: 'select', required: true, list: true, filter: true, options: S(['salary', 'حقوق و دستمزد'], ['rent', 'اجاره'], ['utilities', 'آب/برق/گاز/اینترنت'], ['transport', 'حمل و نقل'], ['marketing', 'تبلیغات'], ['supplies', 'ملزومات'], ['maintenance', 'تعمیر و نگهداری'], ['other', 'سایر']) },
      { k: 'description', label: 'شرح', type: 'text', required: true, list: true },
      { k: 'amount', label: 'مبلغ', type: 'money', required: true, min: 1, list: true },
      { k: 'paid_to', label: 'پرداخت به', type: 'text', list: true },
      { k: 'method', label: 'روش پرداخت', type: 'select', options: S(['cash', 'نقد'], ['bank', 'بانک']), default: 'bank' },
      { k: 'project_id', label: 'پروژه', type: 'ref', ref: 'projects' },
    ],
    async afterSave(ctx, rec, old) {
      if (old) await ACC.reverseBySource(ctx, 'expenses', rec.id);
      if (!await ACC.accountingOn(ctx)) return;
      await ACC.autoPost(ctx, { date: rec.date, description: `هزینه: ${rec.description}`, source: 'expenses', source_ref: rec.id,
        lines: [{ account_id: await ACC.acct(ctx, 'exp_' + rec.category), debit: rec.amount }, { account_id: await ACC.acct(ctx, rec.method === 'cash' ? 'cash' : 'bank'), credit: rec.amount }] });
    },
    async afterDelete(ctx, rec) { await ACC.reverseBySource(ctx, 'expenses', rec.id); },
  },

  // ───────────── پروژه‌ها ─────────────
  projects: {
    module: 'projects', title: 'پروژه‌ها', singular: 'پروژه', label: ['number', 'name'], numbering: 'PRJ', search: ['number', 'name'],
    fields: [
      { k: 'number', label: 'کد پروژه', type: 'text', readonly: true, list: true },
      { k: 'name', label: 'نام پروژه', type: 'text', required: true, list: true },
      { k: 'customer_id', label: 'کارفرما/مشتری', type: 'ref', ref: 'customers', list: true },
      { k: 'manager_id', label: 'مدیر پروژه', type: 'ref', ref: 'employees', list: true },
      dateField('start_date', 'شروع'),
      dateField('end_date', 'پایان برنامه‌ای', { list: true }),
      { k: 'budget', label: 'بودجه', type: 'money', min: 0 },
      { k: 'status', label: 'وضعیت', type: 'select', default: 'planning', list: true, filter: true, options: S(['planning', 'برنامه‌ریزی', 'info'], ['active', 'در حال اجرا', 'ok'], ['hold', 'متوقف', 'warn'], ['done', 'پایان‌یافته', 'mute'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'progress', label: 'پیشرفت (٪)', type: 'number', readonly: true, default: 0, list: true, display: 'progress' },
      { k: 'description', label: 'توضیحات', type: 'textarea' },
    ],
    async validate(ctx, rec) { if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) throw bad('تاریخ پایان قبل از شروع است'); },
  },
  tasks: {
    module: 'projects', title: 'وظایف (WBS)', singular: 'وظیفه', label: ['title'], search: ['title'], sortDefault: 'due_date',
    fields: [
      { k: 'project_id', label: 'پروژه', type: 'ref', ref: 'projects', required: true, list: true, filter: true },
      { k: 'title', label: 'عنوان', type: 'text', required: true, list: true },
      { k: 'assignee_id', label: 'مسئول', type: 'ref', ref: 'employees', list: true },
      dateField('start_date', 'شروع'),
      dateField('due_date', 'سررسید', { list: true }),
      { k: 'priority', label: 'اولویت', type: 'select', default: 'normal', list: true, options: S(['low', 'کم', 'mute'], ['normal', 'عادی', 'info'], ['high', 'زیاد', 'warn'], ['urgent', 'فوری', 'bad']) },
      { k: 'status', label: 'وضعیت', type: 'select', default: 'todo', list: true, filter: true, options: S(['todo', 'انجام نشده', 'mute'], ['doing', 'در حال انجام', 'info'], ['review', 'در بازبینی', 'warn'], ['done', 'انجام شد', 'ok']) },
      { k: 'progress', label: 'پیشرفت (٪)', type: 'number', min: 0, max: 100, default: 0, list: true, display: 'progress' },
    ],
    async validate(ctx, rec) {
      if (rec.status === 'done') rec.progress = 100;
      if (rec.start_date && rec.due_date && rec.due_date < rec.start_date) throw bad('سررسید قبل از شروع است');
    },
    async afterSave(ctx, rec, old) {
      for (const pid of new Set([rec.project_id, old?.project_id].filter(Boolean))) await recalcProject(ctx, pid);
    },
    async afterDelete(ctx, rec) { await recalcProject(ctx, rec.project_id); },
  },

  // ───────────── کیفیت ─────────────
  ncr: {
    module: 'quality', title: 'عدم انطباق‌ها (NCR)', singular: 'عدم انطباق', label: ['number', 'title'], numbering: 'NCR', search: ['number', 'title', 'description'],
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'title', label: 'عنوان', type: 'text', required: true, list: true },
      { k: 'project_id', label: 'پروژه', type: 'ref', ref: 'projects' },
      { k: 'severity', label: 'شدت', type: 'select', required: true, default: 'minor', list: true, filter: true, options: S(['minor', 'جزئی', 'info'], ['major', 'عمده', 'warn'], ['critical', 'بحرانی', 'bad']) },
      { k: 'source', label: 'منبع کشف', type: 'select', options: S(['inspection', 'بازرسی'], ['audit', 'ممیزی'], ['customer', 'شکایت مشتری'], ['production', 'تولید'], ['other', 'سایر']) },
      dateField('found_date', 'تاریخ کشف', { default: '$today' }),
      { k: 'description', label: 'شرح عدم انطباق', type: 'textarea' },
      { k: 'root_cause', label: 'ریشه‌یابی (علت اصلی)', type: 'textarea' },
      { k: 'corrective_action', label: 'اقدام اصلاحی/پیشگیرانه (CAPA)', type: 'textarea' },
      { k: 'owner_id', label: 'مسئول پیگیری', type: 'ref', ref: 'employees', list: true },
      dateField('due_date', 'مهلت اقدام', { list: true }),
      { k: 'status', label: 'وضعیت', type: 'select', default: 'open', list: true, filter: true, options: S(['open', 'باز', 'bad'], ['analysis', 'در حال ریشه‌یابی', 'warn'], ['action', 'در حال اقدام', 'info'], ['verify', 'در انتظار تأیید اثربخشی', 'warn'], ['closed', 'بسته شده', 'ok']) },
    ],
    async validate(ctx, rec) {
      if (rec.status === 'closed' && (!rec.root_cause || !rec.corrective_action)) throw bad('برای بستن NCR، ریشه‌یابی و اقدام اصلاحی الزامی است');
    },
  },
  documents: {
    module: 'quality', title: 'فهرست مدارک (DCC)', singular: 'مدرک', label: ['code', 'title'], search: ['code', 'title', 'owner'],
    fields: [
      { k: 'code', label: 'کد مدرک', type: 'text', required: true, unique: true, list: true },
      { k: 'title', label: 'عنوان', type: 'text', required: true, list: true },
      { k: 'doc_type', label: 'نوع', type: 'select', list: true, filter: true, options: S(['procedure', 'رویه'], ['instruction', 'دستورالعمل'], ['form', 'فرم'], ['record', 'سابقه'], ['drawing', 'نقشه'], ['policy', 'سیاست‌نامه']) },
      { k: 'revision', label: 'ویرایش', type: 'text', default: '00', list: true },
      { k: 'owner', label: 'مالک مدرک', type: 'text', list: true },
      dateField('effective_date', 'تاریخ اجرا'),
      { k: 'status', label: 'وضعیت', type: 'select', default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['review', 'در بازنگری', 'warn'], ['approved', 'ابلاغ شده', 'ok'], ['obsolete', 'منسوخ', 'bad']) },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
  },

  // ───────────── حسابداری ─────────────
  accounts: {
    module: 'accounting', title: 'سرفصل حساب‌ها', singular: 'حساب', label: ['code', 'name'], search: ['code', 'name'], sortDefault: 'code',
    fields: [
      { k: 'code', label: 'کد حساب', type: 'text', required: true, unique: true, list: true },
      { k: 'name', label: 'نام حساب', type: 'text', required: true, list: true },
      { k: 'type', label: 'ماهیت', type: 'select', required: true, list: true, filter: true, options: S(['asset', 'دارایی', 'info'], ['liability', 'بدهی', 'warn'], ['equity', 'حقوق صاحبان سرمایه', 'mute'], ['revenue', 'درآمد', 'ok'], ['expense', 'هزینه', 'bad']) },
      { k: 'sys_key', label: 'کلید سیستمی', type: 'text', readonly: true },
      { k: 'active', label: 'فعال', type: 'bool', default: 1, list: true },
    ],
    async validate(ctx, rec, old) {
      if (old && old.type !== rec.type && await ACC.hasGl(ctx, old.id)) throw bad('ماهیت حساب دارای گردش قابل تغییر نیست');
    },
    async canDelete(rec, ctx) {
      if (rec.sys_key) throw new HttpError(409, 'حساب سیستمی (مورد استفاده‌ی ثبت خودکار) قابل حذف نیست؛ می‌توانید آن را غیرفعال کنید');
      if (await ACC.hasGl(ctx, rec.id)) throw new HttpError(409, 'حساب دارای گردش است و قابل حذف نیست');
    },
  },
  journal_entries: {
    module: 'accounting', title: 'اسناد حسابداری', singular: 'سند حسابداری', label: ['number'], numbering: 'JV', sortDefault: 'id', search: ['number', 'description', 'source_ref'],
    fields: [
      { k: 'number', label: 'شماره سند', type: 'text', readonly: true, list: true },
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'description', label: 'شرح', type: 'text', required: true, list: true },
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['posted', 'قطعی', 'ok'], ['reversed', 'برگشت‌خورده', 'bad']) },
      { k: 'source', label: 'منشأ', type: 'select', readonly: true, default: 'manual', list: true, options: S(['manual', 'دستی'], ['sales_orders', 'فروش'], ['purchase_orders', 'خرید'], ['payments', 'دریافت/پرداخت'], ['expenses', 'هزینه'], ['work_orders', 'تولید'], ['maintenance_orders', 'نگهداری'], ['closing', 'بستن سال'], ['reversal', 'برگشت']) },
      { k: 'source_ref', label: 'ارجاع منشأ', type: 'text', readonly: true },
      { k: 'lines', label: 'ردیف‌های سند', type: 'lines', cols: [{ k: 'account_id', label: 'حساب', type: 'ref', ref: 'accounts' }, { k: 'debit', label: 'بدهکار', type: 'number' }, { k: 'credit', label: 'بستانکار', type: 'number' }, { k: 'customer_id', label: 'مشتری (تفصیلی)', type: 'ref', ref: 'customers' }, { k: 'supplier_id', label: 'تأمین‌کننده (تفصیلی)', type: 'ref', ref: 'suppliers' }, { k: 'memo', label: 'شرح', type: 'text' }] },
      { k: 'total', label: 'مبلغ سند', type: 'money', readonly: true, list: true },
    ],
    editWhen: ['draft'],
    async validate(ctx, rec, old) {
      if (old && old.status !== 'draft') throw new HttpError(409, 'فقط سند پیش‌نویس قابل ویرایش است');
      const r = await ACC.cleanLines(ctx, rec.lines, { manual: true });
      rec.lines = r.lines; rec.total = r.total;
    },
    async canDelete(rec) { if (rec.status !== 'draft') throw new HttpError(409, 'سند قطعی قابل حذف نیست؛ از «برگشت سند» استفاده کنید'); },
    actions: [
      { key: 'post', label: 'قطعی‌کردن', from: ['draft'], to: 'posted', style: 'ok', confirm: 'سند قطعی شود؟ پس از آن قابل ویرایش نخواهد بود.', run: (ctx, rec) => ACC.postDraft(ctx, rec) },
      {
        key: 'reverse', label: 'برگشت سند', from: ['posted'], to: 'reversed', style: 'bad', confirm: 'یک سند برگشتی ثبت و این سند برگشت‌خورده می‌شود. ادامه؟',
        async run(ctx, rec) {
          if (!['manual', 'closing'].includes(rec.source)) throw new HttpError(409, 'سند خودکار را از طریق سند مبدأ (فروش/خرید/دریافت/…) اصلاح کنید');
          await ACC.reverseEntry(ctx, rec);
        },
      },
    ],
  },

  // ───────────── تولید ─────────────
  boms: {
    module: 'production', title: 'فرمول ساخت (BOM)', singular: 'BOM', label: ['number', 'name'], numbering: 'BOM', search: ['number', 'name'],
    fields: [
      { k: 'number', label: 'کد', type: 'text', readonly: true, list: true },
      { k: 'name', label: 'عنوان', type: 'text', required: true, list: true },
      { k: 'product_id', label: 'محصول نهایی', type: 'ref', ref: 'items', required: true, list: true },
      { k: 'version', label: 'نسخه', type: 'text', default: '1', list: true },
      { k: 'output_qty', label: 'تعداد محصول در هر بچ', type: 'number', required: true, min: 0.0001, default: 1, list: true },
      { k: 'conversion_cost', label: 'دستمزد و سربار ثابت هر بچ', type: 'money', min: 0, default: 0, list: true },
      { k: 'work_center_id', label: 'مرکز کار', type: 'ref', ref: 'work_centers' },
      { k: 'hours_per_batch', label: 'ساعت کار هر بچ', type: 'number', min: 0, default: 0 },
      { k: 'scrap_pct', label: 'ضایعات برنامه‌ای (٪) برای MRP', type: 'number', min: 0, max: 100, default: 0 },
      { k: 'status', label: 'وضعیت', type: 'select', options: ACTIVE, default: 'active', list: true, filter: true },
      { k: 'lines', label: 'مواد مصرفی هر بچ', type: 'lines', cols: ITEM_LINE_COLS(false) },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    async validate(ctx, rec) {
      const lines = Array.isArray(rec.lines) ? rec.lines : [];
      if (!lines.length) throw bad('حداقل یک ماده‌ی مصرفی لازم است');
      const out = [];
      for (const [i, l] of lines.entries()) {
        const it = await itemInfo(ctx, Number(l.item_id));
        if (!it) throw bad(`ردیف ${i + 1}: کالا نامعتبر است`);
        if (it.id === rec.product_id) throw bad('محصول نهایی نمی‌تواند جزو مواد مصرفی خودش باشد');
        if (!(Number(l.qty) > 0)) throw bad(`ردیف ${i + 1}: مقدار باید مثبت باشد`);
        out.push({ item_id: it.id, qty: Number(l.qty) });
      }
      rec.lines = out;
    },
  },
  work_orders: {
    module: 'production', title: 'دستورهای تولید', singular: 'دستور تولید', label: ['number'], numbering: 'WO', sortDefault: 'id',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'bom_id', label: 'BOM', type: 'ref', ref: 'boms', required: true, list: true },
      { k: 'qty', label: 'تعداد برنامه‌ای', type: 'number', required: true, min: 0.0001, list: true },
      { k: 'warehouse_id', label: 'انبار (مصرف و تحویل)', type: 'ref', ref: 'warehouses', required: true },
      dateField('start_date', 'شروع'), dateField('due_date', 'سررسید', { list: true }),
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['released', 'آزاد شده', 'info'], ['completed', 'تکمیل شده', 'ok'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'actual_qty', label: 'تعداد سالم تولیدشده (خالی = برنامه‌ای)', type: 'number', min: 0.0001 },
      { k: 'scrap_qty', label: 'تعداد ضایعات', type: 'number', min: 0, default: 0 },
      { k: 'run_hours', label: 'ساعت کار واقعی (خالی = برنامه‌ای)', type: 'number', min: 0 },
      { k: 'planned_hours', label: 'ساعت کار برنامه‌ای', type: 'number', readonly: true },
      { k: 'yield_pct', label: 'بازده (٪)', type: 'number', readonly: true, list: true },
      { k: 'scrap_cost', label: 'هزینه‌ی ضایعات', type: 'money', readonly: true },
      { k: 'material_cost', label: 'هزینه مواد', type: 'money', readonly: true },
      { k: 'conversion_cost', label: 'دستمزد و سربار', type: 'money', readonly: true },
      { k: 'unit_cost', label: 'بهای تمام‌شده واحد', type: 'money', readonly: true, list: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    editWhen: ['draft', 'released'],
    async validate(ctx, rec, old) {
      if (old && !['draft', 'released'].includes(old.status)) throw new HttpError(409, 'دستور تکمیل/لغوشده قابل ویرایش نیست');
      const b = (await ctx.db.get('SELECT status FROM e_boms WHERE id=? AND company_id=?', rec.bom_id, ctx.companyId));
      if (b?.status !== 'active') throw bad('BOM انتخاب‌شده فعال نیست');
      const bom = (await ctx.db.get('SELECT output_qty, hours_per_batch FROM e_boms WHERE id=?', rec.bom_id));
      rec.planned_hours = plannedHours(bom, rec.qty);
    },
    async canDelete(rec) { if (!['draft', 'cancelled'].includes(rec.status)) throw new HttpError(409, 'فقط پیش‌نویس یا لغوشده قابل حذف است'); },
    actions: [
      { key: 'release', label: 'آزادسازی', from: ['draft'], to: 'released', style: 'ok' },
      { key: 'complete', label: 'تکمیل تولید', from: ['released'], to: 'completed', style: 'ok', confirm: 'مواد از انبار خارج و محصول وارد انبار شود؟', run: (ctx, rec) => completeWorkOrder(ctx, rec) },
      { key: 'cancel', label: 'لغو', from: ['draft', 'released'], to: 'cancelled', style: 'bad', confirm: 'دستور لغو شود؟' },
    ],
  },

  work_centers: {
    module: 'production', title: 'مراکز کار', singular: 'مرکز کار', label: ['name'],
    fields: [
      { k: 'name', label: 'نام مرکز کار', type: 'text', required: true, unique: true, list: true },
      { k: 'capacity_hours_day', label: 'ظرفیت (ساعت در روز)', type: 'number', min: 0, default: 8, list: true },
      { k: 'hourly_rate', label: 'نرخ ساعتی (دستمزد و سربار)', type: 'money', min: 0, default: 0, list: true },
      { k: 'status', label: 'وضعیت', type: 'select', options: ACTIVE, default: 'active', list: true },
    ],
  },
  machines: {
    module: 'production', title: 'ماشین‌آلات و تجهیزات', singular: 'ماشین', label: ['code', 'name'], search: ['code', 'name'],
    fields: [
      { k: 'code', label: 'کد دارایی', type: 'text', required: true, unique: true, list: true },
      { k: 'name', label: 'نام ماشین', type: 'text', required: true, list: true },
      { k: 'work_center_id', label: 'مرکز کار', type: 'ref', ref: 'work_centers', list: true },
      { k: 'status', label: 'وضعیت', type: 'select', default: 'operational', list: true, filter: true, options: S(['operational', 'در سرویس', 'ok'], ['maintenance', 'در حال تعمیر', 'warn'], ['down', 'خراب', 'bad'], ['retired', 'خارج از رده', 'mute']) },
      { k: 'pm_interval_days', label: 'دوره‌ی PM (روز)', type: 'number', min: 1 },
      dateField('last_pm_date', 'آخرین PM'),
      { k: 'next_pm_date', label: 'PM بعدی', type: 'date', readonly: true, list: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    async validate(ctx, rec) { rec.next_pm_date = nextPm(rec); },
  },
  maintenance_orders: {
    module: 'production', title: 'دستورکار نگهداری و تعمیرات', singular: 'دستورکار', label: ['number'], numbering: 'MO', sortDefault: 'id', search: ['number', 'description'],
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'machine_id', label: 'ماشین', type: 'ref', ref: 'machines', required: true, list: true },
      { k: 'kind', label: 'نوع', type: 'select', required: true, default: 'preventive', list: true, filter: true, options: S(['preventive', 'پیشگیرانه (PM)', 'info'], ['corrective', 'اصلاحی (خرابی)', 'bad']) },
      { k: 'description', label: 'شرح کار', type: 'text', required: true, list: true },
      dateField('planned_date', 'تاریخ برنامه', { list: true, default: '$today' }),
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'open', list: true, filter: true, options: S(['open', 'باز', 'warn'], ['in_progress', 'در حال انجام', 'info'], ['done', 'انجام شده', 'ok'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'downtime_hours', label: 'ساعت توقف', type: 'number', min: 0, default: 0 },
      { k: 'cost', label: 'هزینه (قطعات و خدمات)', type: 'money', min: 0, default: 0 },
      { k: 'completed_date', label: 'تاریخ انجام', type: 'date', readonly: true },
    ],
    editWhen: ['open', 'in_progress'],
    async validate(ctx, rec, old) { if (old && !['open', 'in_progress'].includes(old.status)) throw new HttpError(409, 'دستورکار پایان‌یافته/لغوشده قابل ویرایش نیست'); },
    async afterSave(ctx, rec, old) {
      if (!old && rec.kind === 'corrective') (await ctx.db.run(`UPDATE e_machines SET status='down' WHERE id=? AND company_id=? AND status!='retired'`, rec.machine_id, ctx.companyId));
    },
    async canDelete(rec) { if (rec.status === 'done') throw new HttpError(409, 'دستورکار انجام‌شده قابل حذف نیست'); },
    actions: [
      { key: 'start', label: 'شروع کار', from: ['open'], to: 'in_progress', style: 'ok' },
      { key: 'complete', label: 'پایان کار', from: ['open', 'in_progress'], to: 'done', style: 'ok', confirm: 'دستورکار پایان یابد؟ (تاریخ PM ماشین و هزینه در حسابداری ثبت می‌شود)', run: (ctx, rec) => completeMaintenance(ctx, rec) },
      { key: 'cancel', label: 'لغو', from: ['open', 'in_progress'], to: 'cancelled', style: 'bad', confirm: 'دستورکار لغو شود؟' },
    ],
  },

  // ───────────── حقوق و دستمزد ─────────────
  payroll_params: {
    module: 'payroll', title: 'پارامترهای حقوق و مالیات', singular: 'پارامترهای حقوق', label: ['id'],
    fields: [
      { k: 'insurance_employee_pct', label: 'سهم بیمه‌ی کارمند (٪)', type: 'number', min: 0, max: 100, default: 7, list: true },
      { k: 'insurance_employer_pct', label: 'سهم بیمه‌ی کارفرما (٪)', type: 'number', min: 0, max: 100, default: 23, list: true },
      { k: 'insurance_ceiling', label: 'سقف ماهانه‌ی مشمول بیمه (۰ = بدون سقف)', type: 'money', min: 0, default: 0, list: true },
      { k: 'overtime_multiplier', label: 'ضریب اضافه‌کاری', type: 'number', min: 1, default: 1.4, list: true },
      { k: 'daily_hours', label: 'ساعت کار روزانه', type: 'number', min: 1, max: 24, default: 7.33 },
      { k: 'brackets', label: 'پله‌های مالیات ماهانه (از مبلغ / نرخ ٪)', type: 'lines', cols: [{ k: 'from', label: 'از مبلغ (ماهانه)', type: 'number' }, { k: 'rate', label: 'نرخ مالیات (٪)', type: 'number' }] },
    ],
    async validate(ctx, rec, old) {
      if (!old && await ctx.db.get('SELECT 1 FROM e_payroll_params WHERE company_id=?', ctx.companyId)) throw new HttpError(409, 'پارامترها قبلاً تعریف شده؛ همان را ویرایش کنید');
      const b = (Array.isArray(rec.brackets) ? rec.brackets : []).map((x) => ({ from: Number(x.from), rate: Number(x.rate) })).sort((p, q) => p.from - q.from);
      for (const x of b) if (!(x.from >= 0) || !(x.rate >= 0 && x.rate <= 100)) throw bad('پله‌ی مالیاتی نامعتبر است (مبلغ ≥ ۰ و نرخ بین ۰ تا ۱۰۰)');
      if (b.length && b[0].from !== 0) throw bad('پله‌ی اول باید از مبلغ ۰ شروع شود (مثلاً نرخ ۰٪ برای بخش معاف)');
      if (new Set(b.map((x) => x.from)).size !== b.length) throw bad('مبلغ شروع پله‌ها تکراری است');
      rec.brackets = b;
    },
  },
  payroll_runs: {
    module: 'payroll', title: 'دوره‌های حقوق', singular: 'دوره‌ی حقوق', label: ['number'], numbering: 'PR', sortDefault: 'id',
    fields: [
      { k: 'number', label: 'شماره', type: 'text', readonly: true, list: true },
      { k: 'year', label: 'سال شمسی', type: 'number', required: true, min: 1380, max: 1500, list: true },
      { k: 'month', label: 'ماه (۱ تا ۱۲)', type: 'number', required: true, min: 1, max: 12, list: true },
      { k: 'start_date', label: 'شروع', type: 'date', readonly: true },
      { k: 'end_date', label: 'پایان', type: 'date', readonly: true },
      { k: 'days', label: 'روزهای ماه', type: 'number', readonly: true },
      { k: 'status', label: 'وضعیت', type: 'select', readonly: true, default: 'draft', list: true, filter: true, options: S(['draft', 'پیش‌نویس', 'mute'], ['approved', 'تأیید و ثبت در حسابداری', 'info'], ['paid', 'پرداخت‌شده', 'ok'], ['cancelled', 'لغو شده', 'bad']) },
      { k: 'employees_count', label: 'تعداد فیش', type: 'number', readonly: true, list: true },
      { k: 'total_gross', label: 'جمع ناخالص', type: 'money', readonly: true, list: true },
      { k: 'total_insurance', label: 'جمع بیمه‌ی کارمند', type: 'money', readonly: true },
      { k: 'total_tax', label: 'جمع مالیات', type: 'money', readonly: true },
      { k: 'total_net', label: 'جمع خالص پرداختی', type: 'money', readonly: true, list: true },
      { k: 'employer_cost', label: 'هزینه‌ی کل کارفرما (با سهم بیمه)', type: 'money', readonly: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    editWhen: ['draft'],
    async validate(ctx, rec, old) {
      if (old && old.status !== 'draft') throw new HttpError(409, 'فقط دوره‌ی پیش‌نویس قابل ویرایش است');
      if (!Number.isInteger(rec.year) || !Number.isInteger(rec.month)) throw bad('سال و ماه باید عدد صحیح باشند');
      const r = jalaliMonthRange(rec.year, rec.month);
      rec.start_date = r.start; rec.end_date = r.end; rec.days = r.days;
      if (await ctx.db.get(`SELECT 1 FROM e_payroll_runs WHERE company_id=? AND year=? AND month=? AND status!='cancelled' AND id!=?`, ctx.companyId, rec.year, rec.month, old?.id ?? 0))
        throw new HttpError(409, 'برای این ماه قبلاً دوره‌ی حقوق (غیرلغوشده) ثبت شده است');
      if (old && (old.year !== rec.year || old.month !== rec.month) && (await ctx.db.get('SELECT 1 FROM e_payslips WHERE run_id=? AND company_id=?', old.id, ctx.companyId)))
        throw new HttpError(409, 'پس از ایجاد فیش‌ها، ماه دوره قابل تغییر نیست');
    },
    async canDelete(rec) { if (!['draft', 'cancelled'].includes(rec.status)) throw new HttpError(409, 'فقط دوره‌ی پیش‌نویس یا لغوشده قابل حذف است'); },
    async afterDelete(ctx, rec) { await ctx.db.run('DELETE FROM e_payslips WHERE run_id=? AND company_id=?', rec.id, ctx.companyId); },
    actions: [
      { key: 'generate', label: 'ایجاد/بازمحاسبه‌ی فیش‌ها', from: ['draft'], to: 'draft', style: 'ok', confirm: 'فیش‌ها برای کارکنان شاغل ساخته می‌شود (ورودی‌های دستی قبلی فیش‌ها پاک می‌شود). ادامه؟', run: (ctx, rec) => generatePayslips(ctx, rec) },
      { key: 'approve', label: 'تأیید و ثبت سند', from: ['draft'], to: 'approved', style: 'ok', confirm: 'دوره تأیید و سند حسابداری ثبت شود؟ پس از آن فیش‌ها قابل ویرایش نیست.', run: (ctx, rec) => approveRun(ctx, rec) },
      { key: 'pay', label: 'ثبت پرداخت', from: ['approved'], to: 'paid', style: 'ok', confirm: 'پرداخت خالص حقوق از بانک ثبت شود؟', run: (ctx, rec) => payRun(ctx, rec) },
      { key: 'cancel', label: 'لغو', from: ['draft', 'approved'], to: 'cancelled', style: 'bad', confirm: 'دوره لغو شود؟ (سند حسابداری برگشت می‌خورد)', run: (ctx, rec) => cancelRun(ctx, rec) },
    ],
  },
  payslips: {
    module: 'payroll', title: 'فیش‌های حقوقی', singular: 'فیش حقوقی', label: ['id'], noCreate: true, sortDefault: 'id',
    fields: [
      { k: 'run_id', label: 'دوره', type: 'ref', ref: 'payroll_runs', readonly: true, list: true },
      { k: 'employee_id', label: 'کارمند', type: 'ref', ref: 'employees', readonly: true, list: true },
      { k: 'days', label: 'روزهای ماه', type: 'number', readonly: true },
      { k: 'unpaid_days', label: 'روز مرخصی بدون حقوق', type: 'number', readonly: true },
      { k: 'base_pay', label: 'حقوق پایه (متناسب)', type: 'money', readonly: true },
      { k: 'allowances', label: 'مزایا (مسکن/خواروبار/اولاد)', type: 'money', readonly: true },
      { k: 'overtime_hours', label: 'ساعت اضافه‌کاری', type: 'number', min: 0, default: 0 },
      { k: 'overtime_pay', label: 'اضافه‌کاری', type: 'money', readonly: true },
      { k: 'bonus', label: 'پاداش', type: 'money', min: 0, default: 0 },
      { k: 'gross', label: 'ناخالص', type: 'money', readonly: true, list: true },
      { k: 'insurable', label: 'مشمول بیمه', type: 'money', readonly: true },
      { k: 'ins_employee', label: 'بیمه‌ی کارمند', type: 'money', readonly: true, list: true },
      { k: 'ins_employer', label: 'بیمه‌ی کارفرما', type: 'money', readonly: true },
      { k: 'taxable_income', label: 'مشمول مالیات', type: 'money', readonly: true },
      { k: 'tax', label: 'مالیات', type: 'money', readonly: true, list: true },
      { k: 'other_deductions', label: 'سایر کسورات (مساعده/وام/جریمه)', type: 'money', min: 0, default: 0 },
      { k: 'net', label: 'خالص پرداختی', type: 'money', readonly: true, list: true },
    ],
    async validate(ctx, rec, old) {
      if (!old) throw new HttpError(405, 'فیش فقط با «ایجاد فیش‌ها» در دوره‌ی حقوق ساخته می‌شود');
      await recalcSlip(ctx, rec);
    },
    async afterSave(ctx, rec) { await updateRunTotals(ctx, rec.run_id); },
    async canDelete(rec, ctx) {
      const run = await ctx.db.get('SELECT status FROM e_payroll_runs WHERE id=? AND company_id=?', rec.run_id, ctx.companyId);
      if (run?.status !== 'draft') throw new HttpError(409, 'فقط فیش دوره‌ی پیش‌نویس قابل حذف است');
    },
    async afterDelete(ctx, rec) { await updateRunTotals(ctx, rec.run_id); },
  },

  // ───────────── مدیریت ─────────────
  users: {
    module: 'admin', title: 'کاربران', singular: 'کاربر', label: ['name'], search: ['username', 'name'],
    fields: [
      { k: 'username', label: 'نام کاربری', type: 'text', required: true, unique: true, list: true, pattern: '^[A-Za-z0-9_.-]{3,32}$', patternMsg: 'نام کاربری: ۳ تا ۳۲ نویسه انگلیسی/عدد' },
      { k: 'name', label: 'نام کامل', type: 'text', required: true, list: true },
      { k: 'role', label: 'نقش', type: 'select', required: true, list: true, filter: true, options: Object.entries({ admin: 'مدیر شرکت', manager: 'مدیر ارشد', accountant: 'حسابدار', production: 'تولید', hr: 'منابع انسانی', inventory: 'انبارداری', purchasing: 'خرید', sales: 'فروش', finance: 'مالی', project: 'کنترل پروژه (PMO)', qa: 'تضمین کیفیت (QA)', viewer: 'مشاهده‌گر' }).map(([v, l]) => ({ v, l, c: 'info' })) },
      { k: 'password', label: 'گذرواژه (خالی = بدون تغییر)', type: 'password' },
      { k: 'active', label: 'فعال', type: 'bool', default: 1, list: true },
    ],
    async validate(ctx, rec, old) {
      if (!old && !rec.password) throw bad('گذرواژه برای کاربر جدید الزامی است');
      if (old && old.id === ctx.user.id && (!rec.active || rec.role !== old.role)) throw bad('نقش یا وضعیت حساب خودتان را نمی‌توانید تغییر دهید');
    },
    async canDelete(rec, ctx) { if (rec.id === ctx.user.id) throw bad('حذف حساب خودتان ممکن نیست'); },
  },
};

export async function customerBalance(db, companyId, customerId) {
  const sales = (await db.get(`SELECT COALESCE(SUM(total),0) s FROM e_sales_orders WHERE company_id=? AND customer_id=? AND status IN ('confirmed','shipped')`, companyId, customerId)).s;
  const paid = (await db.get(`SELECT COALESCE(SUM(amount),0) s FROM e_payments WHERE company_id=? AND customer_id=? AND kind='receipt'`, companyId, customerId)).s;
  return sales - paid;
}

async function recalcProject(ctx, pid) {
  const r = (await ctx.db.get('SELECT AVG(progress) a, COUNT(*) n FROM e_tasks WHERE project_id=? AND company_id=?', pid, ctx.companyId));
  if (r.n) (await ctx.db.run('UPDATE e_projects SET progress=? WHERE id=? AND company_id=?', Math.round(r.a), pid, ctx.companyId));
}

for (const [key, d] of Object.entries(ENTITIES)) d.key = key;

// نسخه‌ی بدون تابع برای ارسال به مرورگر
export function publicMeta(def, hidden = new Set()) {
  return {
    key: def.key, module: def.module, title: def.title, singular: def.singular, noEdit: !!def.noEdit, noCreate: !!def.noCreate, numbered: !!def.numbering,
    editWhen: def.editWhen,
    fields: def.fields.filter((f) => !hidden.has(f.k)).map(({ k, label, type, options, ref, required, readonly, list, filter, display, min, max, cols, default: dv }) => ({ k, label, type, options, ref, required, readonly, list, filter, display, min, max, cols, default: dv })),
    actions: (def.actions || []).map(({ key, label, from, style, confirm }) => ({ key, label, from, style, confirm })),
  };
}
