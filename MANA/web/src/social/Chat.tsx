import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { speak } from '../voice';
import { useAuth } from '../auth';
import { fmtInstant, fa } from '../jalali';
import { Avatar, Loading, useAction } from '../ui';
import { DictateButton, useKid } from './shared';

type Msg = { id: number; sender_id: string; peer_id: string | null; body: string; created_at: string };
type Person = { id: string; display_name: string; role: string; avatar_photo_id: string | null };
type Conv = { conv: string; last_id: number; last_from_me: boolean };
const seenKey = (uid: string, conv: string) => `mana.chat.seen.${uid}.${conv}`;
export const markChatSeen = (uid: string, conv: string, id: number) => { try { localStorage.setItem(seenKey(uid, conv), String(id)); } catch { /* storage may be blocked */ } window.dispatchEvent(new Event('mana-chat-seen')); };
export const getChatSeen = (uid: string, conv: string) => { try { return Number(localStorage.getItem(seenKey(uid, conv))) || 0; } catch { return 0; } };
/** conversations with something unread (group or a private chat) */
export const unreadConvs = (uid: string, sum: Conv[]) => sum.filter((c) => !c.last_from_me && c.last_id > getChatSeen(uid, c.conv)).map((c) => c.conv);

/** Family chat: the group of all accounts + private one-to-one conversations (only the two people can read those). Polls every few seconds. */
export default function Chat() {
  const { me } = useAuth(); const kid = useKid(); const canWrite = (me!.permissions.chat ?? 0) >= 2; const [conv, setConv] = useState('group');
  const [people, setPeople] = useState<Person[]>([]); const [sum, setSum] = useState<Conv[]>([]);
  useEffect(() => { let dead = false; const t = async () => { try { const [r, s] = await Promise.all([api<{ people: Person[] }>('/chat?after=2147483647'), api<Conv[]>('/chat/summary')]); if (!dead) { setPeople(r.people); setSum(s); } } catch { /* offline */ } };
    void t(); const i = setInterval(t, 6000); window.addEventListener('mana-chat-seen', t); return () => { dead = true; clearInterval(i); window.removeEventListener('mana-chat-seen', t); }; }, []);
  const others = people.filter((p) => p.id !== me!.id); const unread = unreadConvs(me!.id, sum);
  return <div className="max-w-2xl"><h1 className={`${kid ? 'text-3xl' : 'text-xl'} font-extrabold mb-2`}>💬 چت خانوادگی</h1>
    <div className="flex gap-2 overflow-x-auto pb-2">{[{ id: 'group', display_name: 'گروه خانواده', avatar_photo_id: null as string | null }, ...others].map((p) => <button key={p.id} onClick={() => setConv(p.id)} className={`btn !min-h-0 !py-1.5 whitespace-nowrap relative ${conv === p.id ? '' : 'btn-ghost'}`}>
      {p.id === 'group' ? '👨‍👩‍👧‍👦' : <Avatar id={p.avatar_photo_id} name={p.display_name} size={24} />} {p.display_name}{unread.includes(p.id) && <span className="absolute -top-1 -end-1 w-3 h-3 rounded-full bg-red-500" aria-label="پیام تازه" />}</button>)}</div>
    {conv !== 'group' && <p className="text-xs opacity-60 mb-1">🔒 گفتگوی خصوصی؛ فقط شما دو نفر می‌توانید این پیام‌ها را بخوانید.</p>}
    <Thread key={conv} conv={conv} people={people} canWrite={canWrite} kid={kid} /></div>;
}

function Thread({ conv, people, canWrite, kid }: { conv: string; people: Person[]; canWrite: boolean; kid: boolean }) {
  const { me } = useAuth(); const act = useAction(); const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const [msgs, setMsgs] = useState<Msg[]>([]); const [err, setErr] = useState<string | null>(null); const [ready, setReady] = useState(false); const [text, setText] = useState('');
  const last = useRef(0); const box = useRef<HTMLDivElement>(null); const stick = useRef(true); const peer = conv === 'group' ? '' : `peer=${conv}`;
  useEffect(() => {
    let dead = false;
    const tick = async () => { try { const r = await api<{ messages: Msg[] }>(`/chat?${peer}${last.current ? `${peer ? '&' : ''}after=${last.current}` : ''}`); if (dead) return; setErr(null); setReady(true);
      if (r.messages.length) { const first = last.current === 0; last.current = Math.max(last.current, r.messages.at(-1)!.id); setMsgs((m) => (first ? r.messages : [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))])); markChatSeen(me!.id, conv, last.current); }
      else if (last.current === 0) setMsgs([]);
    } catch (e: any) { if (!dead) { setErr(e?.message ?? 'خطا'); setReady(true); } } };
    void tick(); const t = setInterval(tick, 4000); return () => { dead = true; clearInterval(t); };
  }, [me, conv, peer]);
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [msgs]);
  const send = () => { const t = text.trim(); if (!t) return; void act(async () => { const m = await api<Msg>('/chat', { body: { body: t, peer_id: conv === 'group' ? null : conv } }); setText(''); last.current = Math.max(last.current, m.id); setMsgs((x) => [...x, m]); stick.current = true; markChatSeen(me!.id, conv, m.id); }); };
  const remove = (id: number) => act(async () => { await api(`/chat/${id}`, { method: 'DELETE' }); setMsgs((x) => x.filter((m) => m.id !== id)); });
  return <div className="flex flex-col" style={{ height: 'calc(100dvh - 21rem)', minHeight: 260 }}>
    <div ref={box} onScroll={(e) => { const b = e.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80; }} className="flex-1 overflow-y-auto rounded-2xl bg-white/70 p-3 space-y-2" aria-live="polite">
      <Loading error={err} loading={!ready} />{ready && !err && msgs.length === 0 && <p className="text-center opacity-60 py-8">هنوز پیامی نیست. اولین نفر باش! 👋</p>}
      {msgs.map((m) => { const mine = m.sender_id === me!.id; const p = byId[m.sender_id]; const t = fmtInstant(m.created_at);
        return <div key={m.id} className={`flex gap-2 items-end ${mine ? '' : 'flex-row-reverse'}`}><Avatar id={p?.avatar_photo_id} name={p?.display_name ?? '؟'} size={36} />
          <div className={`max-w-[78%] rounded-2xl px-3 py-2 ${mine ? 'bg-teal-mana text-white rounded-br-sm' : 'bg-slate-100 text-slate-900 rounded-bl-sm'}`}>
            {!mine && conv === 'group' && <div className="text-xs font-bold opacity-70">{p?.display_name ?? 'کاربر'}</div>}
            <p className="whitespace-pre-wrap break-words leading-7">{m.body}</p>
            <div className="flex items-center gap-2 text-[11px] opacity-70"><span>{fa(t.time)}</span><button aria-label="بشنو" onClick={() => speak(m.body)}>🔊</button>
              {(mine || (me!.role === 'parent' && conv === 'group')) && canWrite && <button aria-label="حذف پیام" onClick={() => remove(m.id)}>🗑</button>}</div></div></div>; })}</div>
    {canWrite ? <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea className="input w-full !min-h-12 max-h-32" rows={2} maxLength={2000} placeholder="بنویس…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="flex gap-2"><DictateButton kid={kid} onText={(t) => setText((x) => (x + ' ' + t).trim())} /><button className="btn btn-teal flex-1" disabled={!text.trim()}>ارسال</button></div></form>
      : <p role="note" className="mt-2 text-sm rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">👁 فرستادن پیام در چت برای این حساب غیرفعال است.</p>}</div>;
}
