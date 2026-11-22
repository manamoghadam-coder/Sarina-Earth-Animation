import { HttpError, bad, daysBetween } from './util.js';

export const MODULES = {
  hr: { title: 'منابع انسانی', icon: '👥' },
  inventory: { title: 'انبار و موجودی', icon: '📦' },
  purchasing: { title: 'خرید', icon: '🛒' },
  sales: { title: 'فروش', icon: '💼' },
  finance: { title: 'مالی', icon: '💰' },
  projects: { title: 'پروژه‌ها (PMO)', icon: '📐' },
  quality: { title: 'کیفیت (QA/QMS)', icon: '✅' },
  admin: { title: 'مدیریت سامانه', icon: '⚙️' },
};

// c = رنگ نشانگر وضعیت: ok / warn / bad / info / mute
const S = (...a) => a.map(([v, l, c]) => ({ v, l, c }));
const ACTIVE = S(['active', 'فعال', 'ok'], ['inactive', 'غیرفعال', 'mute']);

export function stockOf(db, companyId, itemId, warehouseId) {
  const q = `SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN qty ELSE -qty END),0) s FROM e_stock_moves WHERE company_id=? AND item_id=?` + (warehouseId ? ' AND warehouse_id=?' : '');
  return db.prepare(q).get(...(warehouseId ? [companyId, itemId, warehouseId] : [companyId, itemId])).s;
}

function prepLines(ctx, rec) {
  const lines = Array.isArray(rec.lines) ? rec.lines : [];
  if (!lines.length) throw bad('حداقل یک ردیف کالا لازم است');
  let sub = 0;
  rec.lines = lines.map((l, i) => {
    const item = ctx.db.prepare('SELECT id FROM e_items WHERE id=? AND company_id=?').get(Number(l.item_id), ctx.companyId);
    if (!item) throw bad(`ردیف ${i + 1}: کالا نامعتبر است`);
    const qty = Number(l.qty), price = Number(l.price);
    if (!(qty > 0)) throw bad(`ردیف ${i + 1}: تعداد باید بزرگ‌تر از صفر باشد`);
    if (!(price >= 0)) throw bad(`ردیف ${i + 1}: قیمت نامعتبر است`);
    sub += qty * price;
    return { item_id: item.id, qty, price };
  });
  const tax = Number(rec.tax_percent || 0);
  if (tax < 0 || tax > 100) throw bad('درصد مالیات نامعتبر است');
  rec.tax_percent = tax;
  rec.subtotal = Math.round(sub);
  rec.total = Math.round(sub * (1 + tax / 100));
}

function moveLines(ctx, rec, kind, label) {
  const st = ctx.db.prepare(`INSERT INTO e_stock_moves (company_id,date,kind,item_id,warehouse_id,qty,reference,note,source,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`);
  for (const l of rec.lines) st.run(ctx.companyId, new Date().toISOString().slice(0, 10), kind, l.item_id, rec.warehouse_id, l.qty, rec.number, label, rec.number, ctx.user.id);
}

const orderRules = (what) => ({
  validate(ctx, rec, old) {
    if (old && old.status !== 'draft') throw new HttpError(409, `فقط ${what} پیش‌نویس قابل ویرایش است`);
    prepLines(ctx, rec);
  },
  canDelete(rec) { if (!['draft', 'cancelled'].includes(rec.status)) throw new HttpError(409, 'فقط پیش‌نویس یا لغوشده قابل حذف است'); },
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
    module: 'hr', title: 'کارکنان', singular: 'کارمند', label: ['number', 'name'], numbering: 'EMP', search: ['number', 'name', 'national_id', 'position'],
    fields: [
      { k: 'number', label: 'کد پرسنلی', type: 'text', readonly: true, list: true },
      { k: 'name', label: 'نام و نام خانوادگی', type: 'text', required: true, list: true },
      { k: 'national_id', label: 'کد ملی', type: 'text', pattern: '^\\d{10}$', patternMsg: 'کد ملی باید ۱۰ رقم باشد' },
      { k: 'department_id', label: 'واحد', type: 'ref', ref: 'departments', list: true },
      { k: 'position', label: 'سمت', type: 'text', list: true },
      dateField('hire_date', 'تاریخ استخدام'),
      { k: 'salary', label: 'حقوق پایه', type: 'money', min: 0 },
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
    validate(ctx, rec, old) {
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
      { k: 'unit', label: 'واحد', type: 'text', default: 'عدد', list: true },
      { k: 'cost', label: 'قیمت تمام‌شده', type: 'money', min: 0 },
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
    validate(ctx, rec) {
      if (rec.kind === 'out' && stockOf(ctx.db, ctx.companyId, rec.item_id, rec.warehouse_id) < rec.qty)
        throw new HttpError(409, 'موجودی انبار برای این خروج کافی نیست');
    },
    canDelete(rec) { if (rec.source) throw new HttpError(409, 'تراکنش سیستمی (ناشی از سفارش) قابل حذف نیست'); },
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
      { k: 'lines', label: 'اقلام', type: 'lines' },
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
        run(ctx, rec) {
          if (!rec.warehouse_id) throw bad('ابتدا «انبار تحویل» را در سفارش مشخص کنید');
          moveLines(ctx, rec, 'in', 'دریافت سفارش خرید');
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
      { k: 'lines', label: 'اقلام', type: 'lines' },
      { k: 'tax_percent', label: 'مالیات (٪)', type: 'number', default: 0, min: 0 },
      { k: 'subtotal', label: 'جمع جزء', type: 'money', readonly: true },
      { k: 'total', label: 'مبلغ کل', type: 'money', readonly: true, list: true },
      { k: 'notes', label: 'توضیحات', type: 'textarea' },
    ],
    ...orderRules('سفارش'),
    actions: [
      {
        key: 'confirm', label: 'تأیید سفارش', from: ['draft'], to: 'confirmed', style: 'ok',
        run(ctx, rec) {
          const cu = ctx.db.prepare('SELECT credit_limit FROM e_customers WHERE id=? AND company_id=?').get(rec.customer_id, ctx.companyId);
          if (cu?.credit_limit > 0) {
            const bal = customerBalance(ctx.db, ctx.companyId, rec.customer_id);
            if (bal + rec.total > cu.credit_limit) throw new HttpError(409, `سقف اعتبار مشتری رد می‌شود (مانده فعلی ${bal.toLocaleString('fa-IR')} + این سفارش ${rec.total.toLocaleString('fa-IR')})`);
          }
        },
      },
      {
        key: 'ship', label: 'ارسال و صدور فاکتور', from: ['confirmed'], to: 'shipped', style: 'ok', confirm: 'کالا از انبار خارج و فاکتور صادر شود؟',
        run(ctx, rec) {
          if (!rec.warehouse_id) throw bad('ابتدا «انبار ارسال» را در سفارش مشخص کنید');
          const need = new Map();
          for (const l of rec.lines) need.set(l.item_id, (need.get(l.item_id) || 0) + l.qty);
          for (const [id, q] of need) {
            const have = stockOf(ctx.db, ctx.companyId, id, rec.warehouse_id);
            if (have < q) {
              const it = ctx.db.prepare('SELECT code,name FROM e_items WHERE id=?').get(id);
              throw new HttpError(409, `موجودی «${it.name}» کافی نیست (موجودی ${have}، نیاز ${q})`);
            }
          }
          moveLines(ctx, rec, 'out', 'ارسال سفارش فروش');
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
    validate(ctx, rec) {
      if (rec.kind === 'receipt') { if (!rec.customer_id) throw bad('برای دریافت، مشتری الزامی است'); rec.supplier_id = null; }
      if (rec.kind === 'payment') { if (!rec.supplier_id) throw bad('برای پرداخت، تأمین‌کننده الزامی است'); rec.customer_id = null; }
    },
  },
  expenses: {
    module: 'finance', title: 'هزینه‌ها', singular: 'هزینه', label: ['description'], sortDefault: 'date', search: ['description', 'paid_to'],
    fields: [
      dateField('date', 'تاریخ', { required: true, list: true, default: '$today' }),
      { k: 'category', label: 'دسته', type: 'select', required: true, list: true, filter: true, options: S(['salary', 'حقوق و دستمزد'], ['rent', 'اجاره'], ['utilities', 'آب/برق/گاز/اینترنت'], ['transport', 'حمل و نقل'], ['marketing', 'تبلیغات'], ['supplies', 'ملزومات'], ['other', 'سایر']) },
      { k: 'description', label: 'شرح', type: 'text', required: true, list: true },
      { k: 'amount', label: 'مبلغ', type: 'money', required: true, min: 1, list: true },
      { k: 'paid_to', label: 'پرداخت به', type: 'text', list: true },
      { k: 'project_id', label: 'پروژه', type: 'ref', ref: 'projects' },
    ],
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
    validate(ctx, rec) { if (rec.start_date && rec.end_date && rec.end_date < rec.start_date) throw bad('تاریخ پایان قبل از شروع است'); },
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
    validate(ctx, rec) {
      if (rec.status === 'done') rec.progress = 100;
      if (rec.start_date && rec.due_date && rec.due_date < rec.start_date) throw bad('سررسید قبل از شروع است');
    },
    afterSave(ctx, rec, old) {
      for (const pid of new Set([rec.project_id, old?.project_id].filter(Boolean))) recalcProject(ctx, pid);
    },
    afterDelete(ctx, rec) { recalcProject(ctx, rec.project_id); },
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
    validate(ctx, rec) {
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

  // ───────────── مدیریت ─────────────
  users: {
    module: 'admin', title: 'کاربران', singular: 'کاربر', label: ['name'], search: ['username', 'name'],
    fields: [
      { k: 'username', label: 'نام کاربری', type: 'text', required: true, unique: true, list: true, pattern: '^[A-Za-z0-9_.-]{3,32}$', patternMsg: 'نام کاربری: ۳ تا ۳۲ نویسه انگلیسی/عدد' },
      { k: 'name', label: 'نام کامل', type: 'text', required: true, list: true },
      { k: 'role', label: 'نقش', type: 'select', required: true, list: true, filter: true, options: Object.entries({ admin: 'مدیر شرکت', manager: 'مدیر ارشد', hr: 'منابع انسانی', inventory: 'انبارداری', purchasing: 'خرید', sales: 'فروش', finance: 'مالی', project: 'کنترل پروژه (PMO)', qa: 'تضمین کیفیت (QA)', viewer: 'مشاهده‌گر' }).map(([v, l]) => ({ v, l, c: 'info' })) },
      { k: 'password', label: 'گذرواژه (خالی = بدون تغییر)', type: 'password' },
      { k: 'active', label: 'فعال', type: 'bool', default: 1, list: true },
    ],
    validate(ctx, rec, old) {
      if (!old && !rec.password) throw bad('گذرواژه برای کاربر جدید الزامی است');
      if (old && old.id === ctx.user.id && (!rec.active || rec.role !== old.role)) throw bad('نقش یا وضعیت حساب خودتان را نمی‌توانید تغییر دهید');
    },
    canDelete(rec, ctx) { if (rec.id === ctx.user.id) throw bad('حذف حساب خودتان ممکن نیست'); },
  },
};

export function customerBalance(db, companyId, customerId) {
  const sales = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM e_sales_orders WHERE company_id=? AND customer_id=? AND status IN ('confirmed','shipped')`).get(companyId, customerId).s;
  const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM e_payments WHERE company_id=? AND customer_id=? AND kind='receipt'`).get(companyId, customerId).s;
  return sales - paid;
}

function recalcProject(ctx, pid) {
  const r = ctx.db.prepare('SELECT AVG(progress) a, COUNT(*) n FROM e_tasks WHERE project_id=? AND company_id=?').get(pid, ctx.companyId);
  if (r.n) ctx.db.prepare('UPDATE e_projects SET progress=? WHERE id=? AND company_id=?').run(Math.round(r.a), pid, ctx.companyId);
}

for (const [key, d] of Object.entries(ENTITIES)) d.key = key;

// نسخه‌ی بدون تابع برای ارسال به مرورگر
export function publicMeta(def) {
  return {
    key: def.key, module: def.module, title: def.title, singular: def.singular, noEdit: !!def.noEdit, numbered: !!def.numbering,
    fields: def.fields.map(({ k, label, type, options, ref, required, readonly, list, filter, display, min, max, default: dv }) => ({ k, label, type, options, ref, required, readonly, list, filter, display, min, max, default: dv })),
    actions: (def.actions || []).map(({ key, label, from, style, confirm }) => ({ key, label, from, style, confirm })),
  };
}
