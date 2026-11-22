// حسابداری دوطرفه: ثبت سند، دفتر کل، گزارش‌های مالی
import { HttpError, bad, isoDate, today } from './util.js';

// نوع حساب: asset/expense طبیعتاً بدهکار؛ liability/equity/revenue طبیعتاً بستانکار
export const CHART = [
  ['1101', 'صندوق', 'asset', 'cash'], ['1102', 'بانک', 'asset', 'bank'], ['1201', 'حساب‌های دریافتنی تجاری', 'asset', 'ar'],
  ['1301', 'موجودی مواد اولیه و کالا', 'asset', 'inv_raw'], ['1302', 'موجودی کالای در جریان ساخت', 'asset', 'inv_wip'], ['1303', 'موجودی کالای ساخته‌شده', 'asset', 'inv_fg'],
  ['1401', 'مالیات بر ارزش افزوده قابل استرداد', 'asset', 'vat_in'], ['1501', 'دارایی‌های ثابت', 'asset', null],
  ['2101', 'حساب‌های پرداختنی تجاری', 'liability', 'ap'], ['2201', 'مالیات بر ارزش افزوده پرداختنی', 'liability', 'vat_out'],
  ['2301', 'حقوق و دستمزد پرداختنی', 'liability', null], ['2401', 'وام‌ها و تسهیلات', 'liability', null],
  ['3101', 'سرمایه', 'equity', 'equity'], ['3201', 'سود (زیان) انباشته', 'equity', 'retained'],
  ['4101', 'فروش کالا', 'revenue', 'sales'], ['4201', 'سایر درآمدها', 'revenue', null],
  ['5101', 'بهای تمام‌شده کالای فروش‌رفته', 'expense', 'cogs'], ['5201', 'حقوق و دستمزد', 'expense', 'exp_salary'], ['5202', 'اجاره', 'expense', 'exp_rent'],
  ['5203', 'آب، برق، گاز و اینترنت', 'expense', 'exp_utilities'], ['5204', 'حمل و نقل', 'expense', 'exp_transport'], ['5205', 'تبلیغات و بازاریابی', 'expense', 'exp_marketing'],
  ['5206', 'ملزومات مصرفی', 'expense', 'exp_supplies'], ['5299', 'سایر هزینه‌ها', 'expense', 'exp_other'], ['5401', 'دستمزد و سربار تولید جذب‌شده', 'expense', 'conv_absorbed'],
];

export function seedChart(db, companyId) {
  if (db.prepare('SELECT 1 FROM e_accounts WHERE company_id=? LIMIT 1').get(companyId)) return;
  const st = db.prepare('INSERT INTO e_accounts (company_id,code,name,type,sys_key,active) VALUES (?,?,?,?,?,1)');
  for (const [code, name, type, key] of CHART) st.run(companyId, code, name, type, key);
}

export function accountingOn(ctx) {
  const c = ctx.db.prepare('SELECT modules FROM companies WHERE id=?').get(ctx.companyId);
  return !!c && JSON.parse(c.modules).includes('accounting');
}

export function acct(ctx, key) {
  const a = ctx.db.prepare('SELECT id FROM e_accounts WHERE company_id=? AND sys_key=?').get(ctx.companyId, key);
  if (!a) throw new HttpError(409, `حساب سیستمی «${key}» در سرفصل‌ها یافت نشد`);
  return a.id;
}

const r2 = (x) => Math.round(x * 100) / 100;

export function cleanLines(ctx, lines, { manual } = {}) {
  if (!Array.isArray(lines)) throw bad('ردیف‌های سند نامعتبر است');
  let d = 0, c = 0;
  const out = lines.map((l, i) => {
    const a = ctx.db.prepare('SELECT id,active FROM e_accounts WHERE id=? AND company_id=?').get(Number(l.account_id), ctx.companyId);
    if (!a) throw bad(`ردیف ${i + 1}: حساب نامعتبر است`);
    if (manual && !a.active) throw bad(`ردیف ${i + 1}: حساب غیرفعال است`);
    const debit = r2(Number(l.debit) || 0), credit = r2(Number(l.credit) || 0);
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) throw bad(`ردیف ${i + 1}: هر ردیف باید فقط یکی از بدهکار یا بستانکار را (با مبلغ مثبت) داشته باشد`);
    d += debit; c += credit;
    return { account_id: a.id, debit, credit, memo: l.memo ? String(l.memo).slice(0, 200) : null };
  });
  if (out.length < 2) throw bad('سند حداقل دو ردیف لازم دارد');
  if (Math.abs(d - c) > 0.005) throw bad(`سند تراز نیست: جمع بدهکار ${d.toLocaleString('fa-IR')} ≠ جمع بستانکار ${c.toLocaleString('fa-IR')}`);
  return { lines: out, total: r2(d) };
}

function checkLock(ctx, date) {
  const c = ctx.db.prepare('SELECT lock_date FROM companies WHERE id=?').get(ctx.companyId);
  if (c?.lock_date && date <= c.lock_date) throw new HttpError(409, `دوره‌ی مالی تا تاریخ ${c.lock_date} بسته است و سند جدید در آن قابل ثبت نیست`);
}

function nextJournalNumber(ctx) {
  ctx.db.prepare(`INSERT INTO counters (company_id,key,n) VALUES (?,?,1) ON CONFLICT(company_id,key) DO UPDATE SET n=n+1`).run(ctx.companyId, 'journal_entries');
  return 'JV-' + String(ctx.db.prepare('SELECT n FROM counters WHERE company_id=? AND key=?').get(ctx.companyId, 'journal_entries').n).padStart(5, '0');
}

function insertGl(ctx, entryId, date, lines) {
  const st = ctx.db.prepare('INSERT INTO gl_lines (company_id,entry_id,account_id,date,debit,credit,memo) VALUES (?,?,?,?,?,?,?)');
  for (const l of lines) st.run(ctx.companyId, entryId, l.account_id, date, l.debit, l.credit, l.memo);
}

// ثبت مستقیم سند «قطعی» (برای سندهای خودکار)
export function postJournal(ctx, { date, description, source, source_ref, lines }) {
  lines = lines.filter((l) => (Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0);
  if (!lines.length) return null;
  const { lines: ls, total } = cleanLines(ctx, lines);
  date = date || today();
  checkLock(ctx, date);
  const r = ctx.db.prepare(`INSERT INTO e_journal_entries (company_id,number,date,description,status,source,source_ref,lines,total,created_by)
    VALUES (?,?,?,?,'posted',?,?,?,?,?)`).run(ctx.companyId, nextJournalNumber(ctx), date, description, source || 'manual', source_ref ?? null, JSON.stringify(ls), total, ctx.user.id);
  const id = Number(r.lastInsertRowid);
  insertGl(ctx, id, date, ls);
  return id;
}

// قطعی‌کردن سند دستی (پیش‌نویس ← قطعی)
export function postDraft(ctx, rec) {
  checkLock(ctx, rec.date);
  const { lines } = cleanLines(ctx, rec.lines, { manual: true });
  insertGl(ctx, rec.id, rec.date, lines);
}

export function reverseEntry(ctx, entry) {
  const lines = (typeof entry.lines === 'string' ? JSON.parse(entry.lines) : entry.lines).map((l) => ({ account_id: l.account_id, debit: l.credit, credit: l.debit, memo: l.memo }));
  postJournal(ctx, { date: today(), description: `برگشت سند ${entry.number}`, source: 'reversal', source_ref: entry.number, lines });
  ctx.db.prepare(`UPDATE e_journal_entries SET status='reversed', updated_at=datetime('now') WHERE id=? AND company_id=?`).run(entry.id, ctx.companyId);
}

// اصلاح/حذف سند مبدأ ← برگشت سندهای خودکار مرتبط
export function reverseBySource(ctx, source, ref) {
  if (!accountingOn(ctx)) return;
  const rows = ctx.db.prepare(`SELECT * FROM e_journal_entries WHERE company_id=? AND source=? AND source_ref=? AND status='posted'`).all(ctx.companyId, source, String(ref));
  for (const e of rows) reverseEntry(ctx, e);
}

export function autoPost(ctx, args) {
  if (!accountingOn(ctx)) return null;
  return postJournal(ctx, { ...args, source_ref: args.source_ref !== undefined ? String(args.source_ref) : null });
}

export const hasGl = (ctx, accountId) => !!ctx.db.prepare('SELECT 1 FROM gl_lines WHERE company_id=? AND account_id=? LIMIT 1').get(ctx.companyId, accountId);

// ───────────── گزارش‌ها ─────────────
const FROM = '0000-01-01', TO = '9999-12-31';
const rng = (p) => [isoDate(p.from) ? p.from : FROM, isoDate(p.to) ? p.to : TO];

export function trialBalance(ctx, p) {
  const [from, to] = rng(p);
  const rows = ctx.db.prepare(`SELECT a.id,a.code,a.name,a.type,
      COALESCE(SUM(CASE WHEN g.date < ? THEN g.debit - g.credit END),0) opening,
      COALESCE(SUM(CASE WHEN g.date >= ? THEN g.debit END),0) debit,
      COALESCE(SUM(CASE WHEN g.date >= ? THEN g.credit END),0) credit
    FROM e_accounts a LEFT JOIN gl_lines g ON g.account_id=a.id AND g.company_id=a.company_id AND g.date <= ?
    WHERE a.company_id=? GROUP BY a.id ORDER BY a.code`).all(from, from, from, to, ctx.companyId)
    .map((r) => ({ ...r, closing: r2(r.opening + r.debit - r.credit) }))
    .filter((r) => r.opening || r.debit || r.credit);
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, totals: { opening: sum('opening'), debit: sum('debit'), credit: sum('credit'), closing: sum('closing') } };
}

export function ledger(ctx, p) {
  const acc = ctx.db.prepare('SELECT id,code,name,type FROM e_accounts WHERE id=? AND company_id=?').get(Number(p.account), ctx.companyId);
  if (!acc) throw bad('حساب را انتخاب کنید');
  const [from, to] = rng(p);
  const opening = ctx.db.prepare('SELECT COALESCE(SUM(debit-credit),0) s FROM gl_lines WHERE company_id=? AND account_id=? AND date < ?').get(ctx.companyId, acc.id, from).s;
  let bal = opening;
  const rows = ctx.db.prepare(`SELECT g.date,g.debit,g.credit,g.memo,e.number,e.description FROM gl_lines g JOIN e_journal_entries e ON e.id=g.entry_id
    WHERE g.company_id=? AND g.account_id=? AND g.date>=? AND g.date<=? ORDER BY g.date,g.id`).all(ctx.companyId, acc.id, from, to)
    .map((r) => ({ ...r, balance: (bal = r2(bal + r.debit - r.credit)) }));
  return { account: acc, opening: r2(opening), rows, closing: r2(bal) };
}

function sums(ctx, from, to) {
  return ctx.db.prepare(`SELECT a.id,a.code,a.name,a.type,a.sys_key, COALESCE(SUM(g.debit),0) debit, COALESCE(SUM(g.credit),0) credit
    FROM e_accounts a JOIN gl_lines g ON g.account_id=a.id AND g.company_id=a.company_id AND g.date>=? AND g.date<=?
    WHERE a.company_id=? GROUP BY a.id ORDER BY a.code`).all(from, to, ctx.companyId);
}

export function incomeStatement(ctx, p) {
  const [from, to] = rng(p);
  const all = sums(ctx, from, to);
  const revenue = all.filter((a) => a.type === 'revenue').map((a) => ({ ...a, amount: r2(a.credit - a.debit) }));
  const expenses = all.filter((a) => a.type === 'expense').map((a) => ({ ...a, amount: r2(a.debit - a.credit) }));
  const tr = r2(revenue.reduce((s, a) => s + a.amount, 0)), te = r2(expenses.reduce((s, a) => s + a.amount, 0));
  const cogs = expenses.find((a) => a.sys_key === 'cogs')?.amount || 0;
  return { revenue, expenses, totalRevenue: tr, totalExpenses: te, grossProfit: r2(tr - cogs), netIncome: r2(tr - te) };
}

export function balanceSheet(ctx, p) {
  const to = isoDate(p.to) ? p.to : TO;
  const all = sums(ctx, FROM, to);
  const pick = (t, sign) => all.filter((a) => a.type === t).map((a) => ({ ...a, amount: r2(sign * (a.debit - a.credit)) })).filter((a) => a.amount);
  const assets = pick('asset', 1), liabilities = pick('liability', -1), equity = pick('equity', -1);
  const earnings = r2(all.filter((a) => a.type === 'revenue').reduce((s, a) => s + a.credit - a.debit, 0) - all.filter((a) => a.type === 'expense').reduce((s, a) => s + a.debit - a.credit, 0));
  const ta = r2(assets.reduce((s, a) => s + a.amount, 0)), tl = r2(liabilities.reduce((s, a) => s + a.amount, 0)), te = r2(equity.reduce((s, a) => s + a.amount, 0));
  return { assets, liabilities, equity, earnings, totalAssets: ta, totalLiabilities: tl, totalEquity: r2(te + earnings), difference: r2(ta - tl - te - earnings) };
}
