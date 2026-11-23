import { useMemo, useState } from 'react';
import { api } from '../api';
import { MONTHS, WEEKDAYS, addDays, fa, fmtDate, fmtInstant, isoFromJ, jmLen, parts, tehranIso, tehranToday, wd } from '../jalali';
import { DateField, Field, Modal, useAction, useLoad , ReadOnlyBanner } from '../ui';
import FamilyDates, { FD_ICON } from './FamilyDates';
import { useAuth } from '../auth';

const KIND: Record<string, string> = { meeting: 'جلسه', family: 'خانوادگی', birthday: 'تولد', occasion: 'مناسبت', other: 'سایر' };
export default function CalendarPage() {
  const today = tehranToday(); const t = parts(today);
  const [ym, setYm] = useState({ jy: t.jy, jm: t.jm }); const [view, setView] = useState<'month' | 'week'>('month'); const [sel, setSel] = useState(today); const [edit, setEdit] = useState<any | null>(null); const act = useAction();
  const events = useLoad(() => api<any[]>('/events')); const tasks = useLoad(() => api<any[]>('/tasks')); const debts = useLoad(() => api<any[]>('/debts')); const fds = useLoad(() => api<any[]>('/family-dates')); const { me } = useAuth();
  const byDay = useMemo(() => {
    const m: Record<string, { label: string; kind: string }[]> = {}; const add = (d: string, label: string, kind: string) => (m[d] ||= []).push({ label, kind });
    events.data?.forEach((e) => { const x = fmtInstant(e.starts_at); add(x.date, `${fa(x.time)} ${e.title}`, 'event'); });
    tasks.data?.filter((x) => x.due_date && !['done', 'cancelled'].includes(x.status)).forEach((x) => add(x.due_date, `✅ ${x.title}`, 'task'));
    debts.data?.filter((x) => x.next_due_date && x.status === 'open').forEach((x) => add(x.next_due_date, `💳 ${x.title}`, 'debt'));
    fds.data?.forEach((f) => { for (const jy of new Set([t.jy - 1, t.jy, t.jy + 1, ym.jy])) add(isoFromJ(jy, f.jm, Math.min(f.jd, jmLen(jy, f.jm))), `${FD_ICON[f.kind]} ${f.title}`, 'fd'); });
    return m;
  }, [events.data, tasks.data, debts.data, fds.data, ym.jy]);
  const first = isoFromJ(ym.jy, ym.jm, 1); const lead = wd(first); const len = jmLen(ym.jy, ym.jm);
  const step = (n: number) => { let m = ym.jm + n, y = ym.jy; if (m > 12) { m = 1; y++; } if (m < 1) { m = 12; y--; } setYm({ jy: y, jm: m }); };
  const weekStart = addDays(sel, -wd(sel));
  const dayCell = (iso: string, label: string | number, dim = false) => <button key={iso} onClick={() => setSel(iso)} className={`min-h-16 rounded-xl border p-1 text-start ${iso === sel ? 'border-teal-mana bg-teal-soft' : 'border-slate-200 bg-white'} ${iso === today ? 'ring-2 ring-navy-800' : ''} ${dim ? 'opacity-50' : ''}`}>
    <div className="text-sm font-bold">{fa(label)}</div>{(byDay[iso] ?? []).slice(0, 2).map((x, i) => <div key={i} className="text-[10px] truncate">{x.label}</div>)}{(byDay[iso]?.length ?? 0) > 2 && <div className="text-[10px] text-slate-500">+{fa(byDay[iso].length - 2)}</div>}</button>;
  return <div><ReadOnlyBanner module="events" />
    <div className="flex items-center justify-between mb-3 flex-wrap gap-2"><h1 className="text-xl font-extrabold">تقویم</h1><div className="flex gap-2"><button className={`btn ${view === 'month' ? '' : 'btn-ghost'}`} onClick={() => setView('month')}>ماهانه</button><button className={`btn ${view === 'week' ? '' : 'btn-ghost'}`} onClick={() => setView('week')}>هفتگی</button>
      <button className="btn btn-teal" onClick={() => setEdit({ title: '', kind: 'meeting', date: sel, time: '10:00', remind: 30 })}>＋ رویداد</button></div></div>
    {view === 'month' ? <>
      <div className="flex items-center justify-between mb-2"><button className="btn btn-ghost" onClick={() => step(-1)} aria-label="ماه قبل">›</button><b>{MONTHS[ym.jm - 1]} {fa(ym.jy)}</b><button className="btn btn-ghost" onClick={() => step(1)} aria-label="ماه بعد">‹</button></div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500 mb-1">{WEEKDAYS.map((w) => <div key={w}>{w.slice(0, 3)}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">{Array.from({ length: lead }, (_, i) => <div key={'e' + i} />)}{Array.from({ length: len }, (_, i) => dayCell(isoFromJ(ym.jy, ym.jm, i + 1), i + 1))}</div></>
      : <div className="grid grid-cols-7 gap-1">{Array.from({ length: 7 }, (_, i) => { const iso = addDays(weekStart, i); return <div key={iso}><div className="text-xs text-center text-slate-500">{WEEKDAYS[i]}</div>{dayCell(iso, parts(iso).jd)}</div>; })}</div>}
    <section className="card mt-4"><h2 className="font-bold mb-2">{fmtDate(sel)}</h2>
      {(byDay[sel] ?? []).length === 0 ? <p className="text-slate-500">موردی نیست.</p> : byDay[sel].map((x, i) => <div key={i} className="py-1">{x.label}</div>)}
      {events.data?.filter((e) => fmtInstant(e.starts_at).date === sel).map((e) => { const x = fmtInstant(e.starts_at); return <div key={e.id} className="flex justify-between items-center border-t border-slate-100 mt-2 pt-2"><span>{e.title} <span className="chip">{KIND[e.kind]}</span> {fa(x.time)}</span>
        <span className="flex gap-1"><button className="btn btn-ghost !py-1" onClick={() => setEdit({ id: e.id, title: e.title, kind: e.kind, date: x.date, time: x.time, remind: e.remind_minutes?.[0] ?? 30 })}>ویرایش</button>
          <button className="btn btn-ghost !py-1" aria-label="حذف" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/events/${e.id}`, { method: 'DELETE' }); await events.reload(); })}>🗑</button></span></div>; })}</section>
    <FamilyDates dates={fds.data ?? []} reload={fds.reload} canWrite={me!.role === 'parent'} />
    {edit && <Modal title={edit.id ? 'ویرایش رویداد' : 'رویداد جدید'} onClose={() => setEdit(null)}>
      <Field label="عنوان"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
      <Field label="نوع"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="تاریخ"><DateField value={edit.date} onChange={(v) => setEdit({ ...edit, date: v ?? edit.date })} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="ساعت"><input type="time" className="input" value={edit.time} onChange={(e) => setEdit({ ...edit, time: e.target.value })} /></Field>
        <Field label="یادآوری (دقیقه قبل)"><input type="number" min={0} className="input" value={edit.remind} onChange={(e) => setEdit({ ...edit, remind: +e.target.value })} /></Field></div>
      <button className="btn btn-teal w-full" disabled={!edit.title.trim() || !edit.time} onClick={() => act(async () => { const b = { title: edit.title, kind: edit.kind, starts_at: tehranIso(edit.date, edit.time), remind_minutes: [edit.remind] };
        edit.id ? await api(`/events/${edit.id}`, { method: 'PATCH', body: b }) : await api('/events', { body: b }); setEdit(null); await events.reload(); }, 'ذخیره شد')}>ذخیره</button></Modal>}
  </div>;
}
