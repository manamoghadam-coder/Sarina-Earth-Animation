import { useState } from 'react';
import { api } from '../api';
import { Empty, Field, useAction, useLoad } from '../ui';

const G: Record<string, string> = { young: 'سامان (۷ ساله)', teen: 'سارینا (۱۳ ساله)', adult: 'بزرگ‌ترها' };
/** Mana manages daily facts and financial-literacy lessons (own content can be added; starter content can be disabled). */
export function ContentPanel() {
  const facts = useLoad(() => api<any[]>('/facts')); const lessons = useLoad(() => api<any[]>('/lessons')); const act = useAction();
  const [g, setG] = useState('young'); const [f, setF] = useState({ topic: 'general', title: '', body: '' }); const [show, setShow] = useState(false);
  const [l, setL] = useState({ title: '', body: '', question: '', options: ['', '', ''], correct: 0 });
  return <section className="card"><h2 className="font-bold mb-1">🧠 دانستنی‌ها و درس‌های سواد مالی</h2>
    <p className="text-sm text-slate-500 mb-2">هر روز یک دانستنی از فهرست گروه سنی هر بچه نمایش داده می‌شود. می‌توانید مورد خودتان را اضافه کنید (متن انگلیسی هم مجاز است و با صدای انگلیسی خوانده می‌شود).</p>
    <div className="flex gap-1 flex-wrap mb-2">{Object.entries(G).map(([k, t]) => <button key={k} className={`btn !py-1 ${g === k ? '' : 'btn-ghost'}`} onClick={() => setG(k)}>{t} ({(facts.data ?? []).filter((x) => x.age_group === k).length})</button>)}</div>
    <Field label="عنوان"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
    <Field label="متن کوتاه"><textarea className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
    <div className="flex gap-2 items-end"><Field label="موضوع"><input className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="animals, english, ..." dir="ltr" /></Field>
      <button className="btn btn-teal mb-3" disabled={!f.title.trim() || !f.body.trim()} onClick={() => act(async () => { await api('/facts', { body: { age_group: g, topic: f.topic || 'general', title: f.title, body: f.body } }); setF({ ...f, title: '', body: '' }); await facts.reload(); }, 'اضافه شد')}>＋ دانستنی</button></div>
    <button className="text-sm underline mb-2" onClick={() => setShow(!show)}>{show ? 'بستن فهرست' : 'نمایش فهرست'}</button>
    {show && <div className="max-h-72 overflow-auto">{(facts.data ?? []).filter((x) => x.age_group === g).map((x) => <div key={x.id} className={`flex items-center gap-2 py-1 border-b border-slate-100 ${x.active ? '' : 'opacity-40'}`}><span className="flex-1 text-sm"><b>{x.title}</b> — {x.body}</span>
      <button className="text-xs underline" onClick={() => act(async () => { await api(`/facts/${x.id}`, { method: 'PATCH', body: { active: !x.active } }); await facts.reload(); })}>{x.active ? 'غیرفعال' : 'فعال'}</button><button aria-label="حذف" onClick={() => act(async () => { await api(`/facts/${x.id}`, { method: 'DELETE' }); await facts.reload(); })}>🗑</button></div>)}</div>}
    <h3 className="font-bold mt-4 mb-1">درس سواد مالی جدید ({g === 'adult' ? 'ویژه‌ی کودکان' : G[g]})</h3>
    {g === 'adult' ? <Empty>درس‌ها فقط برای سامان و سارینا هستند.</Empty> : <>
      <Field label="عنوان درس"><input className="input" value={l.title} onChange={(e) => setL({ ...l, title: e.target.value })} /></Field>
      <Field label="متن درس"><textarea className="input" rows={3} value={l.body} onChange={(e) => setL({ ...l, body: e.target.value })} /></Field>
      <Field label="سؤال"><input className="input" value={l.question} onChange={(e) => setL({ ...l, question: e.target.value })} /></Field>
      {l.options.map((o, i) => <div key={i} className="flex gap-2 mb-2 items-center"><input type="radio" name="correct" className="w-5 h-5" checked={l.correct === i} onChange={() => setL({ ...l, correct: i })} aria-label="پاسخ درست" /><input className="input" placeholder={`گزینه ${i + 1}${l.correct === i ? ' (درست)' : ''}`} value={o} onChange={(e) => setL({ ...l, options: l.options.map((z, j) => (j === i ? e.target.value : z)) })} /></div>)}
      <button className="btn btn-teal" disabled={!l.title.trim() || !l.body.trim() || !l.question.trim() || l.options.filter((o) => o.trim()).length < 2 || !l.options[l.correct].trim()} onClick={() => act(async () => { const opts = l.options.filter((o) => o.trim()); const correctText = l.options[l.correct]; await api('/lessons', { body: { age_group: g, position: (lessons.data ?? []).filter((x) => x.age_group === g).length, title: l.title, body: l.body, question: l.question, options: opts, correct: opts.indexOf(correctText) } }); setL({ title: '', body: '', question: '', options: ['', '', ''], correct: 0 }); await lessons.reload(); }, 'درس اضافه شد')}>＋ درس</button></>}
    <p className="text-xs text-slate-500 mt-2">درس‌های فعلی: {(lessons.data ?? []).filter((x) => x.age_group === g).map((x) => x.title).join('، ') || '—'}</p></section>;
}
