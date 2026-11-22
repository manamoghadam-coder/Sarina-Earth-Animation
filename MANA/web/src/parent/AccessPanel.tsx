import { useState } from 'react';
import { api } from '../api';
import { Empty, Field, useAction, useLoad } from '../ui';

const MODS: [string, string, string][] = [
  ['tasks', '✅ کارها و پروژه‌ها', 'کارهای شخصی/کاری مانا'], ['events', '📅 تقویم و رویدادها', 'جلسات و قرارها'], ['finance', '💰 مالی', 'درآمد، هزینه، اقساط، بودجه — حساس'],
  ['goals', '🎯 اهداف و عادت‌ها', 'اهداف شخصی'], ['children', '👨‍👩‍👧‍👦 برنامه و پاداش کودکان', 'برنامه، تأیید ستاره، جوایز، اعلان‌ها'], ['photos', '🖼 تصاویر کودکان', 'گالری سارینا و سامان'],
];
const FEATS: [string, string, string][] = [
  ['diary', '📖 دفترچه‌ی خاطرات', 'خصوصی؛ فقط خود فرد می‌بیند (حتی مانا نمی‌بیند). «مشاهده» یعنی فقط خواندن'], ['chat', '💬 چت خانوادگی', 'گفتگو بین همه‌ی اعضا. «مشاهده» یعنی فقط خواندن'],
  ['inbox', '💌 پیام‌های مامان', 'دریافت نامه و پیام روزانه از مانا'], ['avatar', '🖼 تغییر عکس پروفایل', 'فرد می‌تواند عکس پروفایل خودش را عوض کند'],
];
const FEAT_DEFAULT: Record<string, number> = { diary: 2, chat: 2, inbox: 1, avatar: 2 };
const LV = ['بدون دسترسی', 'فقط مشاهده', 'مشاهده و ویرایش'];

/** Mana-only: decides what other adult accounts (e.g. Vahid) can see and change. */
export function AccessPanel() {
  const m = useLoad(() => api<any[]>('/members')); const act = useAction(); const [pw, setPw] = useState<Record<string, string>>({});
  const save = (id: string, body: any) => act(async () => { await api(`/members/${id}`, { method: 'PATCH', body }); await m.reload(); }, 'ذخیره شد');
  return <section className="card"><h2 className="font-bold mb-1">👥 حساب‌ها و دسترسی‌ها</h2>
    <p className="text-sm text-slate-500 mb-3">برای هر نفر (وحید، سارینا، سامان) سطح دسترسی تعیین کنید. بخش‌های کاری فقط برای حساب بزرگسال‌اند و پیش‌فرضشان «بدون دسترسی» است؛ ویژگی‌های شخصی (دفترچه، چت، پیام، عکس پروفایل) برای همه قابل تنظیم است. تغییرها فوراً اعمال می‌شود و در پایگاه داده هم اجرا می‌شود.</p>
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
