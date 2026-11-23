import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate, tehranToday } from '../jalali';
import { Confirm, DateField, Empty, Field, Loading, Modal, useAction, useLoad } from '../ui';
import { DictateButton, SpeakButton, card, useKid } from './shared';

const MOODS = ['😊', '😍', '😌', '😐', '😢', '😡', '😴', '🤩'];
type Entry = { id: string; entry_date: string; title: string | null; body: string; mood: string | null };
/** Private diary ("دفترچه خاطرات / دلنوشته"): only its author can read it (enforced by the database, not even Mana). */
export default function Diary() {
  const { me } = useAuth(); const kid = useKid(); const act = useAction(); const list = useLoad(() => api<Entry[]>('/diary'));
  const canWrite = (me!.permissions.diary ?? 0) >= 2;
  const [e, setE] = useState<Partial<Entry> | null>(null); const [del, setDel] = useState<Entry | null>(null);
  const save = () => act(async () => { const b = { title: e!.title?.trim() || null, body: e!.body ?? '', mood: e!.mood ?? null, entry_date: e!.entry_date };
    if (e!.id) await api(`/diary/${e!.id}`, { method: 'PATCH', body: b }); else await api('/diary', { body: b }); setE(null); await list.reload(); }, 'ذخیره شد 💜');
  return <div className="space-y-3 max-w-2xl"><div className="flex items-center justify-between"><h1 className={kid ? 'text-3xl font-extrabold' : 'text-xl font-extrabold'}>📖 دفترچه‌ی خاطرات من</h1>
      {canWrite && <button className={`btn btn-teal ${kid ? '!text-xl' : ''}`} onClick={() => setE({ entry_date: tehranToday(), mood: '😊', body: '' })}>＋ نوشتن</button>}</div>
    <p className="text-sm opacity-70">{kid ? '🔒 این دفترچه را فقط تو و مامان می‌بینید؛ بقیه‌ی خانواده نمی‌بینند.' : '🔒 این دفترچه فقط برای خودت است؛ هیچ‌کس دیگری آن را نمی‌بیند.'}</p>
    {!canWrite && <p role="note" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 text-sm">👁 نوشتن در دفترچه برای این حساب غیرفعال است؛ فقط می‌توانی بخوانی.</p>}
    <Loading error={list.error} loading={list.loading} />
    {list.data?.length === 0 && <Empty>هنوز چیزی ننوشته‌ای. هر وقت دلت خواست اینجا بنویس ✍️</Empty>}
    {list.data?.map((x) => <article key={x.id} className={`${card(kid)} space-y-1`}>
      <div className="flex items-center gap-2"><span className="text-2xl">{x.mood ?? '📝'}</span><b className="flex-1">{x.title || 'بدون عنوان'}</b><span className="text-xs opacity-60">{fmtDate(x.entry_date)}</span></div>
      <p className="whitespace-pre-wrap leading-8">{x.body}</p>
      <div className="flex gap-2"><SpeakButton text={`${x.title ?? ''}. ${x.body}`} />{canWrite && <><button className="btn btn-ghost" onClick={() => setE(x)}>✏️ ویرایش</button><button className="btn btn-ghost" onClick={() => setDel(x)}>🗑 حذف</button></>}</div></article>)}
    {e && <Modal title={e.id ? 'ویرایش دلنوشته' : 'دلنوشته‌ی تازه'} onClose={() => setE(null)}>
      <Field label="تاریخ"><DateField value={e.entry_date} onChange={(v) => setE({ ...e, entry_date: v ?? tehranToday() })} /></Field>
      <Field label="حال و هوا"><div className="flex flex-wrap gap-1">{MOODS.map((m) => <button key={m} type="button" className={`text-3xl rounded-xl p-1 ${e.mood === m ? 'bg-teal-soft ring-2 ring-teal-mana' : ''}`} onClick={() => setE({ ...e, mood: m })}>{m}</button>)}</div></Field>
      <Field label="عنوان (اختیاری)"><input className="input" maxLength={120} value={e.title ?? ''} onChange={(x) => setE({ ...e, title: x.target.value })} /></Field>
      <Field label="هر چه در دلت هست…"><textarea className="input min-h-48" maxLength={10000} value={e.body ?? ''} onChange={(x) => setE({ ...e, body: x.target.value })} /></Field>
      <div className="flex gap-2 flex-wrap"><DictateButton kid={kid} onText={(t) => setE((p) => ({ ...p, body: ((p?.body ?? '') + ' ' + t).trim() }))} /><SpeakButton text={e.body ?? ''} />
        <button className="btn btn-teal flex-1" disabled={!(e.body ?? '').trim()} onClick={save}>ذخیره</button></div></Modal>}
    {del && <Confirm text="این نوشته برای همیشه پاک شود؟" onYes={() => act(async () => { await api(`/diary/${del.id}`, { method: 'DELETE' }); setDel(null); await list.reload(); }, 'حذف شد')} onNo={() => setDel(null)} />}</div>;
}
