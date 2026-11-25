import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../jalali';
import { Confirm, DateField, Empty, Field, Loading, useAction, useLoad } from '../ui';
import { tehranToday } from '../jalali';
import { DictateButton, SpeakButton, card, useKid } from './shared';

type Msg = { id: string; to_user: string; to_name?: string; msg_date: string; title: string | null; body: string; read_at: string | null };
export default function Messages() { return useAuth().me!.role === 'parent' ? <Compose /> : <Inbox />; }

/** Recipient view: Mana's daily messages/letters. Opening one marks it as read; 🔊 reads it aloud. */
function Inbox() {
  const kid = useKid(); const list = useLoad(() => api<Msg[]>('/mom-messages')); const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!open) return; void api(`/mom-messages/${open}/read`, { method: 'POST', body: {} }).then(() => window.dispatchEvent(new Event('mana-inbox-changed'))); }, [open]);
  return <div className="space-y-3 max-w-2xl"><h1 className={kid ? 'text-3xl font-extrabold' : 'text-xl font-extrabold'}>💌 پیام‌های مامان</h1>
    <Loading error={list.error} loading={list.loading} />{list.data?.length === 0 && <Empty>هنوز پیامی نیست. مامان که بنویسد، اینجا می‌آید 💜</Empty>}
    {list.data?.map((m) => { const isOpen = open === m.id; const unread = !m.read_at;
      return <article key={m.id} className={`${card(kid)} ${unread ? 'ring-2 ring-teal-mana' : ''}`}>
        <button className="w-full text-start flex items-center gap-2" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}><span className="text-3xl">{unread ? '💌' : '📨'}</span>
          <b className="flex-1">{m.title || 'پیام مامان'}</b><span className="text-xs opacity-60">{fmtDate(m.msg_date)}</span></button>
        {isOpen && <div className="mt-2 space-y-2"><p className="whitespace-pre-wrap leading-8">{m.body}</p><SpeakButton text={`${m.title ?? 'پیام مامان'}. ${m.body}`} /></div>}</article>; })}</div>;
}

/** Mana: write a text/letter for one or several people each day, and see who has read it. */
function Compose() {
  const act = useAction(); const people = useLoad(() => api<any[]>('/members')); const list = useLoad(() => api<Msg[]>('/mom-messages'));
  const [to, setTo] = useState<string[]>([]); const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [date, setDate] = useState(tehranToday()); const [del, setDel] = useState<Msg | null>(null);
  const toggle = (id: string) => setTo((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const all = (people.data ?? []).filter((p) => p.active).map((p) => p.id);
  return <div className="space-y-4 max-w-2xl"><h1 className="text-xl font-extrabold">💌 پیام‌های مامان</h1>
    <section className="card"><h2 className="font-bold mb-2">نوشتن پیام یا نامه</h2>
      <Field label="برای چه کسی؟"><div className="flex flex-wrap gap-2"><button className={`btn ${to.length === all.length && all.length ? '' : 'btn-ghost'}`} onClick={() => setTo(to.length === all.length ? [] : all)}>همه</button>
        {people.data?.filter((p) => p.active).map((p) => <button key={p.id} className={`btn ${to.includes(p.id) ? '' : 'btn-ghost'}`} onClick={() => toggle(p.id)}>{p.role === 'child' ? '🧒' : '🧑'} {p.display_name}</button>)}</div></Field>
      <Field label="تاریخ"><DateField value={date} onChange={(v) => setDate(v ?? tehranToday())} /></Field>
      <Field label="عنوان (اختیاری)"><input className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: صبح بخیر، عزیزم" /></Field>
      <Field label="متن پیام"><textarea className="input min-h-36" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex gap-2 flex-wrap"><DictateButton onText={(t) => setBody((b) => (b + ' ' + t).trim())} />
        <button className="btn btn-teal flex-1" disabled={!to.length || !body.trim()} onClick={() => act(async () => { await api('/mom-messages', { body: { to, title: title.trim() || null, body, msg_date: date } }); setBody(''); setTitle(''); await list.reload(); }, 'پیام ارسال شد 💌')}>ارسال</button></div>
      <p className="text-xs text-slate-500 mt-2">گیرنده یک اعلان «پیام مامان» می‌گیرد و آن را در بخش «پیام مامان» (با امکان شنیدن) می‌خواند.</p></section>
    <section className="card"><h2 className="font-bold mb-2">پیام‌های فرستاده‌شده</h2><Loading error={list.error} loading={list.loading} />{list.data?.length === 0 && <Empty>هنوز پیامی نفرستاده‌اید.</Empty>}
      {list.data?.map((m) => <div key={m.id} className="border-b border-slate-100 py-2 last:border-0"><div className="flex items-center gap-2"><b className="flex-1">{m.title || 'بدون عنوان'} ← {m.to_name}</b>
        <span className={`text-xs ${m.read_at ? 'text-teal-700' : 'text-amber-700'}`}>{m.read_at ? '✓ خوانده شد' : 'هنوز نخوانده'}</span><button className="btn btn-ghost !px-2 !min-h-0" aria-label="حذف" onClick={() => setDel(m)}>🗑</button></div>
        <p className="text-sm text-slate-600 whitespace-pre-wrap">{m.body}</p><span className="text-xs text-slate-400">{fmtDate(m.msg_date)}</span></div>)}</section>
    {del && <Confirm text="این پیام پاک شود؟" onYes={() => act(async () => { await api(`/mom-messages/${del.id}`, { method: 'DELETE' }); setDel(null); await list.reload(); }, 'حذف شد')} onNo={() => setDel(null)} />}</div>;
}
