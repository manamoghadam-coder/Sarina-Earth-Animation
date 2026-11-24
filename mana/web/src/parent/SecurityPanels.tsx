import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { instantFa } from '../jalali';
import { Empty, Field, useAction, useLoad } from '../ui';

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
export function BackupPanel() {
  const b = useLoad(() => api<any[]>('/backups')); const act = useAction(); const [busy, setBusy] = useState(false);
  return <section className="card"><h2 className="font-bold mb-1">💾 پشتیبان‌گیری</h2><p className="text-sm text-slate-500 mb-2">هر شب ساعت ۳ بامداد خودکار از پایگاه داده و فایل‌ها (عکس‌ها، کتابخانه، آشپزی) نسخه‌ی پشتیبان گرفته می‌شود و ۷ نسخه‌ی آخر می‌ماند. برای امنیت بیشتر، گاهی نسخه را دانلود و بیرون از سرور نگه دارید.</p>
    <button className="btn btn-teal mb-2" disabled={busy} onClick={async () => { setBusy(true); await act(async () => { await api('/backups/run', { body: {} }); await b.reload(); }, 'پشتیبان ساخته شد'); setBusy(false); }}>{busy ? 'در حال ساخت…' : 'ساخت پشتیبان همین حالا'}</button>
    {b.data?.length === 0 && <Empty>هنوز پشتیبانی نیست.</Empty>}{b.data?.slice(0, 8).map((x) => <div key={x.name} className="flex justify-between text-sm py-1 border-b border-slate-100"><span dir="ltr">{x.name}</span><span>{mb(x.bytes)} · {instantFa(x.at)} · <a className="underline" href={`/api/backups/${x.name}`}>دانلود</a></span></div>)}</section>;
}

export function AccountsPanel() {
  const users = useLoad(() => api<any[]>('/users')); const act = useAction(); const [f, setF] = useState({ username: '', display_name: '', role: 'member', age_group: 'teen', password: '' });
  return <section className="card"><h2 className="font-bold mb-2">🧑‍🤝‍🧑 حساب‌ها</h2>
    {users.data?.map((u) => <div key={u.id} className={`flex items-center justify-between py-1 border-b border-slate-100 ${u.active ? '' : 'opacity-40'}`}><span>{u.display_name} <span className="text-xs text-slate-500" dir="ltr">({u.username})</span> <span className="chip">{u.role === 'parent' ? 'مدیر' : u.role === 'member' ? 'بزرگسال' : 'کودک'}</span></span>
      {u.role !== 'parent' && <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={u.active} onChange={(e) => act(async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: e.target.checked } }); await users.reload(); })} /> فعال</label>}</div>)}
    <h3 className="font-bold mt-3 mb-1">افزودن حساب جدید</h3>
    <div className="grid sm:grid-cols-2 gap-2"><Field label="نام کاربری (انگلیسی کوچک)"><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field><Field label="نام نمایشی"><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="نوع"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">بزرگسال (دسترسی را بعداً تعیین می‌کنید)</option><option value="child">کودک</option></select></Field>
      {f.role === 'child' && <Field label="گروه سنی"><select className="input" value={f.age_group} onChange={(e) => setF({ ...f, age_group: e.target.value })}><option value="young">کودک خردسال (حدود ۷ سال، رابط تصویری)</option><option value="teen">نوجوان</option></select></Field>}
      <Field label="رمز عبور (حداقل ۸ نویسه)"><input className="input" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field></div>
    <button className="btn btn-teal" disabled={!/^[a-z0-9_]{3,32}$/.test(f.username) || !f.display_name.trim() || f.password.length < 8} onClick={() => act(async () => { await api('/users', { body: { ...f, age_group: f.role === 'child' ? f.age_group : undefined } }); setF({ ...f, username: '', display_name: '', password: '' }); await users.reload(); }, 'حساب ساخته شد')}>＋ ساخت حساب</button></section>;
}

export function TwoFactorPanel() {
  const { me, refresh } = useAuth(); const act = useAction(); const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null); const [code, setCode] = useState(''); const [pw, setPw] = useState('');
  const on = (me as any)?.totp_enabled;
  return <section className="card"><h2 className="font-bold mb-1">🔐 تأیید دومرحله‌ای</h2>
    {on ? <><p className="text-sm text-green-700 mb-2">فعال است؛ هنگام ورود، کد ۶ رقمی برنامه‌ی Authenticator لازم است.</p>
      <div className="flex gap-2 flex-wrap"><input className="input !w-44" type="password" dir="ltr" placeholder="رمز عبور" value={pw} onChange={(e) => setPw(e.target.value)} /><input className="input !w-32" inputMode="numeric" dir="ltr" placeholder="کد ۶ رقمی" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn btn-danger" onClick={() => act(async () => { await api('/auth/2fa/disable', { body: { password: pw, code } }); setPw(''); setCode(''); await refresh(); }, 'غیرفعال شد')}>غیرفعال کردن</button></div></>
      : setup ? <><ol className="list-decimal ps-5 text-sm space-y-1 mb-2"><li>برنامه‌ی Google Authenticator، Microsoft Authenticator یا مشابه را روی گوشی باز کنید.</li><li>روی گوشی خودتان این لینک را بزنید (یا کلید زیر را دستی وارد کنید): <a className="underline" href={setup.uri}>افزودن به Authenticator</a></li><li>کلید: <code dir="ltr" className="select-all break-all">{setup.secret}</code></li><li>کد ۶ رقمی را اینجا بنویسید:</li></ol>
        <div className="flex gap-2"><input className="input !w-40" inputMode="numeric" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /><button className="btn btn-teal" disabled={code.length !== 6} onClick={() => act(async () => { await api('/auth/2fa/enable', { body: { code } }); setSetup(null); setCode(''); await refresh(); }, 'فعال شد')}>فعال‌سازی</button></div>
        <p className="text-xs text-amber-700 mt-2">اگر گوشی گم شود، بازیابی فقط با دسترسی به سرور ممکن است (<code dir="ltr">scripts/reset-2fa.ts</code>).</p></>
      : <button className="btn btn-teal" onClick={() => act(async () => { setSetup(await api('/auth/2fa/setup', { body: {} })); })}>راه‌اندازی تأیید دومرحله‌ای</button>}</section>;
}
