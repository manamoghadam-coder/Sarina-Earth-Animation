import { useState } from 'react';
import { api } from '../api';
import { fmtDate, fmtTime } from '../jalali';
import { DateField, Empty, Field, Loading, Modal, useAction, useLoad , ReadOnlyBanner } from '../ui';

const ST: Record<string, string> = { todo: 'انجام‌نشده', doing: 'در حال انجام', waiting: 'منتظر اقدام دیگران', done: 'انجام‌شده', cancelled: 'لغوشده' };
const PR = ['', 'بالا', 'متوسط', 'پایین'];
export default function Tasks() {
  const tasks = useLoad(() => api<any[]>('/tasks')); const projects = useLoad(() => api<any[]>('/projects'));
  const [filter, setFilter] = useState('open'); const [edit, setEdit] = useState<any | null>(null); const [proj, setProj] = useState(false); const act = useAction();
  const list = (tasks.data ?? []).filter((t) => (filter === 'open' ? ['todo', 'doing', 'waiting'].includes(t.status) : filter === 'all' ? true : t.status === filter));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
  return <div><ReadOnlyBanner module="tasks" />
    <div className="flex items-center justify-between mb-3"><h1 className="text-xl font-extrabold">کارها و پروژه‌ها</h1><div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setProj(true)}>پروژه‌ها ({projects.data?.length ?? 0})</button><button className="btn btn-teal" onClick={() => setEdit({ title: '', priority: 2, status: 'todo' })}>＋ کار جدید</button></div></div>
    <div className="flex gap-2 mb-3 overflow-x-auto">{[['open', 'باز'], ['done', 'انجام‌شده'], ['cancelled', 'لغوشده'], ['all', 'همه']].map(([k, t]) => <button key={k} className={`btn ${filter === k ? '' : 'btn-ghost'}`} onClick={() => setFilter(k)}>{t}</button>)}</div>
    <Loading error={tasks.error} loading={tasks.loading} />{!tasks.loading && list.length === 0 && <Empty>موردی نیست.</Empty>}
    <div className="space-y-2">{list.map((t) => { const late = t.due_date && t.due_date < today && ['todo', 'doing', 'waiting'].includes(t.status); const pj = projects.data?.find((p) => p.id === t.project_id);
      return <div key={t.id} className={`card flex items-center gap-3 ${late ? 'border-red-300' : ''}`}>
        <input type="checkbox" className="w-6 h-6" aria-label="انجام شد" checked={t.status === 'done'} onChange={(e) => act(async () => { await api(`/tasks/${t.id}/status`, { body: { status: e.target.checked ? 'done' : 'todo' } }); await tasks.reload(); })} />
        <button className="flex-1 text-start" onClick={() => setEdit(t)}><b className={t.status === 'done' ? 'line-through text-slate-400' : ''}>{t.title}</b>
          <div className="text-xs text-slate-500 flex gap-2 flex-wrap mt-1"><span className="chip">{ST[t.status]}</span><span className="chip">اولویت {PR[t.priority]}</span>{t.due_date && <span className={late ? 'text-red-600 font-bold' : ''}>مهلت: {fmtDate(t.due_date)} {fmtTime(t.due_time)}</span>}{pj && <span>📁 {pj.title}</span>}{t.assignee && <span>👤 {t.assignee}</span>}</div></button></div>; })}</div>
    {edit && <Modal title={edit.id ? 'ویرایش کار' : 'کار جدید'} onClose={() => setEdit(null)}>
      <Field label="عنوان"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
      <Field label="توضیحات"><textarea className="input" rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="مسئول"><input className="input" value={edit.assignee ?? ''} onChange={(e) => setEdit({ ...edit, assignee: e.target.value })} /></Field>
        <Field label="پروژه"><select className="input" value={edit.project_id ?? ''} onChange={(e) => setEdit({ ...edit, project_id: e.target.value || null })}><option value="">—</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
        <Field label="اولویت"><select className="input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: +e.target.value })}><option value={1}>بالا</option><option value={2}>متوسط</option><option value={3}>پایین</option></select></Field>
        <Field label="وضعیت"><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
      <Field label="تاریخ شروع"><DateField allowEmpty value={edit.start_date} onChange={(v) => setEdit({ ...edit, start_date: v })} /></Field>
      <Field label="مهلت (تاریخ)"><DateField allowEmpty value={edit.due_date} onChange={(v) => setEdit({ ...edit, due_date: v })} /></Field>
      <Field label="ساعت مهلت (اختیاری، برای اعلان)"><input type="time" className="input" value={edit.due_time ?? ''} onChange={(e) => setEdit({ ...edit, due_time: e.target.value || null })} /></Field>
      <div className="flex gap-2"><button className="btn btn-teal flex-1" onClick={() => act(async () => { const b = { title: edit.title, description: edit.description ?? null, assignee: edit.assignee ?? null, project_id: edit.project_id ?? null, priority: edit.priority, status: edit.status, start_date: edit.start_date ?? null, due_date: edit.due_date ?? null, due_time: edit.due_time ?? null };
        edit.id ? await api(`/tasks/${edit.id}`, { method: 'PATCH', body: b }) : await api('/tasks', { body: b }); setEdit(null); await tasks.reload(); }, 'ذخیره شد')}>ذخیره</button>
        {edit.id && <button className="btn btn-danger" onClick={() => confirm('این کار حذف شود؟') && act(async () => { await api(`/tasks/${edit.id}`, { method: 'DELETE' }); setEdit(null); await tasks.reload(); })}>حذف</button>}</div></Modal>}
    {proj && <ProjectsModal list={projects.data ?? []} onClose={() => setProj(false)} reload={projects.reload} />}
  </div>;
}
function ProjectsModal({ list, onClose, reload }: { list: any[]; onClose: () => void; reload: () => Promise<void> }) {
  const [title, setTitle] = useState(''); const act = useAction();
  return <Modal title="پروژه‌ها" onClose={onClose}>
    {list.map((p) => <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100"><span>📁 {p.title} <span className="chip">{p.status === 'active' ? 'فعال' : p.status === 'done' ? 'تمام‌شده' : 'بایگانی'}</span></span>
      <span className="flex gap-1"><button className="btn btn-ghost !py-1" onClick={() => act(async () => { await api(`/projects/${p.id}`, { method: 'PATCH', body: { status: p.status === 'active' ? 'done' : 'active' } }); await reload(); })}>{p.status === 'active' ? 'پایان' : 'فعال'}</button>
        <button className="btn btn-ghost !py-1" aria-label="حذف" onClick={() => confirm('پروژه حذف شود؟ کارهایش می‌مانند.') && act(async () => { await api(`/projects/${p.id}`, { method: 'DELETE' }); await reload(); })}>🗑</button></span></div>)}
    <div className="flex gap-2 mt-3"><input className="input" placeholder="نام پروژه‌ی جدید" value={title} onChange={(e) => setTitle(e.target.value)} /><button className="btn btn-teal" disabled={!title.trim()} onClick={() => act(async () => { await api('/projects', { body: { title } }); setTitle(''); await reload(); })}>افزودن</button></div></Modal>;
}
