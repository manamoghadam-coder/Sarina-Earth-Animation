import { useState } from 'react';
import { api } from '../api';
import { Empty, useAction, useLoad } from '../ui';

const G: Record<string, string> = { young: 'سامان (کودک ۷ ساله)', teen: 'سارینا (نوجوان)', adult: 'بزرگ‌ترها' };
/** Mana edits the pool of daily motivational sentences; each person sees one per day from their age group. */
export function QuotesPanel() {
  const q = useLoad(() => api<any[]>('/quotes')); const act = useAction(); const [g, setG] = useState('young'); const [text, setText] = useState(''); const [open, setOpen] = useState(false);
  const list = (q.data ?? []).filter((x) => x.age_group === g);
  return <section className="card"><h2 className="font-bold mb-1">✨ جمله‌های انگیزشی روزانه</h2><p className="text-sm text-slate-500 mb-2">هر روز یک جمله از فهرست هر گروه نمایش داده می‌شود. می‌توانید جمله‌ی خودتان را اضافه کنید یا جمله‌ای را غیرفعال/حذف کنید.</p>
    <div className="flex gap-1 flex-wrap mb-2">{Object.entries(G).map(([k, t]) => <button key={k} className={`btn !py-1 ${g === k ? '' : 'btn-ghost'}`} onClick={() => setG(k)}>{t} ({(q.data ?? []).filter((x) => x.age_group === k).length})</button>)}</div>
    <div className="flex gap-2 mb-2"><input className="input" placeholder="جمله‌ی جدید" value={text} onChange={(e) => setText(e.target.value)} /><button className="btn btn-teal" disabled={!text.trim()} onClick={() => act(async () => { await api('/quotes', { body: { age_group: g, text } }); setText(''); await q.reload(); }, 'اضافه شد')}>＋</button></div>
    <button className="text-sm underline mb-2" onClick={() => setOpen(!open)}>{open ? 'بستن فهرست' : 'نمایش فهرست'}</button>
    {open && (list.length === 0 ? <Empty>جمله‌ای نیست.</Empty> : <div className="max-h-72 overflow-auto">{list.map((x) => <div key={x.id} className={`flex items-center gap-2 py-1 border-b border-slate-100 ${x.active ? '' : 'opacity-40'}`}><span className="flex-1 text-sm">{x.text}</span>
      <button className="text-xs underline" onClick={() => act(async () => { await api(`/quotes/${x.id}`, { method: 'PATCH', body: { active: !x.active } }); await q.reload(); })}>{x.active ? 'غیرفعال' : 'فعال'}</button><button aria-label="حذف" onClick={() => act(async () => { await api(`/quotes/${x.id}`, { method: 'DELETE' }); await q.reload(); })}>🗑</button></div>)}</div>)}</section>;
}
