import { useRef, useState } from 'react';
import { api, errText } from '../api';
import { useLevel } from '../auth';
import { fa } from '../jalali';
import { Empty, Field, Loading, ReadOnlyBanner, useAction, useLoad, useToast } from '../ui';

export const CATS: Record<string, string> = { story: '🎧 قصه', book: '📖 کتاب', learn: '🎓 آموزشی', other: '📁 سایر' };
const AUD: Record<string, string> = { all: 'همه', young: 'سامان (کودک ۷ ساله)', teen: 'سارینا (نوجوان)', adults: 'فقط بزرگ‌ترها' };
const mb = (b: number) => `${fa((b / 1048576).toFixed(1))} MB`;

export default function LibraryPage() {
  const items = useLoad(() => api<any[]>('/library')); const lv = useLevel('library'); const act = useAction(); const toast = useToast();
  const file = useRef<HTMLInputElement>(null); const [f, setF] = useState({ title: '', category: 'story', audience: 'all', description: '' }); const [busy, setBusy] = useState(false); const [play, setPlay] = useState<string | null>(null);
  const upload = async () => {
    const fl = file.current?.files?.[0]; if (!fl) return toast('ابتدا فایل را انتخاب کنید', 'err');
    const fd = new FormData(); fd.append('title', f.title || fl.name.replace(/\.[^.]+$/, '')); fd.append('category', f.category); fd.append('audience', f.audience); if (f.description) fd.append('description', f.description); fd.append('file', fl);
    setBusy(true); try { await api('/library', { form: fd }); toast('بارگذاری شد'); setF({ ...f, title: '', description: '' }); if (file.current) file.current.value = ''; await items.reload(); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  return <div className="space-y-3"><ReadOnlyBanner module="library" /><h1 className="text-xl font-extrabold">📚 کتابخانه</h1>
    {lv >= 2 && <section className="card"><h2 className="font-bold mb-2">بارگذاری فایل (PDF یا صوت)</h2>
      <p className="text-xs text-slate-500 mb-2">PDF تا ۴۰ مگابایت؛ صوت MP3/M4A/OGG/WAV تا ۱۵۰ مگابایت. نوع فایل از محتوای آن تشخیص داده می‌شود. هر بچه فقط موارد «همه» یا مخصوص گروه سنی خودش را می‌بیند.</p>
      <input ref={file} type="file" accept="application/pdf,audio/*" className="input mb-2" />
      <div className="grid sm:grid-cols-2 gap-2"><Field label="عنوان"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="دسته"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="چه کسی ببیند"><select className="input" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>{Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="توضیح (اختیاری)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      <button className="btn btn-teal" disabled={busy} onClick={upload}>{busy ? 'در حال بارگذاری… (فایل‌های بزرگ کمی طول می‌کشد)' : '⬆ بارگذاری'}</button></section>}
    <Loading error={items.error} loading={items.loading} />{items.data?.length === 0 && <Empty>هنوز فایلی نیست.</Empty>}
    {items.data?.map((x) => <div key={x.id} className="card"><div className="flex items-center gap-3"><span className="text-3xl">{x.kind === 'audio' ? '🎧' : '📄'}</span>
      <div className="flex-1"><b>{x.title}</b> <span className="chip">{CATS[x.category] ?? x.category}</span> <span className="chip">{AUD[x.audience]}</span><div className="text-xs text-slate-500">{mb(x.bytes)}{x.description ? ` · ${x.description}` : ''}</div></div>
      {x.kind === 'audio' ? <button className="btn btn-ghost" onClick={() => setPlay(play === x.id ? null : x.id)}>{play === x.id ? '⏹' : '▶ پخش'}</button> : <a className="btn btn-ghost" href={`/api/library/${x.id}/file`} target="_blank" rel="noreferrer">باز کردن</a>}
      {lv >= 2 && <button aria-label="حذف" className="btn btn-ghost" onClick={() => confirm('حذف شود؟ فایل برای همیشه پاک می‌شود.') && act(async () => { await api(`/library/${x.id}`, { method: 'DELETE' }); await items.reload(); })}>🗑</button>}</div>
      {play === x.id && <audio className="w-full mt-2" controls autoPlay src={`/api/library/${x.id}/file`} />}</div>)}</div>;
}
