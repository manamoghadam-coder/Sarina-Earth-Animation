import { useState } from 'react';
import { api } from '../api';
import { Empty, Field, useAction, useLoad } from '../ui';

const MODS: [string, string, string][] = [
  ['tasks', '✅ کارها و پروژه‌ها', 'کارهای شخصی/کاری مانا'], ['events', '📅 تقویم و رویدادها', 'جلسات و قرارها'], ['finance', '💰 مالی', 'درآمد، هزینه، اقساط، بودجه — حساس'],
  ['goals', '🎯 اهداف و عادت‌ها', 'اهداف شخصی'], ['children', '👨‍👩‍👧‍👦 برنامه و پاداش کودکان', 'برنامه، تأیید ستاره، جوایز، اعلان‌ها'], ['photos', '🖼 تصاویر کودکان', 'گالری سارینا و سامان'], ['home', '🛒 خانه‌داری', 'لیست خرید و برنامه‌ی غذایی'],
];
const FEATS: [string, string, string][] = [
  ['diary', '📖 دفترچه‌ی خاطرات', 'دفترچه و مرور شبانه؛ دفترچه‌ی کودکان را مانا هم می‌تواند بخواند، دفترچه‌ی وحید خصوصی است. «مشاهده» یعنی فقط خواندن'], ['chat', '💬 چت خانوادگی', 'گفتگو بین همه‌ی اعضا. «مشاهده» یعنی فقط خواندن'],
  ['inbox', '💌 پیام‌های مامان', 'دریافت نامه و پیام روزانه از مانا'], ['avatar', '🖼 تغییر عکس پروفایل', 'فرد می‌تواند عکس پروفایل خودش را عوض کند'], ['wishes', '🌠 تابلو آرزوها', 'تابلوی شخصی؛ مانا تابلوی کودکان را می‌بیند'],
];
const FEAT_DEFAULT: Record<string, number> = { diary: 2, chat: 2, inbox: 1, avatar: 2, wishes: 2 };
const LV = ['بدون دسترسی', 'فقط مشاهده', 'مشاهده و ویرایش'];

/** Mana-only: decides what other adult accounts (e.g. Vahid) can see and change. */
function AddMember({ done }: { done: () => Promise<void> }) {
  const act = useAction(); const [open, setOpen] = useState(false); const [f, setF] = useState({ username: '', display_name: '', role: 'child', password: '', theme: 'sarina', show_homework: false });
  if (!open) return <button className="btn btn-ghost mb-3" onClick={() => setOpen(true)}>＋ افزودن عضو تازه</button>;
  return <div className="border border-teal-mana rounded-2xl p-3 mb-3"><b>عضو تازه</b>
    <div className="grid grid-cols-2 gap-2 mt-2"><Field label="نام نمایشی"><input className="input" maxLength={40} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="نام کاربری (انگلیسی)"><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field>
      <Field label="نقش"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="child">کودک</option><option value="member">بزرگسال (مثل وحید)</option></select></Field>
      <Field label="رمز (حداقل ۸ نویسه)"><input className="input" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field></div>
    {f.role === 'child' && <div className="flex gap-3 flex-wrap items-center mb-2"><label>تم: <select className="input !w-32 inline-block" value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })}><option value="sarina">صورتی/بنفش</option><option value="saman">آبی/سبز</option></select></label>
      <label><input type="checkbox" checked={f.show_homework} onChange={(e) => setF({ ...f, show_homework: e.target.checked })} /> کاشی «تکالیف من» دارد</label></div>}
    <div className="flex gap-2"><button className="btn btn-teal" disabled={!f.display_name.trim() || !/^[a-z][a-z0-9_.-]{2,31}$/.test(f.username) || f.password.length < 8}
      onClick={() => act(async () => { await api('/members', { body: { ...f, display_name: f.display_name.trim() } }); setOpen(false); setF({ username: '', display_name: '', role: 'child', password: '', theme: 'sarina', show_homework: false }); await done(); }, 'حساب ساخته شد؛ رمز را به خودش بدهید')}>ساختن حساب</button><button className="btn btn-ghost" onClick={() => setOpen(false)}>انصراف</button></div></div>;
}

export function AccessPanel() {
  const m = useLoad(() => api<any[]>('/members')); const act = useAction(); const [pw, setPw] = useState<Record<string, string>>({});
  const save = (id: string, body: any) => act(async () => { await api(`/members/${id}`, { method: 'PATCH', body }); await m.reload(); }, 'ذخیره شد');
  return <section className="card"><h2 className="font-bold mb-1">👥 حساب‌ها و دسترسی‌ها</h2>
    <p className="text-sm text-slate-500 mb-3">برای هر نفر (وحید، سارینا، سامان) سطح دسترسی تعیین کنید. بخش‌های کاری فقط برای حساب بزرگسال‌اند و پیش‌فرضشان «بدون دسترسی» است؛ ویژگی‌های شخصی (دفترچه، چت، پیام، عکس پروفایل) برای همه قابل تنظیم است. تغییرها فوراً اعمال می‌شود و در پایگاه داده هم اجرا می‌شود.</p>
    <AddMember done={m.reload} />
    {m.data?.length === 0 && <Empty>حساب دیگری ثبت نشده (با اسکریپت add-member بسازید).</Empty>}
    {m.data?.map((u) => <div key={u.id} className="border border-slate-200 rounded-2xl p-3 mb-3">
      <div className="flex items-center justify-between mb-2"><b>{u.role === 'child' ? '🧒' : '🧑'} {u.display_name} <span className="text-xs text-slate-500" dir="ltr">({u.username})</span></b>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" className="w-5 h-5" checked={u.active} onChange={(e) => save(u.id, { active: e.target.checked })} />فعال</label></div>
      {(u.role === 'member' ? MODS : []).map(([k, t, d]) => <div key={k} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0"><div><div>{t}</div><div className="text-xs text-slate-500">{d}</div></div>
        <select aria-label={t} className="input !w-44" value={u.permissions[k] ?? 0} onChange={(e) => save(u.id, { permissions: { [k]: +e.target.value } })}>{LV.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>)}
      <div className="text-xs font-bold text-slate-500 mt-3">ویژگی‌های شخصی</div>
      {FEATS.map(([k, t, d]) => <div key={k} className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0"><div><div>{t}</div><div className="text-xs text-slate-500">{d}</div></div>
        <select aria-label={`${t} — ${u.display_name}`} className="input !w-44" value={u.permissions[k] ?? FEAT_DEFAULT[k]} onChange={(e) => save(u.id, { permissions: { [k]: +e.target.value } })}>{LV.map((l, i) => <option key={i} value={i}>{l}</option>)}</select></div>)}
      <p className="text-xs text-slate-500 mt-2">MANA AI، مدیریت حساب‌ها و رمز کودکان همیشه فقط برای مانا است.</p>
      <Field label="رمز جدید برای این حساب (حداقل ۸ نویسه)"><div className="flex gap-2"><input className="input" dir="ltr" value={pw[u.id] ?? ''} onChange={(e) => setPw({ ...pw, [u.id]: e.target.value })} />
        <button className="btn" disabled={(pw[u.id] ?? '').length < 8} onClick={() => act(async () => { await api(`/members/${u.id}/password`, { body: { password: pw[u.id] } }); setPw({ ...pw, [u.id]: '' }); }, 'رمز تغییر کرد')}>ثبت</button></div></Field></div>)}</section>;
}
