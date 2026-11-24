import { useState } from 'react';
import { api } from '../api';
import { useLevel } from '../auth';
import { fa, fmtDate, fmtTime, tehranToday } from '../jalali';
import { DateField, Empty, Field, Loading, Modal, ReadOnlyBanner, useAction, useLoad } from '../ui';

const KIND: Record<string, string> = { vaccine: '💉 واکسن', appointment: '🩺 قرار پزشک', checkup: '📋 چکاپ', dental: '🦷 دندان‌پزشک', other: '📌 سایر' };
export default function HealthPage() {
  const list = useLoad(() => api<any[]>('/health-records')); const people = useLoad(() => api<any[]>('/people')); const lv = useLevel('health'); const act = useAction(); const [e, setE] = useState<any | null>(null); const [showDone, setShowDone] = useState(false);
  const today = tehranToday(); const blank = (kind = 'appointment') => ({ kind, title: '', person_id: '', person_label: '', due_date: today, due_time: '', doctor: '', note: '' });
  const shown = (list.data ?? []).filter((x) => showDone || !x.done);
  return <div className="space-y-3"><ReadOnlyBanner module="health" /><div className="flex justify-between items-center flex-wrap gap-2"><h1 className="text-xl font-extrabold">🩺 سلامت خانواده</h1>
    {lv >= 2 && <div className="flex gap-1 flex-wrap">{Object.entries(KIND).slice(0, 4).map(([k, v]) => <button key={k} className="chip hover:bg-teal-soft !px-3 !py-1.5" onClick={() => setE(blank(k))}>{v}</button>)}<button className="btn btn-teal !py-1" onClick={() => setE(blank())}>＋ مورد جدید</button></div>}</div>
    <p className="text-xs text-slate-500">یادآوری خودکار: شب قبل (۱۸:۰۰) و صبح همان روز. این بخش فقط برای ثبت و یادآوری است و توصیه‌ی پزشکی نمی‌دهد.</p>
    <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={showDone} onChange={(x) => setShowDone(x.target.checked)} /> نمایش انجام‌شده‌ها</label>
    <Loading error={list.error} loading={list.loading} />{list.data && shown.length === 0 && <Empty>موردی ثبت نشده.</Empty>}
    {shown.map((x) => { const late = !x.done && x.due_date && x.due_date < today; return <div key={x.id} className={`card flex items-center gap-3 ${x.done ? 'opacity-60' : ''} ${late ? 'border-red-300' : ''}`}>
      <input type="checkbox" className="w-6 h-6" aria-label="انجام شد" checked={x.done} disabled={lv < 2} onChange={(ev) => act(async () => { await api(`/health-records/${x.id}/done`, { body: { done: ev.target.checked } }); await list.reload(); })} />
      <button className="flex-1 text-start" onClick={() => lv >= 2 && setE({ ...x, person_id: x.person_id ?? '', person_label: x.person_label ?? '', due_time: x.due_time ?? '', doctor: x.doctor ?? '', note: x.note ?? '' })}><b className={x.done ? 'line-through' : ''}>{x.title}</b> <span className="chip">{KIND[x.kind]}</span>
        <div className={`text-sm ${late ? 'text-red-600' : 'text-slate-500'}`}>{x.person_label ? `${x.person_label} · ` : ''}{x.due_date ? fmtDate(x.due_date) : 'بدون تاریخ'} {fmtTime(x.due_time)}{x.doctor ? ` · ${x.doctor}` : ''}</div>{x.note && <div className="text-xs text-slate-500">{x.note}</div>}</button></div>; })}
    {e && <Modal title={e.id ? 'ویرایش' : 'مورد سلامت جدید'} onClose={() => setE(null)}>
      <Field label="عنوان (مثلاً واکسن کزاز، چکاپ سالانه)"><input className="input" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="نوع"><select className="input" value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="برای چه کسی"><select className="input" value={e.person_id} onChange={(x) => { const p = people.data?.find((z) => z.id === x.target.value); setE({ ...e, person_id: x.target.value, person_label: p?.display_name ?? '' }); }}><option value="">—</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></Field></div>
      <Field label="تاریخ"><DateField allowEmpty value={e.due_date} onChange={(v) => setE({ ...e, due_date: v })} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="ساعت (اختیاری)"><input type="time" className="input" value={e.due_time} onChange={(x) => setE({ ...e, due_time: x.target.value })} /></Field><Field label="پزشک / مرکز"><input className="input" value={e.doctor} onChange={(x) => setE({ ...e, doctor: x.target.value })} /></Field></div>
      <Field label="یادداشت"><input className="input" value={e.note} onChange={(x) => setE({ ...e, note: x.target.value })} /></Field>
      <div className="flex gap-2"><button className="btn btn-teal flex-1" disabled={!e.title.trim()} onClick={() => act(async () => { const b = { title: e.title, kind: e.kind, person_id: e.person_id || null, person_label: e.person_label || null, due_date: e.due_date ?? null, due_time: e.due_time || null, doctor: e.doctor || null, note: e.note || null };
        e.id ? await api(`/health-records/${e.id}`, { method: 'PATCH', body: b }) : await api('/health-records', { body: b }); setE(null); await list.reload(); }, 'ذخیره شد')}>ذخیره</button>
        {e.id && <button className="btn btn-danger" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/health-records/${e.id}`, { method: 'DELETE' }); setE(null); await list.reload(); })}>حذف</button>}</div></Modal>}</div>;
}
void fa;
