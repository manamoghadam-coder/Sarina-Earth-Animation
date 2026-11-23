import { useState } from 'react';
import { api } from '../api';
import { fmtDate } from '../jalali';
import { Empty, Field, Loading, useAction, useLoad } from '../ui';

/** Mana: nightly-reflection settings + questions, and read-only view of a child's diary and answers. */
export default function KidWritings({ kid, reload }: { kid: any; reload: () => Promise<void> }) {
  const act = useAction(); const qs = useLoad(() => api<any[]>('/reflection-questions'));
  const refl = useLoad(() => api<any[]>(`/reflection?user_id=${kid.id}`), [kid.id]); const diary = useLoad(() => api<any[]>(`/diary?user_id=${kid.id}`), [kid.id]);
  const [text, setText] = useState(''); const [forKid, setForKid] = useState(false); const [grat, setGrat] = useState(false);
  const mine = (qs.data ?? []).filter((q) => q.child_id === null || q.child_id === kid.id);
  const saveS = (patch: any) => act(async () => { await api(`/children/${kid.id}/settings`, { method: 'PATCH', body: patch }); await reload(); }, 'ذخیره شد');
  return <div className="space-y-3">
    <section className="card"><h2 className="font-bold mb-2">🌙 مرور شبانه‌ی {kid.display_name}</h2>
      <label className="flex items-center gap-2 py-1"><input type="checkbox" className="w-5 h-5" checked={kid.reflection_enabled} onChange={(e) => saveS({ reflection_enabled: e.target.checked })} />هر شب یادآوری و سؤال‌ها فعال باشد</label>
      <Field label="ساعت یادآوری شبانه (باید قبل از «ساعت سکوت» باشد)"><input type="time" className="input !w-40" defaultValue={String(kid.reflection_time).slice(0, 5)} onBlur={(e) => e.target.value && saveS({ reflection_time: e.target.value })} /></Field>
      <h3 className="font-bold mt-3 mb-1">سؤال‌ها</h3><Loading error={qs.error} loading={qs.loading} />
      {mine.map((q) => <div key={q.id} className="flex items-center gap-2 py-1 border-b border-slate-100 last:border-0">
        <input type="checkbox" className="w-5 h-5" aria-label="فعال" checked={q.active} onChange={(e) => act(async () => { await api(`/reflection-questions/${q.id}`, { method: 'PATCH', body: { active: e.target.checked } }); await qs.reload(); })} />
        <input className="input flex-1" defaultValue={q.text} onBlur={(e) => e.target.value.trim() && e.target.value !== q.text && act(async () => { await api(`/reflection-questions/${q.id}`, { method: 'PATCH', body: { text: e.target.value.trim() } }); await qs.reload(); }, 'ذخیره شد')} />
        <span className="text-xs text-slate-500 whitespace-nowrap">{q.kind === 'gratitude' ? '🤲 شکر · ' : ''}{q.child_id ? 'فقط ' + kid.display_name : 'همه'}</span>
        <button className="btn btn-ghost !px-2 !min-h-0" aria-label="حذف" onClick={() => confirm('این سؤال حذف شود؟') && act(async () => { await api(`/reflection-questions/${q.id}`, { method: 'DELETE' }); await qs.reload(); })}>🗑</button></div>)}
      <div className="mt-3 space-y-2"><input className="input" placeholder="سؤال تازه، مثلاً: امروز چه چیزی باعث افتخار تو شد؟" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
        <div className="flex gap-3 flex-wrap items-center text-sm"><label><input type="checkbox" checked={forKid} onChange={(e) => setForKid(e.target.checked)} /> فقط برای {kid.display_name}</label><label><input type="checkbox" checked={grat} onChange={(e) => setGrat(e.target.checked)} /> جمله‌ی شکرگزاری (آخر می‌آید)</label>
          <button className="btn btn-teal" disabled={!text.trim()} onClick={() => act(async () => { await api('/reflection-questions', { body: { text: text.trim(), child_id: forKid ? kid.id : null, kind: grat ? 'gratitude' : 'text', sort: 50 } }); setText(''); await qs.reload(); }, 'سؤال اضافه شد')}>＋ افزودن</button></div></div></section>
    <section className="card"><h2 className="font-bold mb-1">🌙 جواب‌های شبانه</h2><p className="text-xs text-slate-500 mb-2">فقط خواندنی. {kid.display_name} می‌داند که مامان می‌تواند بخواند.</p>
      <Loading error={refl.error} loading={refl.loading} />{refl.data?.length === 0 && <Empty>هنوز مروری ثبت نشده.</Empty>}
      {refl.data?.map((r) => <div key={r.id} className="border-b border-slate-100 py-2 last:border-0"><b>{fmtDate(r.day)}</b>
        {r.answers.filter((a: any) => a.a).map((a: any, i: number) => <p key={i} className="text-sm mt-1"><span className="text-slate-500">{a.kind === 'gratitude' ? '🤲 خدایا ازت سپاسگزارم که' : a.q}</span><br />{a.a}</p>)}</div>)}</section>
    <section className="card"><h2 className="font-bold mb-1">📖 دفترچه‌ی {kid.display_name}</h2><p className="text-xs text-slate-500 mb-2">فقط خواندنی؛ ویرایش یا حذف فقط با خود کودک است.</p>
      <Loading error={diary.error} loading={diary.loading} />{diary.data?.length === 0 && <Empty>هنوز چیزی ننوشته.</Empty>}
      {diary.data?.map((d) => <article key={d.id} className="border-b border-slate-100 py-2 last:border-0"><div className="flex items-center gap-2"><span className="text-xl">{d.mood ?? '📝'}</span><b className="flex-1">{d.title || 'بدون عنوان'}</b><span className="text-xs text-slate-500">{fmtDate(d.entry_date)}</span></div><p className="whitespace-pre-wrap text-sm mt-1">{d.body}</p></article>)}</section></div>;
}
