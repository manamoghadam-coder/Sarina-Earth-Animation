// حسابداری دوطرفه: ثبت سند، دفتر کل، گزارش‌های مالی
import { HttpError, bad, isoDate, today } from './util.js';

// نوع حساب: asset/expense طبیعتاً بدهکار؛ liability/equity/revenue طبیعتاً بستانکار
export const CHART = [
  ['1101', 'صندوق', 'asset', 'cash'], ['1102', 'بانک', 'asset', 'bank'], ['1201', 'حساب‌های دریافتنی تجاری', 'asset', 'ar'],
  ['1301', 'موجودی مواد اولیه و کالا', 'asset', 'inv_raw'], ['1302', 'موجودی کالای در جریان ساخت', 'asset', 'inv_wip'], ['1303', 'موجودی کالای ساخته‌شده', 'asset', 'inv_fg'],
  ['1401', 'مالیات بر ارزش افزوده قابل استرداد', 'asset', 'vat_in'], ['1501', 'دارایی‌های ثابت', 'asset', null], ['1601', 'مساعده و وام کارکنان', 'asset', 'employee_advances'],
  ['2101', 'حساب‌های پرداختنی تجاری', 'liability', 'ap'], ['2201', 'مالیات بر ارزش افزوده پرداختنی', 'liability', 'vat_out'],
  ['2301', 'حقوق و دستمزد پرداختنی', 'liability', 'salary_payable'], ['2302', 'بیمه پرداختنی', 'liability', 'ins_payable'], ['2303', 'مالیات حقوق پرداختنی', 'liability', 'tax_payable'], ['2401', 'وام‌ها و تسهیلات', 'liability', null],
  ['3101', 'سرمایه', 'equity', 'equity'], ['3201', 'سود (زیان) انباشته', 'equity', 'retained'],
  ['4101', 'فروش کالا', 'revenue', 'sales'], ['4201', 'سایر درآمدها', 'revenue', null],
  ['5101', 'بهای تمام‌شده کالای فروش‌رفته', 'expense', 'cogs'], ['5201', 'حقوق و دستمزد', 'expense', 'exp_salary'], ['5202', 'اجاره', 'expense', 'exp_rent'],
  ['5203', 'آب، برق، گاز و اینترنت', 'expense', 'exp_utilities'], ['5204', 'حمل و نقل', 'expense', 'exp_transport'], ['5205', 'تبلیغات و بازاریابی', 'expense', 'exp_marketing'],
  ['5206', 'ملزومات مصرفی', 'expense', 'exp_supplies'], ['5207', 'تعمیر و نگهداری', 'expense', 'exp_maintenance'], ['5208', 'سهم کارفرما از بیمه', 'expense', 'exp_insurance_er'], ['5299', 'سایر هزینه‌ها', 'expense', 'exp_other'], ['5401', 'دستمزد و سربار تولید جذب‌شده', 'expense', 'conv_absorbed'],
];

export async function seedChart(db, companyId) {
  const rows = (await db.all('SELECT code,sys_key FROM e_accounts WHERE company_id=?', companyId));
  const fresh = !rows.length, keys = new Set(rows.map((r) => r.sys_key)), codes = new Set(rows.map((r) => r.code));
  // شرکت جدید: کل سرفصل؛ شرکت موجود: فقط حساب‌های سیستمی که هنوز نیستند (و کلید دادن به حساب هم‌کدِ بدون کلید)
  for (const [code, name, type, key] of CHART) {
    if (!fresh && key && !keys.has(key) && codes.has(code)) { await db.run('UPDATE e_accounts SET sys_key=? WHERE company_id=? AND code=? AND sys_key IS NULL', key, companyId, code); continue; }
    if (fresh || (key && !keys.has(key) && !codes.has(code))) await db.run('INSERT INTO e_accounts (company_id,code,name,type,sys_key,active) VALUES (?,?,?,?,?,1)', companyId, code, name, type, key);
  }
}

export async function accountingOn(ctx) {
  const c = (await ctx.db.get('SELECT modules FROM companies WHERE id=?', ctx.companyId));
  return !!c && JSON.parse(c.modules).includes('accounting');
}

export async function acct(ctx, key) {
  const a = (await ctx.db.get('SELECT id FROM e_accounts WHERE company_id=? AND sys_key=?', ctx.companyId, key));
  if (!a) throw new HttpError(409, `حساب سیستمی «${key}» در سرفصل‌ها یافت نشد`);
  return a.id;
}

const r2 = (x) => Math.round(x * 100) / 100;

export async function cleanLines(ctx, lines, { manual } = {}) {
  if (!Array.isArray(lines)) throw bad('ردیف‌های سند نامعتبر است');
  let d = 0, c = 0;
  const out = [];
  for (const [i, l] of lines.entries()) {
    const a = (await ctx.db.get('SELECT id,active FROM e_accounts WHERE id=? AND company_id=?', Number(l.account_id), ctx.companyId));
    if (!a) throw bad(`ردیف ${i + 1}: حساب نامعتبر است`);
    if (manual && !a.active) throw bad(`ردیف ${i + 1}: حساب غیرفعال است`);
    let party = {};
    if (l.customer_id) { if (!(await ctx.db.get('SELECT 1 FROM e_customers WHERE id=? AND company_id=?', Number(l.customer_id), ctx.companyId))) throw bad(`ردیف ${i + 1}: مشتری نامعتبر است`); party = { customer_id: Number(l.customer_id) }; }
    else if (l.supplier_id) { if (!(await ctx.db.get('SELECT 1 FROM e_suppliers WHERE id=? AND company_id=?', Number(l.supplier_id), ctx.companyId))) throw bad(`ردیف ${i + 1}: تأمین‌کننده نامعتبر است`); party = { supplier_id: Number(l.supplier_id) }; }
    const debit = r2(Number(l.debit) || 0), credit = r2(Number(l.credit) || 0);
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) throw bad(`ردیف ${i + 1}: هر ردیف باید فقط یکی از بدهکار یا بستانکار را (با مبلغ مثبت) داشته باشد`);
    d += debit; c += credit;
    out.push({ account_id: a.id, debit, credit, memo: l.memo ? String(l.memo).slice(0, 200) : null, ...party });
  }
  if (out.length < 2) throw bad('سند حداقل دو ردیف لازم دارد');
  if (Math.abs(d - c) > 0.005) throw bad(`سند تراز نیست: جمع بدهکار ${d.toLocaleString('fa-IR')} ≠ جمع بستانکار ${c.toLocaleString('fa-IR')}`);
  return { lines: out, total: r2(d) };
}

async function checkLock(ctx, date) {
  const c = (await ctx.db.get('SELECT lock_date FROM companies WHERE id=?', ctx.companyId));
  if (c?.lock_date && date <= c.lock_date) throw new HttpError(409, `دوره‌ی مالی تا تاریخ ${c.lock_date} بسته است و سند جدید در آن قابل ثبت نیست`);
}

async function nextJournalNumber(ctx) {
  (await ctx.db.run(`INSERT INTO counters (company_id,key,n) VALUES (?,?,1) ON CONFLICT(company_id,key) DO UPDATE SET n=counters.n+1`, ctx.companyId, 'journal_entries'));
  return 'JV-' + String((await ctx.db.get('SELECT n FROM counters WHERE company_id=? AND key=?', ctx.companyId, 'journal_entries')).n).padStart(5, '0');
}

async function insertGl(ctx, entryId, date, lines) {
  for (const l of lines) await ctx.db.run('INSERT INTO gl_lines (company_id,entry_id,account_id,date,debit,credit,memo,party_type,party_id) VALUES (?,?,?,?,?,?,?,?,?)', ctx.companyId, entryId, l.account_id, date, l.debit, l.credit, l.memo, l.customer_id ? 'customer' : l.supplier_id ? 'supplier' : null, l.customer_id || l.supplier_id || null);
}

// ثبت مستقیم سند «قطعی» (برای سندهای خودکار)
export async function postJournal(ctx, { date, description, source, source_ref, lines }) {
  lines = lines.filter((l) => (Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0);
  if (!lines.length) return null;
  const { lines: ls, total } = await cleanLines(ctx, lines);
  date = date || today();
  await checkLock(ctx, date);
  const id = (await ctx.db.insert(`INSERT INTO e_journal_entries (company_id,number,date,description,status,source,source_ref,lines,total,created_by)
    VALUES (?,?,?,?,'posted',?,?,?,?,?)`, ctx.companyId, await nextJournalNumber(ctx), date, description, source || 'manual', source_ref ?? null, JSON.stringify(ls), total, ctx.user.id));
  await insertGl(ctx, id, date, ls);
  return id;
}

// قطعی‌کردن سند دستی (پیش‌نویس ← قطعی)
export async function postDraft(ctx, rec) {
  await checkLock(ctx, rec.date);
  const { lines } = await cleanLines(ctx, rec.lines, { manual: true });
  await insertGl(ctx, rec.id, rec.date, lines);
}

export async function reverseEntry(ctx, entry) {
  const lines = (typeof entry.lines === 'string' ? JSON.parse(entry.lines) : entry.lines).map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo, customer_id: l.customer_id, supplier_id: l.supplier_id }));
  await postJournal(ctx, { date: today(), description: `برگشت سند ${entry.number}`, source: 'reversal', source_ref: entry.number, lines });
  (await ctx.db.run(`UPDATE e_journal_entries SET status='reversed', updated_at=datetime('now') WHERE id=? AND company_id=?`, entry.id, ctx.companyId));
}

// اصلاح/حذف سند مبدأ ← برگشت سندهای خودکار مرتبط
export async function reverseBySource(ctx, source, ref) {
  if (!await accountingOn(ctx)) return;
  const rows = (await ctx.db.all(`SELECT * FROM e_journal_entries WHERE company_id=? AND source=? AND source_ref=? AND status='posted'`, ctx.companyId, source, String(ref)));
  for (const e of rows) await reverseEntry(ctx, e);
}

export async function autoPost(ctx, args) {
  if (!await accountingOn(ctx)) return null;
  return await postJournal(ctx, { ...args, source_ref: args.source_ref !== undefined ? String(args.source_ref) : null });
}

export const hasGl = async (ctx, accountId) => !!(await ctx.db.get('SELECT 1 FROM gl_lines WHERE company_id=? AND account_id=? LIMIT 1', ctx.companyId, accountId));

// ───────────── گزارش‌ها ─────────────
const FROM = '0000-01-01', TO = '9999-12-31';
const rng = (p) => [isoDate(p.from) ? p.from : FROM, isoDate(p.to) ? p.to : TO];

export async function trialBalance(ctx, p) {
  const [from, to] = rng(p);
  const rows = (await ctx.db.all(`SELECT a.id,a.code,a.name,a.type,
      COALESCE(SUM(CASE WHEN g.date < ? THEN g.debit - g.credit END),0) opening,
      COALESCE(SUM(CASE WHEN g.date >= ? THEN g.debit END),0) debit,
      COALESCE(SUM(CASE WHEN g.date >= ? THEN g.credit END),0) credit
    FROM e_accounts a LEFT JOIN gl_lines g ON g.account_id=a.id AND g.company_id=a.company_id AND g.date <= ?
    WHERE a.company_id=? GROUP BY a.id ORDER BY a.code`, from, from, from, to, ctx.companyId))
    .map((r) => ({ ...r, closing: r2(r.opening + r.debit - r.credit) }))
    .filter((r) => r.opening || r.debit || r.credit);
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, totals: { opening: sum('opening'), debit: sum('debit'), credit: sum('credit'), closing: sum('closing') } };
}

export async function ledger(ctx, p) {
  const acc = (await ctx.db.get('SELECT id,code,name,type FROM e_accounts WHERE id=? AND company_id=?', Number(p.account), ctx.companyId));
  if (!acc) throw bad('حساب را انتخاب کنید');
  const [from, to] = rng(p);
  const opening = (await ctx.db.get('SELECT COALESCE(SUM(debit-credit),0) s FROM gl_lines WHERE company_id=? AND account_id=? AND date < ?', ctx.companyId, acc.id, from)).s;
  let bal = opening;
  const rows = (await ctx.db.all(`SELECT g.date,g.debit,g.credit,g.memo,e.number,e.description FROM gl_lines g JOIN e_journal_entries e ON e.id=g.entry_id
    WHERE g.company_id=? AND g.account_id=? AND g.date>=? AND g.date<=? ORDER BY g.date,g.id`, ctx.companyId, acc.id, from, to))
    .map((r) => ({ ...r, balance: (bal = r2(bal + r.debit - r.credit)) }));
  return { account: acc, opening: r2(opening), rows, closing: r2(bal) };
}

// اسناد بستن حساب‌های موقت (و برگشت‌های آن) در صورت سود و زیان نمایش داده نمی‌شوند
const NOT_CLOSING = `AND g.entry_id NOT IN (SELECT id FROM e_journal_entries WHERE company_id=a.company_id AND (source='closing' OR (source='reversal' AND source_ref IN (SELECT number FROM e_journal_entries WHERE company_id=a.company_id AND source='closing'))))`;
async function sums(ctx, from, to, { excludeClosing } = {}) {
  return (await ctx.db.all(`SELECT a.id,a.code,a.name,a.type,a.sys_key, COALESCE(SUM(g.debit),0) debit, COALESCE(SUM(g.credit),0) credit
    FROM e_accounts a JOIN gl_lines g ON g.account_id=a.id AND g.company_id=a.company_id AND g.date>=? AND g.date<=? ${excludeClosing ? NOT_CLOSING : ''}
    WHERE a.company_id=? GROUP BY a.id ORDER BY a.code`, from, to, ctx.companyId));
}

export async function incomeStatement(ctx, p) {
  const [from, to] = rng(p);
  const all = await sums(ctx, from, to, { excludeClosing: true });
  const revenue = all.filter((a) => a.type === 'revenue').map((a) => ({ ...a, amount: r2(a.credit - a.debit) }));
  const expenses = all.filter((a) => a.type === 'expense').map((a) => ({ ...a, amount: r2(a.debit - a.credit) }));
  const tr = r2(revenue.reduce((s, a) => s + a.amount, 0)), te = r2(expenses.reduce((s, a) => s + a.amount, 0));
  const cogs = expenses.find((a) => a.sys_key === 'cogs')?.amount || 0;
  return { revenue, expenses, totalRevenue: tr, totalExpenses: te, grossProfit: r2(tr - cogs), netIncome: r2(tr - te) };
}

export async function balanceSheet(ctx, p) {
  const to = isoDate(p.to) ? p.to : TO;
  const all = await sums(ctx, FROM, to);
  const pick = (t, sign) => all.filter((a) => a.type === t).map((a) => ({ ...a, amount: r2(sign * (a.debit - a.credit)) })).filter((a) => a.amount);
  const assets = pick('asset', 1), liabilities = pick('liability', -1), equity = pick('equity', -1);
  const earnings = r2(all.filter((a) => a.type === 'revenue').reduce((s, a) => s + a.credit - a.debit, 0) - all.filter((a) => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0));
  const ta = r2(assets.reduce((s, a) => s + a.amount, 0)), tl = r2(liabilities.reduce((s, a) => s + a.amount, 0)), te = r2(equity.reduce((s, a) => s + a.amount, 0));
  return { assets, liabilities, equity, earnings, totalAssets: ta, totalLiabilities: tl, totalEquity: r2(te + earnings), difference: r2(ta - tl - te - earnings) };
}

// ───────────── حساب تفصیلی (مشتریان/تأمین‌کنندگان) ─────────────
export async function partyReport(ctx, p) {
  const type = p.type === 'supplier' ? 'supplier' : 'customer';
  const sign = type === 'customer' ? 1 : -1; // مانده‌ی طبیعی: مشتری بدهکار، تأمین‌کننده بستانکار
  const tbl = type === 'customer' ? 'e_customers' : 'e_suppliers';
  const ctrl = (await ctx.db.get(`SELECT COALESCE(SUM(g.debit-g.credit),0) s FROM gl_lines g JOIN e_accounts a ON a.id=g.account_id WHERE g.company_id=? AND a.sys_key=?`, ctx.companyId, type === 'customer' ? 'ar' : 'ap')).s;
  if (!p.party) {
    const rows = (await ctx.db.all(`SELECT t.id,t.name, COALESCE(SUM(g.debit-g.credit),0) s FROM ${tbl} t JOIN gl_lines g ON g.party_type=? AND g.party_id=t.id AND g.company_id=t.company_id
      JOIN e_accounts a ON a.id=g.account_id AND a.sys_key IN ('ar','ap') WHERE t.company_id=? GROUP BY t.id ORDER BY t.name`, type, ctx.companyId))
      .map((r) => ({ id: r.id, name: r.name, balance: r2(sign * r.s) })).filter((r) => r.balance);
    const total = r2(rows.reduce((s, r) => s + r.balance, 0));
    return { type, parties: rows, total, control: r2(sign * ctrl), unassigned: r2(sign * ctrl - total) };
  }
  const party = (await ctx.db.get(`SELECT id,name FROM ${tbl} WHERE id=? AND company_id=?`, Number(p.party), ctx.companyId));
  if (!party) throw bad('طرف حساب یافت نشد');
  const [from, to] = rng(p);
  const base = `FROM gl_lines g JOIN e_accounts a ON a.id=g.account_id AND a.sys_key IN ('ar','ap') JOIN e_journal_entries e ON e.id=g.entry_id WHERE g.company_id=? AND g.party_type=? AND g.party_id=?`;
  const opening = sign * (await ctx.db.get(`SELECT COALESCE(SUM(g.debit-g.credit),0) s ${base} AND g.date<?`, ctx.companyId, type, party.id, from)).s;
  let bal = opening;
  const rows = (await ctx.db.all(`SELECT g.date,g.debit,g.credit,e.number,e.description ${base} AND g.date>=? AND g.date<=? ORDER BY g.date,g.id`, ctx.companyId, type, party.id, from, to))
    .map((r) => ({ ...r, balance: (bal = r2(bal + sign * (r.debit - r.credit))) }));
  return { type, party, opening: r2(opening), rows, closing: r2(bal) };
}

// ───────────── بستن سال مالی ─────────────
export async function closeYear(ctx, date) {
  if (!isoDate(date)) throw bad('تاریخ بستن سال نامعتبر است');
  const c = (await ctx.db.get('SELECT lock_date FROM companies WHERE id=?', ctx.companyId));
  if (c.lock_date && date <= c.lock_date) throw new HttpError(409, `دوره تا ${c.lock_date} بسته شده است`);
  if ((await ctx.db.get(`SELECT 1 FROM e_journal_entries WHERE company_id=? AND status='draft' AND date<=? LIMIT 1`, ctx.companyId, date)))
    throw new HttpError(409, 'اسناد پیش‌نویس تا این تاریخ وجود دارد؛ ابتدا آن‌ها را قطعی یا حذف کنید');
  const rows = (await sums(ctx, FROM, date)).filter((a) => (a.type === 'revenue' || a.type === 'expense') && Math.abs(a.debit - a.credit) > 0.004);
  const net = r2(rows.reduce((s, a) => s + (a.type === 'revenue' ? a.credit - a.debit : a.credit - a.debit), 0)); // سود = بستانکار − بدهکار
  let entry = null;
  if (rows.length) {
    const lines = rows.map((a) => { const b = r2(a.debit - a.credit); return b > 0 ? { account_id: a.id, credit: b } : { account_id: a.id, debit: -b }; });
    const d = lines.reduce((s, l) => s + (l.debit || 0), 0), cr = lines.reduce((s, l) => s + (l.credit || 0), 0);
    const diff = r2(d - cr);
    lines.push(diff > 0 ? { account_id: await acct(ctx, 'retained'), credit: diff } : { account_id: await acct(ctx, 'retained'), debit: -diff });
    entry = await postJournal(ctx, { date, description: `بستن حساب‌های درآمد و هزینه تا ${date} (انتقال به سود/زیان انباشته)`, source: 'closing', source_ref: date, lines });
  }
  (await ctx.db.run('UPDATE companies SET lock_date=? WHERE id=?', date, ctx.companyId));
  return { net, entry, lock_date: date };
}
