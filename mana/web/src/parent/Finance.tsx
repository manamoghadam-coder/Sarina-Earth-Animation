import { useState } from 'react';
import { api } from '../api';
import { MONTHS, fa, fmtDate, money, parts, tehranToday } from '../jalali';
import { useLevel } from '../auth';
import { BarChart, DateField, Empty, Field, Loading, Modal, MoneyField, useAction, useLoad , ReadOnlyBanner } from '../ui';

const CATS = ['خانه', 'حمل‌ونقل', 'سلامت', 'آموزش', 'تفریح', 'قبوض', 'پوشاک', 'اقساط و بدهی', 'حقوق', 'سایر'];
const TYPE: Record<string, string> = { debt: 'بدهی', installment: 'قسط', loan: 'وام' };
export default function Finance() {
  const lvF = useLevel('finance'); const lvD = useLevel('debts'); const t = parts(tehranToday()); const [ym, setYm] = useState({ jy: t.jy, jm: t.jm }); const act = useAction();
  const sum = useLoad(() => (lvF >= 1 ? api(`/finance/summary?jy=${ym.jy}&jm=${ym.jm}`) : Promise.resolve(null)), [ym.jy, ym.jm, lvF]);
  const txs = useLoad(() => (lvF >= 1 ? api<any[]>('/transactions') : Promise.resolve([])), [lvF]); const debts = useLoad(() => (lvD >= 1 ? api<any[]>('/debts') : Promise.resolve([])), [lvD]);
  const [tx, setTx] = useState<any | null>(null); const [debt, setDebt] = useState<any | null>(null); const [budget, setBudget] = useState<any | null>(null);
  const [from, to] = [sum.data?.from, sum.data?.to];
  const reloadAll = async () => { await Promise.all([sum.reload(), txs.reload(), debts.reload()]); };
  const step = (n: number) => { let m = ym.jm + n, y = ym.jy; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } setYm({ jy: y, jm: m }); };
  const d = sum.data;
  const monthTx = (txs.data ?? []).filter((x) => from && x.occurred_on >= from && x.occurred_on <= to);
  return <div className="space-y-4"><ReadOnlyBanner module="finance" /><ReadOnlyBanner module="debts" />
    <div className="flex items-center justify-between flex-wrap gap-2"><h1 className="text-xl font-extrabold">مدیریت مالی <span className="chip">خصوصی</span></h1>
      <div className="flex gap-2">{lvF >= 2 && <button className="btn btn-teal" onClick={() => setTx({ kind: 'expense', amount: '', category: 'خانه', occurred_on: tehranToday(), note: '' })}>＋ تراکنش</button>}{lvD >= 2 && <button className="btn btn-ghost" onClick={() => setDebt({ title: '', type: 'installment', total_amount: '', installment_amount: '', next_due_date: tehranToday(), remaining_installments: '' })}>＋ قسط/بدهی/وام</button>}</div></div>
    {lvF >= 1 && <div className="flex items-center justify-between"><button className="btn btn-ghost" onClick={() => step(-1)} aria-label="ماه قبل">›</button><b>{MONTHS[ym.jm - 1]} {fa(ym.jy)}</b><button className="btn btn-ghost" onClick={() => step(1)} aria-label="ماه بعد">‹</button></div>}
    <Loading error={sum.error} loading={sum.loading && !d} />
    {d && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <div className="card"><div className="text-xs text-slate-500">درآمد ماه</div><b className="text-lg text-teal-700">{money(d.income)}</b></div>
        <div className="card"><div className="text-xs text-slate-500">هزینه‌ی ماه</div><b className="text-lg text-red-600">{money(d.expense)}</b></div>
        <div className="card"><div className="text-xs text-slate-500">خالص ماه</div><b className="text-lg">{money(d.net)}</b></div>
        <div className="card"><div className="text-xs text-slate-500">مانده نقدینگی (کل)</div><b className="text-lg">{money(d.balance)}</b></div></div>
      <section className="card"><div className="flex justify-between items-center mb-2"><h2 className="font-bold">هزینه‌ها به تفکیک دسته (تومان)</h2><button className="btn btn-ghost !py-1" onClick={() => setBudget({ category: 'خانه', amount: '' })}>تعیین بودجه</button></div>
        {d.by_category.length ? <BarChart rows={d.by_category.map((c: any) => ({ label: c.category, value: c.total, budget: c.budget }))} fmt={money} /> : <Empty>هزینه‌ای در این ماه ثبت نشده.</Empty>}
        {d.budgets.length > 0 && <p className="text-xs text-slate-500 mt-2">خط عمودی = بودجه؛ قرمز = بیش از بودجه.</p>}</section></>}
    {lvD >= 1 && <section className="card"><h2 className="font-bold mb-2">💳 بدهی‌ها، اقساط و وام‌ها</h2>{!debts.data?.length && <Empty>موردی ثبت نشده.</Empty>}
      {debts.data?.map((x) => <div key={x.id} className={`py-2 border-b border-slate-100 last:border-0 ${x.status === 'closed' ? 'opacity-50' : ''}`}><div className="flex justify-between items-center gap-2"><div><b>{x.title}</b> <span className="chip">{TYPE[x.type]}</span>
        <div className="text-sm text-slate-600">باقی‌مانده: {money(x.total_amount - x.paid_amount)} از {money(x.total_amount)}{x.installment_amount ? ` — قسط ${money(x.installment_amount)}` : ''}{x.next_due_date && x.status === 'open' ? ` — سررسید ${fmtDate(x.next_due_date)}` : ''}{x.remaining_installments != null ? ` — ${fa(x.remaining_installments)} قسط مانده` : ''}</div></div>
        <span className="flex gap-1">{x.status === 'open' && <button className="btn btn-teal !py-1" onClick={() => confirm(`پرداخت ${money(x.installment_amount ?? x.total_amount - x.paid_amount)} تومان ثبت شود؟ (به عنوان هزینه هم ثبت می‌شود)`) && act(async () => { await api(`/debts/${x.id}/pay`, { body: {} }); await reloadAll(); }, 'پرداخت ثبت شد')}>پرداخت</button>}
          <button className="btn btn-ghost !py-1" aria-label="ویرایش" onClick={() => setDebt({ ...x })}>✎</button></span></div></div>)}</section>}
    {lvF >= 1 && <section className="card"><h2 className="font-bold mb-2">تراکنش‌های این ماه</h2>{monthTx.length === 0 && <Empty>تراکنشی نیست.</Empty>}
      {monthTx.map((x) => <div key={x.id} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0"><button className="text-start flex-1" onClick={() => setTx({ ...x })}><span className={x.kind === 'income' ? 'text-teal-700' : 'text-red-600'}>{x.kind === 'income' ? '＋' : '－'} {money(x.amount)}</span> <span className="chip">{x.category}</span> <span className="text-xs text-slate-500">{fmtDate(x.occurred_on, false)} {x.note}</span></button>
        <button className="btn btn-ghost !py-1" aria-label="حذف" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/transactions/${x.id}`, { method: 'DELETE' }); await reloadAll(); })}>🗑</button></div>)}</section>}
    {tx && <Modal title={tx.id ? 'ویرایش تراکنش' : 'تراکنش جدید'} onClose={() => setTx(null)}>
      <div className="flex gap-2 mb-3">{(['expense', 'income'] as const).map((k) => <button key={k} className={`btn flex-1 ${tx.kind === k ? '' : 'btn-ghost'}`} onClick={() => setTx({ ...tx, kind: k })}>{k === 'expense' ? 'هزینه' : 'درآمد'}</button>)}</div>
      <Field label="مبلغ (تومان)"><MoneyField value={tx.amount} onChange={(v) => setTx({ ...tx, amount: v })} /></Field>
      <Field label="دسته"><select className="input" value={tx.category} onChange={(e) => setTx({ ...tx, category: e.target.value })}>{[...new Set([...CATS, tx.category])].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="تاریخ"><DateField value={tx.occurred_on} onChange={(v) => setTx({ ...tx, occurred_on: v ?? tx.occurred_on })} /></Field>
      <Field label="یادداشت"><input className="input" value={tx.note ?? ''} onChange={(e) => setTx({ ...tx, note: e.target.value })} /></Field>
      <button className="btn btn-teal w-full" disabled={!tx.amount} onClick={() => act(async () => { const b = { kind: tx.kind, amount: tx.amount, category: tx.category, occurred_on: tx.occurred_on, note: tx.note || null }; tx.id ? await api(`/transactions/${tx.id}`, { method: 'PATCH', body: b }) : await api('/transactions', { body: b }); setTx(null); await reloadAll(); }, 'ثبت شد')}>ذخیره</button></Modal>}
    {debt && <Modal title={debt.id ? 'ویرایش' : 'قسط / بدهی / وام جدید'} onClose={() => setDebt(null)}>
      <Field label="عنوان"><input className="input" value={debt.title} onChange={(e) => setDebt({ ...debt, title: e.target.value })} /></Field>
      <Field label="نوع"><select className="input" value={debt.type} onChange={(e) => setDebt({ ...debt, type: e.target.value })}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="مبلغ کل"><MoneyField value={debt.total_amount} onChange={(v) => setDebt({ ...debt, total_amount: v })} /></Field>
      <Field label="مبلغ هر قسط"><MoneyField value={debt.installment_amount ?? ''} onChange={(v) => setDebt({ ...debt, installment_amount: v })} /></Field>
      <Field label="سررسید بعدی"><DateField allowEmpty value={debt.next_due_date} onChange={(v) => setDebt({ ...debt, next_due_date: v })} /></Field>
      <Field label="تعداد اقساط باقی‌مانده"><input type="number" min={0} className="input" value={debt.remaining_installments ?? ''} onChange={(e) => setDebt({ ...debt, remaining_installments: e.target.value === '' ? '' : +e.target.value })} /></Field>
      <div className="flex gap-2"><button className="btn btn-teal flex-1" disabled={!debt.title.trim() || debt.total_amount === ''} onClick={() => act(async () => { const b = { title: debt.title, type: debt.type, total_amount: debt.total_amount, installment_amount: debt.installment_amount || null, next_due_date: debt.next_due_date || null, remaining_installments: debt.remaining_installments === '' ? null : debt.remaining_installments };
        debt.id ? await api(`/debts/${debt.id}`, { method: 'PATCH', body: b }) : await api('/debts', { body: b }); setDebt(null); await reloadAll(); }, 'ذخیره شد')}>ذخیره</button>
        {debt.id && <button className="btn btn-danger" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/debts/${debt.id}`, { method: 'DELETE' }); setDebt(null); await reloadAll(); })}>حذف</button>}</div></Modal>}
    {budget && <Modal title={`بودجه‌ی ${MONTHS[ym.jm - 1]} ${fa(ym.jy)}`} onClose={() => setBudget(null)}>
      <Field label="دسته"><select className="input" value={budget.category} onChange={(e) => setBudget({ ...budget, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="سقف بودجه (تومان)"><MoneyField value={budget.amount} onChange={(v) => setBudget({ ...budget, amount: v })} /></Field>
      <button className="btn btn-teal w-full" disabled={budget.amount === ''} onClick={() => act(async () => { await api('/budgets', { method: 'PUT', body: { jy: ym.jy, jm: ym.jm, category: budget.category, amount: budget.amount } }); setBudget(null); await sum.reload(); }, 'بودجه ذخیره شد')}>ذخیره</button></Modal>}
  </div>;
}
