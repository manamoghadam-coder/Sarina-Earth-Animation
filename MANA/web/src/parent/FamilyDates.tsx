import { useState } from 'react';
import { api } from '../api';
import { MONTHS, fa } from '../jalali';
import { Field, useAction } from '../ui';

export const FD_ICON: Record<string, string> = { birthday: '🎂', anniversary: '💍', occasion: '🎉', holiday: '🏳️' };
const KINDS: Record<string, string> = { birthday: 'تولد', anniversary: 'سالگرد', occasion: 'مناسبت', holiday: 'تعطیلی/مناسبت رسمی' };
/** Annual (Jalali) dates: birthdays, anniversaries, occasions + fixed solar official holidays. Lunar holidays are NOT included (they move every year) — add by hand. */
export default function FamilyDates({ dates, reload, canWrite }: { dates: any[]; reload: () => Promise<void>; canWrite: boolean }) {
  const act = useAction(); const [d, setD] = useState({ title: '', kind: 'birthday', jm: 1, jd: 1 }); const [open, setOpen] = useState(false);
  const sorted = [...dates].sort((a, b) => a.jm - b.jm || a.jd - b.jd);
  return <section className="card mt-4"><div className="flex justify-between items-center"><h2 className="font-bold">🎂 مناسبت‌های سالانه</h2><button className="btn btn-ghost !py-1" onClick={() => setOpen(!open)}>{open ? 'بستن' : 'نمایش'}</button></div>
    {open && <><p className="text-xs text-slate-500 my-2">تولد و مناسبت‌های ثبت‌شده هر سال خودکار روی تقویم می‌آیند و در همان روز (و ۳ روز قبل برای بزرگسالان) اعلان می‌گیرند. فقط تعطیلات ثابت شمسی پیش‌فرض دارند؛ مناسبت‌های قمری (مثل عید فطر) هر سال جابه‌جا می‌شوند و باید دستی اضافه شوند.</p>
      {canWrite && <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end mb-3"><Field label="عنوان"><input className="input" value={d.title} maxLength={100} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="تولد سارینا" /></Field>
        <Field label="نوع"><select className="input" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="ماه"><select className="input" value={d.jm} onChange={(e) => setD({ ...d, jm: +e.target.value })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
        <Field label="روز"><select className="input" value={d.jd} onChange={(e) => setD({ ...d, jd: +e.target.value })}>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{fa(i + 1)}</option>)}</select></Field>
        <button className="btn btn-teal mb-3" disabled={!d.title.trim()} onClick={() => act(async () => { await api('/family-dates', { body: { ...d, title: d.title.trim() } }); setD({ ...d, title: '' }); await reload(); }, 'اضافه شد')}>＋ افزودن</button></div>}
      {sorted.map((x) => <div key={x.id} className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-0"><span>{FD_ICON[x.kind]}</span><span className="flex-1">{x.title}</span><span className="text-sm text-slate-500">{fa(x.jd)} {MONTHS[x.jm - 1]}</span>
        {canWrite && !x.official && <button className="btn btn-ghost !px-2 !min-h-0" aria-label="حذف" onClick={() => confirm('حذف شود؟') && act(async () => { await api(`/family-dates/${x.id}`, { method: 'DELETE' }); await reload(); })}>🗑</button>}</div>)}</>}</section>;
}
