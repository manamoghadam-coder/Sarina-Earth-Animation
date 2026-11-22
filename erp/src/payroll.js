// حقوق‌ودستمزد: محاسبه‌ی فیش، ایجاد فیش‌های دوره، اسناد حسابداری
// نکته: نرخ‌ها، سقف بیمه و پله‌های مالیاتی «پارامتر» هستند و هر سال باید توسط حسابدار مطابق قوانین جاری تنظیم شوند.
import { HttpError, bad, today } from './util.js';
import { autoPost, acct, reverseBySource } from './accounting.js';

const r0 = Math.round;
const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

export const DEFAULTS = { insurance_employee_pct: 7, insurance_employer_pct: 23, insurance_ceiling: 0, overtime_multiplier: 1.4, daily_hours: 7.33, brackets: [] };

export async function loadParams(ctx) {
  const r = await ctx.db.get('SELECT * FROM e_payroll_params WHERE company_id=? ORDER BY id LIMIT 1', ctx.companyId);
  if (!r) return { ...DEFAULTS };
  const p = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k !== 'brackets' && r[k] !== null && r[k] !== undefined) p[k] = r[k];
  p.brackets = parse(r.brackets).map((b) => ({ from: Number(b.from), rate: Number(b.rate) })).sort((a, b) => a.from - b.from);
  return p;
}

// مالیات پلکانی ماهانه: هر پله از «from» تا شروع پله‌ی بعد با نرخ همان پله
export function progressiveTax(income, brackets) {
  let tax = 0;
  brackets.forEach((b, i) => {
    const upper = i + 1 < brackets.length ? brackets[i + 1].from : Infinity;
    if (income > b.from) tax += (Math.min(income, upper) - b.from) * (b.rate / 100);
  });
  return r0(tax);
}

// روزهای مرخصی بدون حقوقِ تأییدشده که با بازه‌ی حقوق هم‌پوشانی دارد
export async function unpaidDays(ctx, employeeId, start, end) {
  const rows = await ctx.db.all(`SELECT from_date, to_date FROM e_leaves WHERE company_id=? AND employee_id=? AND kind='unpaid' AND status='approved' AND to_date>=? AND from_date<=?`, ctx.companyId, employeeId, start, end);
  let n = 0;
  for (const l of rows) {
    const a = l.from_date > start ? l.from_date : start, b = l.to_date < end ? l.to_date : end;
    n += Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  }
  return n;
}

export function calc({ emp, run, params, unpaid, overtime_hours = 0, bonus = 0, other_deductions = 0 }) {
  const days = run.days, base = Number(emp.salary) || 0;
  const worked = Math.max(0, days - unpaid);
  const base_pay = r0((base * worked) / days);
  const allowances = r0((Number(emp.housing_allowance) || 0) + (Number(emp.food_allowance) || 0) + (Number(emp.child_allowance) || 0));
  const hourly = base / (30 * params.daily_hours);
  const overtime_pay = r0(overtime_hours * hourly * params.overtime_multiplier);
  const gross = base_pay + allowances + overtime_pay + r0(bonus);
  const insured = emp.insured !== 0, taxable = emp.taxable !== 0;
  const insurable = insured ? (params.insurance_ceiling > 0 ? Math.min(gross, params.insurance_ceiling) : gross) : 0;
  const ins_employee = r0((insurable * params.insurance_employee_pct) / 100);
  const ins_employer = r0((insurable * params.insurance_employer_pct) / 100);
  const taxable_income = taxable ? Math.max(0, gross - ins_employee) : 0;
  const tax = progressiveTax(taxable_income, params.brackets);
  const net = gross - ins_employee - tax - r0(other_deductions);
  if (net < 0) throw bad('خالص پرداختی منفی می‌شود؛ کسورات را بررسی کنید');
  return { days, unpaid_days: unpaid, base_pay, allowances, overtime_hours, overtime_pay, bonus: r0(bonus), gross, insurable, ins_employee, ins_employer, taxable_income, tax, other_deductions: r0(other_deductions), net };
}

const SLIP_COLS = ['days', 'unpaid_days', 'base_pay', 'allowances', 'overtime_hours', 'overtime_pay', 'bonus', 'gross', 'insurable', 'ins_employee', 'ins_employer', 'taxable_income', 'tax', 'other_deductions', 'net'];

export async function recalcSlip(ctx, rec) {
  const run = await ctx.db.get('SELECT * FROM e_payroll_runs WHERE id=? AND company_id=?', rec.run_id, ctx.companyId);
  const emp = await ctx.db.get('SELECT * FROM e_employees WHERE id=? AND company_id=?', rec.employee_id, ctx.companyId);
  if (!run || !emp) throw bad('دوره یا کارمند نامعتبر است');
  if (run.status !== 'draft') throw new HttpError(409, 'فقط فیش‌های دوره‌ی پیش‌نویس قابل تغییر است');
  const c = calc({ emp, run, params: await loadParams(ctx), unpaid: await unpaidDays(ctx, emp.id, run.start_date, run.end_date), overtime_hours: Number(rec.overtime_hours) || 0, bonus: Number(rec.bonus) || 0, other_deductions: Number(rec.other_deductions) || 0 });
  Object.assign(rec, c);
}

export async function updateRunTotals(ctx, runId) {
  const t = await ctx.db.get(`SELECT COUNT(*) n, COALESCE(SUM(gross),0) g, COALESCE(SUM(ins_employee),0) ie, COALESCE(SUM(ins_employer),0) ir, COALESCE(SUM(tax),0) tx, COALESCE(SUM(net),0) nt FROM e_payslips WHERE run_id=? AND company_id=?`, runId, ctx.companyId);
  await ctx.db.run('UPDATE e_payroll_runs SET employees_count=?, total_gross=?, total_insurance=?, total_tax=?, total_net=?, employer_cost=? WHERE id=? AND company_id=?', t.n, t.g, t.ie, t.tx, t.nt, t.g + t.ir, runId, ctx.companyId);
  return t;
}

export async function generatePayslips(ctx, run) {
  const params = await loadParams(ctx);
  const emps = await ctx.db.all(`SELECT * FROM e_employees WHERE company_id=? AND status='active' AND salary>0 ORDER BY id`, ctx.companyId);
  if (!emps.length) throw bad('کارمند شاغل دارای حقوق پایه یافت نشد');
  await ctx.db.run('DELETE FROM e_payslips WHERE run_id=? AND company_id=?', run.id, ctx.companyId);
  for (const emp of emps) {
    const c = calc({ emp, run, params, unpaid: await unpaidDays(ctx, emp.id, run.start_date, run.end_date) });
    await ctx.db.run(`INSERT INTO e_payslips (company_id,run_id,employee_id,${SLIP_COLS.map((k) => `"${k}"`).join(',')},created_by) VALUES (?,?,?,${SLIP_COLS.map(() => '?').join(',')},?)`,
      ctx.companyId, run.id, emp.id, ...SLIP_COLS.map((k) => c[k]), ctx.user.id);
  }
  await updateRunTotals(ctx, run.id);
}

export async function approveRun(ctx, run) {
  const t = await updateRunTotals(ctx, run.id);
  if (!t.n) throw bad('ابتدا فیش‌های حقوقی را ایجاد کنید');
  const other = (await ctx.db.get('SELECT COALESCE(SUM(other_deductions),0) o FROM e_payslips WHERE run_id=? AND company_id=?', run.id, ctx.companyId)).o;
  await autoPost(ctx, {
    date: run.end_date, description: `حقوق و دستمزد ${run.number} (${run.year}/${String(run.month).padStart(2, '0')})`, source: 'payroll_runs', source_ref: run.id,
    lines: [
      { account_id: await acct(ctx, 'exp_salary'), debit: t.g },
      { account_id: await acct(ctx, 'exp_insurance_er'), debit: t.ir },
      { account_id: await acct(ctx, 'salary_payable'), credit: t.nt },
      { account_id: await acct(ctx, 'ins_payable'), credit: t.ie + t.ir },
      { account_id: await acct(ctx, 'tax_payable'), credit: t.tx },
      { account_id: await acct(ctx, 'employee_advances'), credit: other },
    ],
  });
}

export async function payRun(ctx, run) {
  await autoPost(ctx, {
    date: today(), description: `پرداخت حقوق ${run.number}`, source: 'payroll_runs', source_ref: `${run.id}:pay`,
    lines: [{ account_id: await acct(ctx, 'salary_payable'), debit: run.total_net }, { account_id: await acct(ctx, 'bank'), credit: run.total_net }],
  });
}

export const cancelRun = (ctx, run) => reverseBySource(ctx, 'payroll_runs', run.id);
