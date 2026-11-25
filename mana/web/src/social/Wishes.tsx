import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, photoUrl } from '../api';
import { useAuth } from '../auth';
import { fa, fmtDate } from '../jalali';
import { Confirm, Empty, Field, Loading, Modal, useAction, useLoad } from '../ui';
import { speak } from '../voice';
import { prepareImage } from './image';
import { card, useKid } from './shared';

type Wish = { id: string; board_id: string; title: string; note: string | null; kind: 'dream' | 'place' | 'goal'; photo_id: string | null; achieved_at: string | null };
const KIND = { dream: ['🌟', 'آرزو'], place: ['📍', 'جایی که می‌خواهم بروم'], goal: ['🎯', 'هدف'] } as const;
const TONES = ['#fde68a', '#fbcfe8', '#bae6fd', '#bbf7d0', '#ddd6fe', '#fed7aa'];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const dayIndex = () => Math.floor(Date.now() / 86400000);

/** The wish board. The layout is automatic: every wish becomes a tilted "pinned photo" card; achieved wishes get a green «رسیدم!» stamp. */
export default function Wishes() {
  const { me } = useAuth(); const kid = useKid(); const act = useAction(); const [sp] = useSearchParams(); const viewing = sp.get('user');       // Mana looking at a child's board
  const [boardId, setBoardId] = useState<string | null>(null);
  const cur = useLoad(() => api<any>(`/wishes/board${viewing ? `?user_id=${viewing}` : ''}`), [viewing]);
  const old = useLoad(() => (boardId ? api<any>(`/wishes/boards/${boardId}`) : Promise.resolve(null)), [boardId]);
  const canWrite = !viewing && !boardId && (me!.permissions.wishes ?? 0) >= 2;
  const [edit, setEdit] = useState<Partial<Wish> | null>(null); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [renew, setRenew] = useState(false); const [del, setDel] = useState<Wish | null>(null);
  const data = boardId ? old.data : cur.data; const wishes: Wish[] = data?.wishes ?? []; const board = data?.board;
  const done = wishes.filter((w) => w.achieved_at).length; const reload = async () => { await cur.reload(); if (boardId) await old.reload(); };
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const save = async () => { setBusy(true); await act(async () => {
      let photo_id = edit!.photo_id ?? null;
      if (file) { const fd = new FormData(); fd.append('file', await prepareImage(file)); photo_id = (await api<{ photo_id: string }>('/wishes/photo', { form: fd })).photo_id; }
      const b = { title: edit!.title!.trim(), note: edit!.note?.trim() || null, kind: edit!.kind ?? 'dream', photo_id };
      if (edit!.id) await api(`/wishes/${edit!.id}`, { method: 'PATCH', body: b }); else await api('/wishes', { body: b });
      setEdit(null); setFile(null); await reload(); }, 'روی تابلو نشست 🌠'); setBusy(false); };
  const tick = (w: Wish, on: boolean) => act(async () => { await api(`/wishes/${w.id}/achieve`, { body: { achieved: on } }); await reload(); if (on) void speak(`آفرین! به آرزویت رسیدی: ${w.title}`); }, on ? '🎉 تبریک! به آرزویت رسیدی' : 'برداشته شد');
  if (cur.loading) return <Loading error={cur.error} loading />;
  return <div className="space-y-3">
    <div className="rounded-3xl p-4 text-white shadow-lg" style={{ background: 'linear-gradient(135deg,#6d28d9,#db2777 55%,#f59e0b)' }}>
      <div className="flex items-start gap-2"><div className="flex-1"><h1 className={`${kid ? 'text-3xl' : 'text-2xl'} font-extrabold`}>🌠 {board?.title ?? 'تابلو آرزوها'}</h1>
          {board && <p className="text-sm opacity-90 mt-1">{boardId ? 'تابلوی قبلی' : 'شروع'}: {fmtDate(board.starts_on)} · {fa(done)} از {fa(wishes.length)} آرزو محقق شد</p>}</div>
        {canWrite && <button className="btn !bg-white/90 !text-purple-800" onClick={() => setEdit({ kind: 'dream' })}>＋ آرزوی تازه</button>}</div>
      {wishes.length > 0 && <div className="h-3 rounded-full bg-white/30 mt-3 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemax={wishes.length}><div className="h-full bg-white rounded-full transition-all" style={{ width: `${(done / wishes.length) * 100}%` }} /></div>}</div>
    {boardId && <button className="btn btn-ghost" onClick={() => setBoardId(null)}>← برگشت به تابلوی فعلی</button>}
    {viewing && <p className="text-sm opacity-70">👁 فقط مشاهده (تابلوی فرزند شما).</p>}
    {!board && !loading(cur) && <Empty>{viewing ? 'هنوز تابلویی ندارد.' : 'تابلو در دسترس نیست.'}</Empty>}
    {board && wishes.length === 0 && <div className={`${card(kid)} text-center space-y-2`}><div className="text-6xl">🖼️</div><p>تابلو هنوز خالی است. عکس چیزهایی را که آرزویشان را داری یا جاهایی که دوست داری بروی اضافه کن!</p>
      {canWrite && <button className="btn btn-teal" onClick={() => setEdit({ kind: 'dream' })}>＋ اولین آرزو</button>}</div>}
    <div className="columns-2 sm:columns-3 gap-3 [column-fill:_balance]">{wishes.map((w) => { const h = hash(w.id); const tilt = ((h % 7) - 3) * 1.1; const ratio = ['4/5', '1/1', '5/4', '3/4'][h % 4]; const tone = TONES[h % TONES.length]; const [ic] = KIND[w.kind];
      return <figure key={w.id} className="relative break-inside-avoid mb-4 rounded-md p-2 pb-3 shadow-xl transition-transform hover:scale-[1.03]" style={{ background: '#fff', transform: `rotate(${tilt}deg)`, borderTop: `10px solid ${tone}` }}>
        <span className="absolute -top-3 start-1/2 -translate-x-1/2 text-xl" aria-hidden>📌</span>
        {w.photo_id ? <img src={photoUrl(w.photo_id)} alt={w.title} loading="lazy" className={`w-full object-cover rounded ${w.achieved_at ? '' : ''}`} style={{ aspectRatio: ratio }} /> : <div className="w-full rounded grid place-items-center text-6xl" style={{ aspectRatio: ratio, background: tone }}>{ic}</div>}
        {w.achieved_at && <div className="absolute inset-x-0 top-1/3 mx-auto w-fit -rotate-12 rounded-lg border-4 border-emerald-600 bg-white/90 px-3 py-1 text-emerald-700 font-extrabold text-xl shadow">✅ رسیدم! 🎉</div>}
        <figcaption className="mt-2 text-center"><b className="block leading-6">{ic} {w.title}</b>{w.note && <span className="text-xs opacity-70 block">{w.note}</span>}
          {w.achieved_at && <span className="text-xs text-emerald-700">{fmtDate(w.achieved_at.slice(0, 10), false)}</span>}</figcaption>
        {canWrite && <div className="flex gap-1 justify-center mt-2 flex-wrap">{w.achieved_at ? <button className="btn btn-ghost !min-h-0 !py-1 text-xs" onClick={() => tick(w, false)}>↩️ هنوز نه</button> : <button className="btn btn-teal !min-h-0 !py-1" onClick={() => tick(w, true)}>✓ رسیدم</button>}
          <button className="btn btn-ghost !min-h-0 !py-1 !px-2" aria-label="ویرایش" onClick={() => { setEdit(w); setFile(null); }}>✏️</button><button className="btn btn-ghost !min-h-0 !py-1 !px-2" aria-label="حذف" onClick={() => setDel(w)}>🗑</button>
          <button className="btn btn-ghost !min-h-0 !py-1 !px-2" aria-label="بخوان" onClick={() => speak(`${w.title}. ${w.note ?? ''}`)}>🔊</button></div>}</figure>; })}</div>
    {canWrite && board && <div className="flex gap-2 flex-wrap"><button className="btn btn-ghost" onClick={() => setRenew(true)}>🔄 تابلوی تازه برای فصل جدید</button></div>}
    {data && !boardId && cur.data?.archived?.length > 0 && <section className={card(kid)}><h2 className="font-bold mb-2">🗂 تابلوهای قبلی</h2>{cur.data.archived.map((a: any) => <button key={a.id} className="w-full text-start py-2 border-b border-slate-100 last:border-0 flex justify-between" onClick={() => setBoardId(a.id)}><span>{a.title} · {fmtDate(a.starts_on, false)}</span><span className="text-emerald-700">{fa(a.achieved)} از {fa(a.total)} ✅</span></button>)}</section>}
    {edit && <Modal title={edit.id ? 'ویرایش آرزو' : 'آرزوی تازه'} onClose={() => { setEdit(null); setFile(null); }}>
      <Field label="چه چیزی؟"><input className="input" maxLength={120} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="مثلاً: رفتن به کنار دریا" /></Field>
      <Field label="نوع"><div className="flex gap-2 flex-wrap">{(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => <button key={k} type="button" className={`btn ${edit.kind === k ? '' : 'btn-ghost'}`} onClick={() => setEdit({ ...edit, kind: k })}>{KIND[k][0]} {KIND[k][1]}</button>)}</div></Field>
      <Field label="یک خط توضیح (اختیاری)"><input className="input" maxLength={500} value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
      <Field label="تصویر"><div className="space-y-2">{(preview || edit.photo_id) && <img src={preview ?? photoUrl(edit.photo_id!)} alt="" className="max-h-48 rounded-xl mx-auto" />}
        <label className="btn btn-ghost cursor-pointer">📷 انتخاب عکس / دوربین<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(f); }} /></label></div></Field>
      <button className="btn btn-teal w-full" disabled={busy || !(edit.title ?? '').trim()} onClick={save}>{busy ? 'در حال ذخیره…' : 'گذاشتن روی تابلو'}</button></Modal>}
    {del && <Confirm text="این آرزو از تابلو برداشته شود؟" onYes={() => act(async () => { await api(`/wishes/${del.id}`, { method: 'DELETE' }); setDel(null); await reload(); }, 'برداشته شد')} onNo={() => setDel(null)} />}
    {renew && <RenewModal onClose={() => setRenew(false)} done={async () => { setRenew(false); await reload(); }} />}</div>;
}
const loading = (x: { loading: boolean }) => x.loading;

function RenewModal({ onClose, done }: { onClose: () => void; done: () => Promise<void> }) {
  const act = useAction(); const [title, setTitle] = useState('تابلوی آرزوهای تازه'); const [carry, setCarry] = useState(true); const [months, setMonths] = useState(3);
  return <Modal title="تابلوی تازه" onClose={onClose}><p className="text-sm mb-3">تابلوی فعلی با همه‌ی تیک‌هایش بایگانی می‌شود و همیشه در «تابلوهای قبلی» می‌ماند.</p>
    <Field label="نام تابلو"><input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Field>
    <label className="flex items-center gap-2 mb-3"><input type="checkbox" className="w-5 h-5" checked={carry} onChange={(e) => setCarry(e.target.checked)} />آرزوهایی که هنوز به آن‌ها نرسیده‌ام به تابلوی تازه بیایند</label>
    <Field label="هر چند ماه یادآوری به‌روزرسانی بیاید؟"><select className="input" value={months} onChange={(e) => setMonths(+e.target.value)}>{[1, 2, 3, 4, 6, 12].map((m) => <option key={m} value={m}>{fa(m)} ماه</option>)}</select></Field>
    <button className="btn btn-teal w-full" onClick={() => act(async () => { await api('/wishes/board/renew', { body: { title, carry_over: carry, refresh_months: months } }); await done(); }, 'تابلوی تازه ساخته شد 🌠')}>ساختن تابلو</button></Modal>;
}

/** Small "today's wish" card for the child home screen: a different wish each day. */
export function WishOfTheDay({ onOpen }: { onOpen: () => void }) {
  const b = useLoad(() => api<any>('/wishes/board')); const open = (b.data?.wishes ?? []).filter((w: Wish) => !w.achieved_at); if (!open.length) return null;
  const w: Wish = open[dayIndex() % open.length];
  return <button onClick={onOpen} className="kid-card w-full text-start flex items-center gap-3"><div className="w-20 h-20 rounded-xl overflow-hidden flex-none grid place-items-center text-4xl bg-white/70">{w.photo_id ? <img src={photoUrl(w.photo_id)} alt="" className="w-full h-full object-cover" /> : KIND[w.kind][0]}</div>
    <div><div className="text-xs opacity-70">🌠 آرزوی امروز</div><b className="text-lg">{w.title}</b></div></button>;
}
