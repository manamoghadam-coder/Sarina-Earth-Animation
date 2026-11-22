import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { speak } from '../voice';
import { useAuth } from '../auth';
import { fmtInstant, fa } from '../jalali';
import { Avatar, Loading, useAction } from '../ui';
import { DictateButton, useKid } from './shared';

type Msg = { id: number; sender_id: string; body: string; created_at: string };
type Person = { id: string; display_name: string; role: string; avatar_photo_id: string | null };
const seenKey = (uid: string) => `mana.chat.seen.${uid}`;
export const markChatSeen = (uid: string, id: number) => { try { localStorage.setItem(seenKey(uid), String(id)); } catch { /* storage may be blocked */ } window.dispatchEvent(new Event('mana-chat-seen')); };
export const getChatSeen = (uid: string) => { try { return Number(localStorage.getItem(seenKey(uid))) || 0; } catch { return 0; } };

/** Family group chat (all active accounts). Polls every few seconds while open. */
export default function Chat() {
  const { me } = useAuth(); const kid = useKid(); const act = useAction(); const canWrite = (me!.permissions.chat ?? 0) >= 2;
  const [msgs, setMsgs] = useState<Msg[]>([]); const [people, setPeople] = useState<Record<string, Person>>({}); const [err, setErr] = useState<string | null>(null); const [ready, setReady] = useState(false);
  const [text, setText] = useState(''); const last = useRef(0); const box = useRef<HTMLDivElement>(null); const stick = useRef(true);
  useEffect(() => {
    let dead = false;
    const tick = async () => { try { const r = await api<{ people: Person[]; messages: Msg[] }>(`/chat${last.current ? `?after=${last.current}` : ''}`);
      if (dead) return; setPeople(Object.fromEntries(r.people.map((p) => [p.id, p]))); setErr(null); setReady(true);
      if (r.messages.length) { const first = last.current === 0; last.current = Math.max(last.current, r.messages.at(-1)!.id); setMsgs((m) => (first ? r.messages : [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))])); markChatSeen(me!.id, last.current); }
    } catch (e: any) { if (!dead) { setErr(e?.message ?? 'خطا'); setReady(true); } } };
    void tick(); const t = setInterval(tick, 4000); return () => { dead = true; clearInterval(t); };
  }, [me]);
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [msgs]);
  const send = () => { const t = text.trim(); if (!t) return; void act(async () => { const m = await api<Msg>('/chat', { body: { body: t } }); setText(''); last.current = Math.max(last.current, m.id); setMsgs((x) => [...x, m]); stick.current = true; }); };
  const remove = (id: number) => act(async () => { await api(`/chat/${id}`, { method: 'DELETE' }); setMsgs((x) => x.filter((m) => m.id !== id)); });
  return <div className="max-w-2xl flex flex-col" style={{ height: 'calc(100dvh - 19rem)', minHeight: 260 }}>
    <h1 className={`${kid ? 'text-3xl' : 'text-xl'} font-extrabold mb-1`}>💬 چت خانوادگی</h1>
    <p className="text-xs opacity-60 mb-2">{Object.keys(people).length ? 'اعضا: ' + Object.values(people).map((p) => p.display_name).join('، ') : ''}</p>
    <div ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }} className="flex-1 overflow-y-auto rounded-2xl bg-white/70 p-3 space-y-2" aria-live="polite">
      <Loading error={err} loading={!ready} />{ready && !err && msgs.length === 0 && <p className="text-center opacity-60 py-8">هنوز پیامی نیست. اولین نفر باش! 👋</p>}
      {msgs.map((m) => { const mine = m.sender_id === me!.id; const p = people[m.sender_id]; const t = fmtInstant(m.created_at);
        return <div key={m.id} className={`flex gap-2 items-end ${mine ? '' : 'flex-row-reverse'}`}>
          <Avatar id={p?.avatar_photo_id} name={p?.display_name ?? '؟'} size={36} />
          <div className={`max-w-[78%] rounded-2xl px-3 py-2 ${mine ? 'bg-teal-mana text-white rounded-br-sm' : 'bg-slate-100 text-slate-900 rounded-bl-sm'}`}>
            {!mine && <div className="text-xs font-bold opacity-70">{p?.display_name ?? 'کاربر'}</div>}
            <p className="whitespace-pre-wrap break-words leading-7">{m.body}</p>
            <div className="flex items-center gap-2 text-[11px] opacity-70"><span>{fa(t.time)}</span><button aria-label="بشنو" onClick={() => speak(m.body)}>🔊</button>
              {(mine || me!.role === 'parent') && canWrite && <button aria-label="حذف پیام" onClick={() => remove(m.id)}>🗑</button>}</div></div></div>; })}</div>
    {canWrite ? <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea className="input w-full !min-h-12 max-h-32" rows={2} maxLength={2000} placeholder="بنویس…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="flex gap-2"><DictateButton kid={kid} onText={(t) => setText((x) => (x + ' ' + t).trim())} /><button className="btn btn-teal flex-1" disabled={!text.trim()}>ارسال</button></div></form>
      : <p role="note" className="mt-2 text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">👁 فرستادن پیام در چت برای این حساب غیرفعال است.</p>}
  </div>;
}
