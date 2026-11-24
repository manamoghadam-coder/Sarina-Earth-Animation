import { useState } from 'react';
import { api } from '../api';
import { useLevel } from '../auth';
import { Empty, Loading, ReadOnlyBanner, useAction, useLoad } from '../ui';

const CAT: Record<string, string> = { food: '🍎 خوراکی', home: '🏠 خانه', school: '✏️ مدرسه', health: '💊 سلامت', other: '📦 سایر' };
export default function ShoppingPage() {
  const list = useLoad(() => api<any[]>('/shopping')); const lv = useLevel('shopping'); const act = useAction(); const [f, setF] = useState({ title: '', qty: '', category: 'food' });
  const open = (list.data ?? []).filter((x) => x.status === 'open'); const bought = (list.data ?? []).filter((x) => x.status === 'bought');
  const add = () => act(async () => { await api('/shopping', { body: { title: f.title, qty: f.qty || null, category: f.category } }); setF({ ...f, title: '', qty: '' }); await list.reload(); });
  return <div className="space-y-3"><ReadOnlyBanner module="shopping" /><h1 className="text-xl font-extrabold">🛒 لیست خرید مشترک</h1>
    {lv >= 2 && <form className="card flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); if (f.title.trim()) void add(); }}><input className="input flex-1 min-w-40" placeholder="چه چیزی بخریم؟" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><input className="input !w-28" placeholder="مقدار" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      <select className="input !w-36" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn btn-teal" disabled={!f.title.trim()}>＋ افزودن</button></form>}
    <Loading error={list.error} loading={list.loading} />{list.data && open.length === 0 && <Empty>لیست خالی است 🎉</Empty>}
    {Object.entries(CAT).map(([k, t]) => { const items = open.filter((x) => x.category === k); return items.length ? <section key={k} className="card"><h2 className="font-bold mb-1">{t}</h2>{items.map((x) => <div key={x.id} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0"><input type="checkbox" className="w-6 h-6" aria-label="خریده شد" disabled={lv < 2} onChange={() => act(async () => { await api(`/shopping/${x.id}/status`, { body: { status: 'bought' } }); await list.reload(); })} />
      <span className="flex-1">{x.title}{x.qty ? <span className="text-slate-500"> ({x.qty})</span> : null}{x.note ? <span className="text-xs text-slate-400 block">{x.note}</span> : null}</span>{lv >= 2 && <button aria-label="حذف" onClick={() => act(async () => { await api(`/shopping/${x.id}`, { method: 'DELETE' }); await list.reload(); })}>🗑</button>}</div>)}</section> : null; })}
    {bought.length > 0 && <section className="card opacity-80"><div className="flex justify-between items-center mb-1"><h2 className="font-bold">✅ خریده‌شده ({bought.length})</h2>{lv >= 2 && <button className="btn btn-ghost !py-1" onClick={() => act(async () => { await api('/shopping/clear-bought', { body: {} }); await list.reload(); })}>پاک کردن</button>}</div>
      {bought.map((x) => <div key={x.id} className="flex items-center gap-3 py-1 line-through text-slate-500"><input type="checkbox" className="w-5 h-5" checked disabled={lv < 2} onChange={() => act(async () => { await api(`/shopping/${x.id}/status`, { body: { status: 'open' } }); await list.reload(); })} />{x.title}</div>)}</section>}</div>;
}
