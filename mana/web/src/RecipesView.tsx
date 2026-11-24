import { useState } from 'react';
import { api, errText } from './api';
import { useLevel } from './auth';
import { fa } from './jalali';
import { Empty, Field, Loading, Modal, useAction, useLoad, useToast } from './ui';
import { speak } from './voice';

/** Family cookbook. `kid` = read-only, large touch targets and read-aloud buttons. */
export function RecipesView({ kid }: { kid?: boolean }) {
  const cats = useLoad(() => api<any[]>('/recipe-categories')); const [cat, setCat] = useState<string | null>(null); const [open, setOpen] = useState<string | null>(null); const [edit, setEdit] = useState<any | null>(null); const [newCat, setNewCat] = useState('');
  const recipes = useLoad(() => api<any[]>(`/recipes${cat ? `?category_id=${cat}` : ''}`), [cat]); const lv = useLevel('recipes'); const act = useAction();
  const can = !kid && lv >= 2;
  return <div className="space-y-3"><div className="flex justify-between items-center"><h1 className={kid ? 'text-3xl font-extrabold' : 'text-xl font-extrabold'}>🍳 آشپزی</h1>{can && <button className="btn btn-teal" onClick={() => setEdit({ title: '', category_id: cat, minutes: '', servings: '', description: '', ingredients: '', steps: '', video_url: '' })}>＋ دستور جدید</button>}</div>
    <div className="flex gap-2 overflow-x-auto pb-1"><button className={`btn whitespace-nowrap ${cat === null ? '' : 'btn-ghost'}`} onClick={() => setCat(null)}>همه</button>
      {cats.data?.map((c) => <button key={c.id} className={`btn whitespace-nowrap ${cat === c.id ? '' : 'btn-ghost'}`} onClick={() => setCat(c.id)}>{c.icon} {c.name} ({fa(c.n)})</button>)}</div>
    {can && <div className="flex gap-2"><input className="input" placeholder="دسته‌ی جدید (مثلاً غذای دریایی)" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn btn-ghost" disabled={!newCat.trim()} onClick={() => act(async () => { await api('/recipe-categories', { body: { name: newCat } }); setNewCat(''); await cats.reload(); }, 'دسته اضافه شد')}>＋ دسته</button></div>}
    <Loading error={recipes.error} loading={recipes.loading} />{recipes.data?.length === 0 && <Empty>هنوز دستوری نیست.</Empty>}
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{recipes.data?.map((r) => <button key={r.id} onClick={() => setOpen(r.id)} className={kid ? 'kid-card text-start' : 'card text-start'}>
      {r.cover_id ? <img src={`/api/recipe-media/${r.cover_id}/file`} alt="" loading="lazy" className="w-full aspect-[4/3] object-cover rounded-xl mb-2" /> : <div className="w-full aspect-[4/3] rounded-xl mb-2 bg-slate-100 grid place-items-center text-5xl">🍽️</div>}
      <b className={kid ? 'text-lg' : ''}>{r.title}</b>{r.minutes ? <div className="text-xs opacity-70">⏱ {fa(r.minutes)} دقیقه</div> : null}</button>)}</div>
    {open && <RecipeModal id={open} kid={kid} can={can} onClose={() => setOpen(null)} onEdit={(r) => { setOpen(null); setEdit(r); }} onDeleted={async () => { setOpen(null); await recipes.reload(); await cats.reload(); }} />}
    {edit && <EditModal r={edit} cats={cats.data ?? []} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await recipes.reload(); await cats.reload(); }} />}</div>;
}

function RecipeModal({ id, kid, can, onClose, onEdit, onDeleted }: { id: string; kid?: boolean; can: boolean; onClose: () => void; onEdit: (r: any) => void; onDeleted: () => void }) {
  const { data: r, error, loading } = useLoad(() => api<any>(`/recipes/${id}`)); const act = useAction();
  const text = r ? `${r.title}. ${r.description ?? ''}. مواد لازم: ${(r.ingredients ?? '').replace(/\n/g, '، ')}. طرز تهیه: ${(r.steps ?? '').replace(/\n/g, '. ')}` : '';
  return <Modal title={r?.title ?? 'دستور'} onClose={onClose}><Loading error={error} loading={loading} />
    {r && <div className={kid ? 'text-lg' : ''}>
      {r.media.filter((m: any) => m.kind === 'photo').map((m: any) => <img key={m.id} src={`/api/recipe-media/${m.id}/file`} alt="" className="w-full rounded-xl mb-2" />)}
      {r.media.filter((m: any) => m.kind === 'video').map((m: any) => <video key={m.id} controls playsInline preload="metadata" className="w-full rounded-xl mb-2" src={`/api/recipe-media/${m.id}/file`} />)}
      {r.video_url && <a className="btn btn-ghost mb-2" href={r.video_url} target="_blank" rel="noreferrer">▶ دیدن ویدیو</a>}
      <div className="text-sm opacity-70 mb-2">{r.category} {r.minutes ? `· ⏱ ${fa(r.minutes)} دقیقه` : ''} {r.servings ? `· 👥 ${fa(r.servings)} نفر` : ''}</div>
      {r.description && <p className="mb-2">{r.description}</p>}
      {r.ingredients && <><h3 className="font-bold mt-2">🧂 مواد لازم</h3><ul className="list-disc ps-5 whitespace-pre-line">{r.ingredients.split('\n').filter(Boolean).map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></>}
      {r.steps && <><h3 className="font-bold mt-2">👩‍🍳 طرز تهیه</h3><p className="whitespace-pre-line leading-8">{r.steps}</p></>}
      <div className="flex gap-2 mt-3 flex-wrap"><button className="btn btn-ghost" onClick={() => speak(text)}>🔊 بخوان</button>
        {can && <><button className="btn btn-ghost" onClick={() => onEdit(r)}>ویرایش</button><button className="btn btn-danger" onClick={() => confirm('این دستور و عکس‌ها/ویدیوهایش حذف شود؟') && act(async () => { await api(`/recipes/${id}`, { method: 'DELETE' }); await onDeleted(); })}>حذف</button></>}</div></div>}</Modal>;
}

function EditModal({ r, cats, onClose, onSaved }: { r: any; cats: any[]; onClose: () => void; onSaved: () => void }) {
  const [e, setE] = useState({ ...r, minutes: r.minutes ?? '', servings: r.servings ?? '', video_url: r.video_url ?? '', description: r.description ?? '', ingredients: r.ingredients ?? '', steps: r.steps ?? '' }); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const toast = useToast();
  const media = r.media as any[] | undefined;
  const save = async () => {
    setBusy(true);
    try {
      const b = { title: e.title, category_id: e.category_id || null, description: e.description || null, ingredients: e.ingredients || null, steps: e.steps || null, minutes: e.minutes === '' ? null : +e.minutes, servings: e.servings === '' ? null : +e.servings, video_url: e.video_url || null };
      const id = r.id ? (await api(`/recipes/${r.id}`, { method: 'PATCH', body: b }), r.id) : (await api<any>('/recipes', { body: b })).id;
      for (const f of files) { const fd = new FormData(); fd.append('file', f); await api(`/recipes/${id}/media`, { form: fd }); }
      toast('ذخیره شد'); onSaved();
    } catch (x) { toast(errText(x), 'err'); } finally { setBusy(false); }
  };
  return <Modal title={r.id ? 'ویرایش دستور' : 'دستور جدید'} onClose={onClose}>
    <Field label="عنوان غذا"><input className="input" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></Field>
    <div className="grid grid-cols-3 gap-2"><Field label="دسته"><select className="input" value={e.category_id ?? ''} onChange={(x) => setE({ ...e, category_id: x.target.value })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</select></Field>
      <Field label="دقیقه"><input type="number" className="input" value={e.minutes} onChange={(x) => setE({ ...e, minutes: x.target.value })} /></Field><Field label="نفر"><input type="number" className="input" value={e.servings} onChange={(x) => setE({ ...e, servings: x.target.value })} /></Field></div>
    <Field label="توضیح کوتاه"><input className="input" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} /></Field>
    <Field label="مواد لازم (هر خط یک مورد)"><textarea className="input" rows={4} value={e.ingredients} onChange={(x) => setE({ ...e, ingredients: x.target.value })} /></Field>
    <Field label="طرز تهیه"><textarea className="input" rows={5} value={e.steps} onChange={(x) => setE({ ...e, steps: x.target.value })} /></Field>
    <Field label="لینک ویدیو (یوتیوب/آپارات؛ اختیاری)"><input className="input" dir="ltr" value={e.video_url} onChange={(x) => setE({ ...e, video_url: x.target.value })} /></Field>
    <Field label="عکس‌ها و ویدیو (JPEG/PNG/WebP تا ۸MB، MP4/WebM تا ۲۵۰MB)"><input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="input" onChange={(x) => setFiles(Array.from(x.target.files ?? []))} /></Field>
    {media?.length ? <p className="text-xs text-slate-500 mb-2">فایل‌های فعلی: {media.length} (برای حذف: {media.map((m) => <button key={m.id} className="underline me-2" onClick={async () => { await api(`/recipe-media/${m.id}`, { method: 'DELETE' }); toast('حذف شد'); onSaved(); }}>{m.kind === 'photo' ? '🖼' : '🎬'} حذف</button>)})</p> : null}
    <button className="btn btn-teal w-full" disabled={busy || !e.title.trim()} onClick={save}>{busy ? 'در حال ذخیره و بارگذاری…' : 'ذخیره'}</button></Modal>;
}
