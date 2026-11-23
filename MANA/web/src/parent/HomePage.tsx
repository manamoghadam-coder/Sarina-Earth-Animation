import { useState } from 'react';
import { api } from '../api';
import { WEEKDAYS, addDays, fa, parts, tehranToday, wd, MONTHS } from '../jalali';
import { Empty, Field, Loading, Modal, ReadOnlyBanner, useAction, useLoad } from '../ui';
import { useLevel } from '../auth';

const SLOTS = [['breakfast', '🍳 صبحانه'], ['lunch', '🍛 ناهار'], ['dinner', '🍲 شام']] as const;
/** Home: shared shopping list + weekly meal plan (module "home"). */
export default function HomePage() {
  const [tab, setTab] = useState<'shop' | 'meals'>('shop'); const w = useLevel('home') >= 2;
  return <div className="space-y-3 max-w-3xl"><ReadOnlyBanner module="home" /><h1 className="text-xl font-extrabold">🛒 خانه‌داری</h1>
    <div className="flex gap-2"><button className={`btn ${tab === 'shop' ? '' : 'btn-ghost'}`} onClick={() => setTab('shop')}>🛒 لیست خرید</button><button className={`btn ${tab === 'meals' ? '' : 'btn-ghost'}`} onClick={() => setTab('meals')}>🍽 برنامه‌ی غذایی</button></div>
    {tab === 'shop' ? <Shopping w={w} /> : <Meals w={w} />}</div>;
}
function Shopping({ w }: { w: boolean }) {
  const list = useLoad(() => api<any[]>('/shopping')); const act = useAction(); const [t, setT] = useState(''); const [qty, setQty] = useState('');
  const add = () => act(async () => { await api('/shopping', { body: { title: t.trim(), qty: qty.trim() || null } }); setT(''); setQty(''); await list.reload(); });
  const open = (list.data ?? []).filter((x) => !x.done); const done = (list.data ?? []).filter((x) => x.done);
  return <div className="space-y-3">{w && <form className="card flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); if (t.trim()) void add(); }}><input className="input flex-1 min-w-40" placeholder="چه چیزی بخریم؟" value={t} maxLength={120} onChange={(e) => setT(e.target.value)} /><input className="input !w-28" placeholder="تعداد" value={qty} maxLength={40} onChange={(e) => setQty(e.target.value)} /><button className="btn btn-teal" disabled={!t.trim()}>＋</button></form>}
    <Loading error={list.error} loading={list.loading} />{list.data?.length === 0 && <Empty>لیست خالی است.</Empty>}
    <section className="card">{open.map((x) => <Row key={x.id} x={x} w={w} reload={list.reload} />)}{open.length === 0 && list.data && list.data.length > 0 && <p className="text-slate-500">همه خریده شد ✅</p>}</section>
    {done.length > 0 && <section className="card opacity-80"><div className="flex justify-between items-center mb-1"><b>خریده‌شده</b>{w && <button className="btn btn-ghost !py-1" onClick={() => confirm('خریده‌شده‌ها پاک شوند؟') && act(async () => { for (const x of done) await api(`/shopping/${x.id}`, { method: 'DELETE' }); await list.reload(); })}>پاک‌کردن</button>}</div>{done.map((x) => <Row key={x.id} x={x} w={w} reload={list.reload} />)}</section>}</div>;
}
function Row({ x, w, reload }: { x: any; w: boolean; reload: () => Promise<void> }) {
  const act = useAction();
  return <div className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0"><input type="checkbox" className="w-6 h-6" disabled={!w} checked={x.done} aria-label="خریده شد" onChange={(e) => act(async () => { await api(`/shopping/${x.id}`, { method: 'PATCH', body: { done: e.target.checked } }); await reload(); })} />
    <span className={`flex-1 ${x.done ? 'line-through text-slate-400' : ''}`}>{x.title}{x.qty && <span className="text-xs text-slate-500"> · {x.qty}</span>}</span>
    {w && <button className="btn btn-ghost !px-2 !min-h-0" aria-label="حذف" onClick={() => act(async () => { await api(`/shopping/${x.id}`, { method: 'DELETE' }); await reload(); })}>🗑</button>}</div>;
}
function Meals({ w }: { w: boolean }) {
  const [start, setStart] = useState(addDays(tehranToday(), -wd(tehranToday()))); const act = useAction(); const [edit, setEdit] = useState<{ day: string; slot: string; title: string } | null>(null);
  const meals = useLoad(() => api<any[]>(`/meals?from=${start}&to=${addDays(start, 6)}`), [start]); const get = (d: string, s: string) => meals.data?.find((m) => m.day === d && m.slot === s)?.title;
  return <div className="space-y-2"><div className="flex items-center justify-between"><button className="btn btn-ghost" onClick={() => setStart(addDays(start, -7))}>›</button><b>{fa(parts(start).jd)} {MONTHS[parts(start).jm - 1]} تا {fa(parts(addDays(start, 6)).jd)} {MONTHS[parts(addDays(start, 6)).jm - 1]}</b><button className="btn btn-ghost" onClick={() => setStart(addDays(start, 7))}>‹</button></div>
    <Loading error={meals.error} loading={meals.loading} />
    {Array.from({ length: 7 }, (_, i) => { const d = addDays(start, i); return <section key={d} className={`card ${d === tehranToday() ? '!border-teal-mana' : ''}`}><b>{WEEKDAYS[i]} <span className="text-xs text-slate-500">{fa(parts(d).jd)} {MONTHS[parts(d).jm - 1]}</span></b>
      <div className="grid grid-cols-3 gap-2 mt-1">{SLOTS.map(([s, l]) => <button key={s} disabled={!w} className="rounded-xl bg-slate-50 p-2 text-start min-h-14" onClick={() => setEdit({ day: d, slot: s, title: get(d, s) ?? '' })}><div className="text-[11px] text-slate-500">{l}</div><div className="text-sm">{get(d, s) ?? <span className="text-slate-300">—</span>}</div></button>)}</div></section>; })}
    {edit && <Modal title={`${SLOTS.find((x) => x[0] === edit.slot)![1]} — ${WEEKDAYS[wd(edit.day)]}`} onClose={() => setEdit(null)}><Field label="چه بپزیم؟ (خالی = حذف)"><input className="input" autoFocus maxLength={120} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
      <button className="btn btn-teal w-full" onClick={() => act(async () => { await api('/meals', { method: 'PUT', body: { day: edit.day, slot: edit.slot, title: edit.title.trim() } }); setEdit(null); await meals.reload(); }, 'ذخیره شد')}>ذخیره</button></Modal>}</div>;
}
