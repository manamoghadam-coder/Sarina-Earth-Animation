import { Link } from 'react-router-dom';
import { api } from '../api';
import { fa, fmtDate, fmtInstant, fmtTime, money } from '../jalali';
import { Loading, useAction, useLoad } from '../ui';

const pr = ['', '🔴 مهم', '🟡 متوسط', '🟢 کم'];
export default function Dashboard() {
  const { data: d, error, loading, reload } = useLoad(() => api('/dashboard'));
  const act = useAction();
  if (!d) return <Loading error={error} loading={loading} />;
  const hour = Number(d.time.slice(0, 2)); const greet = hour < 12 ? 'صبح بخیر' : hour < 18 ? 'عصر بخیر' : 'شب بخیر';
  return <div className="space-y-4">
    <header><p className="text-slate-500">{greet}، مانا</p><h1 className="text-2xl font-extrabold">{d.today_fa}</h1></header>
    {d.pending_completions.length > 0 && <section className="card border-amber-300 bg-amber-50"><h2 className="font-bold mb-2">⭐ در انتظار تأیید شما ({fa(d.pending_completions.length)})</h2>
      {d.pending_completions.map((c: any) => <div key={c.id} className="flex items-center justify-between py-1"><span>{c.child}: {c.title}</span>
        <span className="flex gap-2"><button className="btn btn-teal !py-1" onClick={() => act(async () => { await api(`/completions/${c.id}/decide`, { body: { approve: true } }); await reload(); }, 'تأیید شد')}>تأیید</button>
          <button className="btn btn-ghost !py-1" onClick={() => act(async () => { await api(`/completions/${c.id}/decide`, { body: { approve: false } }); await reload(); })}>رد</button></span></div>)}</section>}
    <div className="grid md:grid-cols-2 gap-4">
      <section className="card"><h2 className="font-bold mb-2">📌 کارهای مهم</h2>
        {d.important.length === 0 ? <p className="text-slate-500">کار بازی ثبت نشده.</p> : d.important.map((t: any) => <div key={t.id} className="flex justify-between py-1 border-b border-slate-100 last:border-0"><span>{t.title}</span><span className="chip">{pr[t.priority]}</span></div>)}
        <Link to="/tasks" className="text-teal-700 text-sm">همه‌ی کارها ←</Link></section>
      <section className="card"><h2 className="font-bold mb-2">⏰ امروز و عقب‌افتاده</h2>
        {d.overdue.map((t: any) => <div key={t.id} className="text-red-700 py-1">⚠️ {t.title} <span className="text-xs">({fmtDate(t.due_date, false)})</span></div>)}
        {d.todayTasks.map((t: any) => <div key={t.id} className="py-1">• {t.title} {t.due_time && fmtTime(t.due_time)}</div>)}
        {!d.overdue.length && !d.todayTasks.length && <p className="text-slate-500">موردی برای امروز نیست 🎉</p>}</section>
      <section className="card"><h2 className="font-bold mb-2">📅 جلسات و قرارها (۷ روز آینده)</h2>
        {d.events.length === 0 ? <p className="text-slate-500">رویدادی نیست.</p> : d.events.map((e: any) => { const x = fmtInstant(e.starts_at); return <div key={e.id} className="py-1">{e.title} — <span className="text-slate-600">{fmtDate(x.date)} {fa(x.time)}</span></div>; })}</section>
      <section className="card"><h2 className="font-bold mb-2">💰 وضعیت مالی ماه</h2>
        <div className="grid grid-cols-3 text-center gap-2"><div><div className="text-xs text-slate-500">درآمد</div><b className="text-teal-700">{money(d.finance.income)}</b></div><div><div className="text-xs text-slate-500">هزینه</div><b className="text-red-600">{money(d.finance.expense)}</b></div><div><div className="text-xs text-slate-500">مانده نقدینگی</div><b>{money(d.finance.balance)}</b></div></div>
        {d.dues.map((x: any) => <div key={x.id} className="text-amber-700 text-sm mt-2">💳 {x.title} — سررسید {fmtDate(x.next_due_date, false)}</div>)}<Link to="/finance" className="text-teal-700 text-sm">مدیریت مالی ←</Link></section>
      <section className="card"><h2 className="font-bold mb-2">🌱 عادت‌های امروز</h2>
        {d.habits.length === 0 ? <p className="text-slate-500">عادتی تعریف نشده (بخش اهداف).</p> : d.habits.map((h: any) => <label key={h.id} className="flex items-center gap-2 py-1"><input type="checkbox" className="w-5 h-5" checked={h.done} onChange={(e) => act(async () => { await api(`/habits/${h.id}/log`, { method: 'PUT', body: { day: d.today, done: e.target.checked } }); await reload(); })} />{h.title}</label>)}</section>
      <section className="card"><h2 className="font-bold mb-2">📊 گزارش هفتگی</h2>
        <p>کار انجام‌شده در ۷ روز: <b>{fa(d.weekly.tasks_done)}</b></p><p>کار باز: <b>{fa(d.weekly.tasks_open)}</b></p><p>هزینه‌ی ۷ روز اخیر: <b>{money(d.weekly.spend)}</b> تومان</p></section>
    </div></div>;
}
