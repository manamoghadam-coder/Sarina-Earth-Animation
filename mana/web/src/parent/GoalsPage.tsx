import { useState } from 'react';
import { api } from '../api';
import { addDays, fa, fmtDate, tehranToday, wd, WEEKDAYS } from '../jalali';
import { DateField, Empty, Field, Loading, Modal, useAction, useLoad , ReadOnlyBanner } from '../ui';

const HZ: Record<string, string> = { short: 'کوتاه‌مدت', long: 'بلندمدت', learning: 'یادگیری' };
export default function GoalsPage() {
  const goals = useLoad(() => api<any[]>('/goals')); const habits = useLoad(() => api<any[]>('/habits')); const today = tehranToday(); const from = addDays(today, -6);
  const logs = useLoad(() => api<{ habit_id: string; day: string }[]>(`/habits/logs?from=${from}&to=${today}`)); const act = useAction();
  const [g, setG] = useState<any | null>(null); const [h, setH] = useState('');
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)); const has = (hid: string, d: string) => logs.data?.some((l) => l.habit_id === hid && l.day === d);
  return <div className="space-y-4"><ReadOnlyBanner module="goals" /><div className="flex justify-between items-center"><h1 className="text-xl font-extrabold">اهداف و عادت‌ها</h1><button className="btn btn-teal" onClick={() => setG({ title: '', horizon: 'short', progress: 0, target_date: null })}>＋ هدف</button></div>
    <Loading error={goals.error} loading={goals.loading} />
    <section className="space-y-2">{goals.data?.length === 0 && <Empty>هدفی ثبت نشده.</Empty>}{goals.data?.map((x) => <button key={x.id} onClick={() => setG({ ...x })} className="card w-full text-start"><div className="flex justify-between"><b>{x.title}</b><span className="chip">{HZ[x.horizon]}{x.status !== 'active' ? ' — ' + (x.status === 'done' ? 'انجام‌شده' : 'رها شده') : ''}</span></div>
      <div className="h-2 bg-slate-100 rounded-full mt-2"><div className="h-2 rounded-full bg-teal-mana" style={{ width: `${x.progress}%` }} /></div><div className="text-xs text-slate-500 mt-1">{fa(x.progress)}٪ {x.target_date && `— تا ${fmtDate(x.target_date, false)}`}</div></button>)}</section>
    <section className="card"><h2 className="font-bold mb-2">🌱 عادت‌های روزانه (۷ روز اخیر)</h2>
      <div className="overflow-x-auto"><table className="w-full text-center text-sm"><thead><tr><th className="text-start">عادت</th>{days.map((d) => <th key={d} className="font-normal text-xs">{WEEKDAYS[wd(d)].slice(0, 2)}</th>)}<th /></tr></thead>
        <tbody>{habits.data?.map((x) => <tr key={x.id}><td className="text-start py-1">{x.title}</td>{days.map((d) => <td key={d}><input type="checkbox" className="w-5 h-5" aria-label={`${x.title} ${d}`} checked={!!has(x.id, d)} onChange={(e) => act(async () => { await api(`/habits/${x.id}/log`, { method: 'PUT', body: { day: d, done: e.target.checked } }); await logs.reload(); })} /></td>)}
          <td><button className="text-red-600" aria-label="حذف" onClick={() => confirm('عادت حذف شود؟') && act(async () => { await api(`/habits/${x.id}`, { method: 'DELETE' }); await habits.reload(); })}>🗑</button></td></tr>)}</tbody></table></div>
      <div className="flex gap-2 mt-3"><input className="input" placeholder="عادت جدید" value={h} onChange={(e) => setH(e.target.value)} /><button className="btn btn-teal" disabled={!h.trim()} onClick={() => act(async () => { await api('/habits', { body: { title: h } }); setH(''); await habits.reload(); })}>افزودن</button></div></section>
    {g && <Modal title={g.id ? 'ویرایش هدف' : 'هدف جدید'} onClose={() => setG(null)}>
      <Field label="عنوان"><input className="input" value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} /></Field>
      <Field label="نوع"><select className="input" value={g.horizon} onChange={(e) => setG({ ...g, horizon: e.target.value })}>{Object.entries(HZ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label={`پیشرفت: ${fa(g.progress)}٪`}><input type="range" min={0} max={100} step={5} className="w-full" value={g.progress} onChange={(e) => setG({ ...g, progress: +e.target.value })} /></Field>
      <Field label="تاریخ هدف"><DateField allowEmpty value={g.target_date} onChange={(v) => setG({ ...g, target_date: v })} /></Field>
      <Field label="وضعیت"><select className="input" value={g.status ?? 'active'} onChange={(e) => setG({ ...g, status: e.target.value })}><option value="active">فعال</option><option value="done">انجام‌شده</option><option value="dropped">رها شده</option></select></Field>
      <div className="flex gap-2"><button className="btn btn-teal flex-1" disabled={!g.title.trim()} onClick={() => act(async () => { const b = { title: g.title, horizon: g.horizon, progress: g.progress, target_date: g.target_date ?? null, status: g.status ?? 'active' }; g.id ? await api(`/goals/${g.id}`, { method: 'PATCH', body: b }) : await api('/goals', { body: b }); setG(null); await goals.reload(); }, 'ذخیره شد')}>ذخیره</button>
        {g.id && <button className="btn btn-danger" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/goals/${g.id}`, { method: 'DELETE' }); setG(null); await goals.reload(); })}>حذف</button>}</div></Modal>}
  </div>;
}
