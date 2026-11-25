import { useState } from 'react';
import { api } from '../api';
import { useLevel } from '../auth';
import { MONTHS, WEEKDAYS, addDays, fa, parts, tehranToday, wd } from '../jalali';
import { Field, Loading, Modal, ReadOnlyBanner, useAction, useLoad } from '../ui';

const SLOTS = [['breakfast', '🍳 صبحانه'], ['lunch', '🍛 ناهار'], ['dinner', '🍲 شام']] as const;
/** Weekly meal plan. Meals can be linked to a recipe from the cookbook. */
export default function MealsPage() {
  const w = useLevel('shopping') >= 2; const [start, setStart] = useState(addDays(tehranToday(), -wd(tehranToday()))); const act = useAction(); const [edit, setEdit] = useState<{ day: string; slot: string; title: string; recipe_id: string } | null>(null);
  const meals = useLoad(() => api<any[]>(`/meals?from=${start}&to=${addDays(start, 6)}`), [start]); const recipes = useLoad(() => api<any[]>('/recipes').catch(() => []));
  const get = (d: string, s: string) => meals.data?.find((m) => m.day === d && m.slot === s);
  return <div className="space-y-2"><ReadOnlyBanner module="shopping" /><h1 className="text-xl font-extrabold">🍽️ برنامه‌ی غذایی هفتگی</h1>
    <div className="flex items-center justify-between"><button className="btn btn-ghost" onClick={() => setStart(addDays(start, -7))} aria-label="هفته‌ی قبل">›</button><b>{fa(parts(start).jd)} {MONTHS[parts(start).jm - 1]} تا {fa(parts(addDays(start, 6)).jd)} {MONTHS[parts(addDays(start, 6)).jm - 1]}</b><button className="btn btn-ghost" onClick={() => setStart(addDays(start, 7))} aria-label="هفته‌ی بعد">‹</button></div>
    <Loading error={meals.error} loading={meals.loading} />
    {Array.from({ length: 7 }, (_, i) => { const d = addDays(start, i); return <section key={d} className={`card ${d === tehranToday() ? '!border-teal-mana' : ''}`}><b>{WEEKDAYS[i]} <span className="text-xs text-slate-500">{fa(parts(d).jd)} {MONTHS[parts(d).jm - 1]}</span></b>
      <div className="grid grid-cols-3 gap-2 mt-1">{SLOTS.map(([s, l]) => <button key={s} disabled={!w} className="rounded-xl bg-slate-50 p-2 text-start min-h-14" onClick={() => setEdit({ day: d, slot: s, title: get(d, s)?.title ?? '', recipe_id: get(d, s)?.recipe_id ?? '' })}><div className="text-[11px] text-slate-500">{l}</div><div className="text-sm">{get(d, s)?.title ?? <span className="text-slate-300">—</span>}</div></button>)}</div></section>; })}
    {edit && <Modal title={`${SLOTS.find((x) => x[0] === edit.slot)![1]} — ${WEEKDAYS[wd(edit.day)]}`} onClose={() => setEdit(null)}>
      {recipes.data && recipes.data.length > 0 && <Field label="انتخاب از دستورهای آشپزی (اختیاری)"><select className="input" value={edit.recipe_id} onChange={(e) => { const r = recipes.data!.find((x) => x.id === e.target.value); setEdit({ ...edit, recipe_id: e.target.value, title: r ? r.title : edit.title }); }}><option value="">—</option>{recipes.data.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>}
      <Field label="چه بپزیم؟ (خالی = حذف)"><input className="input" autoFocus maxLength={120} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
      <button className="btn btn-teal w-full" onClick={() => act(async () => { await api('/meals', { method: 'PUT', body: { day: edit.day, slot: edit.slot, title: edit.title.trim(), recipe_id: edit.recipe_id || null } }); setEdit(null); await meals.reload(); }, 'ذخیره شد')}>ذخیره</button></Modal>}</div>;
}
