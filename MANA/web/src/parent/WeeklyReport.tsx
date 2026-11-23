import { useState } from 'react';
import { api } from '../api';
import { addDays, fa, fmtDate, money, tehranToday, wd } from '../jalali';
import { Empty, Loading, useLoad } from '../ui';

const Stat = ({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) => <div className="rounded-2xl bg-slate-50 p-3 text-center"><div className="text-2xl">{icon}</div><div className="text-xl font-extrabold">{value}</div><div className="text-xs text-slate-500">{label}</div>{sub && <div className="text-[11px] text-slate-400">{sub}</div>}</div>;
const List = ({ title, items }: { title: string; items: { day: string; text: string }[] }) => items.length ? <div className="mt-2"><div className="text-sm font-bold">{title}</div>{items.map((x, i) => <p key={i} className="text-sm text-slate-700">• <span className="text-xs text-slate-400">{fmtDate(x.day, false)}:</span> {x.text}</p>)}</div> : null;

/** Weekly family report (Saturday–Friday), rule-based. Mana only. */
export default function WeeklyReport() {
  const [ws, setWs] = useState(addDays(tehranToday(), -wd(tehranToday())));
  const r = useLoad(() => api<any>(`/reports/weekly?week_start=${ws}`), [ws]); const d = r.data;
  return <div className="space-y-4 max-w-3xl">
    <div className="flex items-center justify-between gap-2 flex-wrap print:hidden"><h1 className="text-xl font-extrabold">📊 گزارش هفتگی خانواده</h1>
      <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setWs(addDays(ws, -7))} aria-label="هفته‌ی قبل">›</button><button className="btn btn-ghost" onClick={() => setWs(addDays(tehranToday(), -wd(tehranToday())))}>این هفته</button>
        <button className="btn btn-ghost" onClick={() => setWs(addDays(ws, 7))} aria-label="هفته‌ی بعد">‹</button><button className="btn" onClick={() => window.print()}>🖨 چاپ / PDF</button></div></div>
    <Loading error={r.error} loading={r.loading} />
    {d && <>
      <p className="text-slate-500">{d.week_fa} · {fa(d.days)} روز گذشته از هفته</p>
      <section className="card border-amber-300 bg-amber-50"><h2 className="font-bold mb-2">✨ نکته‌های این هفته</h2>{d.highlights.map((h: string, i: number) => <p key={i} className="py-0.5">• {h}</p>)}<p className="text-xs text-slate-500 mt-2">{d.note}</p></section>
      {d.kids.map((k: any) => <section key={k.id} className="card"><h2 className="font-bold mb-2">🧒 {k.name}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat icon="✅" label="فعالیت تأییدشده" value={`${fa(k.approved)} از ${fa(k.planned)}`} sub={k.rate !== null ? `${fa(k.rate)}٪` : undefined} /><Stat icon="⭐" label="ستاره‌ی این هفته" value={fa(k.stars_earned)} sub={k.stars_spent ? `خرج‌شده ${fa(k.stars_spent)}` : undefined} />
          <Stat icon="🌙" label="شب‌های مرور شبانه" value={k.reflection_enabled ? fa(k.reflection_days) : '—'} /><Stat icon="📖" label="نوشته‌ی دفترچه" value={fa(k.diary_entries)} /></div>
        {Object.keys(k.moods).length > 0 && <p className="mt-2 text-sm">حال و هوای دفترچه: {Object.entries(k.moods).map(([m, n]) => `${m} ×${fa(n as number)}`).join('  ')}</p>}
        <List title="😊 چه چیزی خوشحالش کرد" items={k.happy} /><List title="😟 چه چیزی ناراحتش کرد" items={k.sad} /><List title="💡 چه چیز جدیدی یاد گرفت" items={k.learned} /><List title="🤝 کار خوب" items={k.helped} /><List title="🤲 سپاسگزاری" items={k.gratitude} />
        {k.wishes_achieved.length > 0 && <p className="mt-2 text-emerald-700">🎉 به آرزوی {k.wishes_achieved.map((x: string) => `«${x}»`).join('، ')} رسید.</p>}
        {k.badges.length > 0 && <p className="mt-1">🏅 مدال: {k.badges.map((b: any) => `${b.icon} ${b.title}`).join('، ')}</p>}</section>)}
      {d.kids.length === 0 && <Empty>کودکی ثبت نشده.</Empty>}
      <section className="card"><h2 className="font-bold mb-2">🏠 خانواده</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><Stat icon="✅" label="کار انجام‌شده" value={fa(d.family.tasks.done)} sub={d.family.tasks.overdue ? `${fa(d.family.tasks.overdue)} عقب‌افتاده` : undefined} /><Stat icon="💰" label="هزینه" value={money(d.family.finance.expense)} sub={d.family.finance.prev_expense ? `هفته‌ی قبل ${money(d.family.finance.prev_expense)}` : undefined} />
          <Stat icon="📥" label="درآمد" value={money(d.family.finance.income)} /><Stat icon="💌" label="پیام مامان" value={`${fa(d.family.mom_messages.read)}/${fa(d.family.mom_messages.sent)}`} sub="خوانده/فرستاده" /></div>
        {d.family.finance.top_categories.length > 0 && <p className="mt-2 text-sm">بیشترین هزینه: {d.family.finance.top_categories.map((c: any) => `${c.category} (${money(c.total)})`).join('، ')}</p>}
        {d.family.next_events.length > 0 && <div className="mt-2 text-sm"><b>هفته‌ی آینده:</b> {d.family.next_events.map((e: any) => e.title).join('، ')}</div>}
        {d.family.next_debts.length > 0 && <div className="mt-1 text-sm"><b>اقساط هفته‌ی آینده:</b> {d.family.next_debts.map((e: any) => `${e.title} (${fmtDate(e.next_due_date, false)})`).join('، ')}</div>}
        <p className="text-xs text-slate-400 mt-2">پیام‌های گروه چت این هفته: {fa(d.family.chat_group_messages)} (محتوای چت در گزارش نمی‌آید)</p></section></>}
  </div>;
}
