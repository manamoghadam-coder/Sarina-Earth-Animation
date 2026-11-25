import { useState } from 'react';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { instantFa } from '../jalali';
import { Empty, Field, useAction, useLoad, useToast } from '../ui';

const mb = (b: number) => `${(b / 1048576).toFixed(1)} MB`;
export function BackupPanel() {
  const b = useLoad(() => api<any>('/backups')); const act = useAction(); const toast = useToast(); const [busy, setBusy] = useState(false); const [iv, setIv] = useState<string>(''); const [keep, setKeep] = useState<string>('');
  const run = async (force: boolean) => { setBusy(true); try { const r = await api<any>(`/backups/run${force ? '?force=1' : ''}`, { body: {} }); toast(r.db || r.files ? 'پشتیبان ساخته شد' : 'از آخرین پشتیبان تغییری نکرده؛ نسخه‌ی تکراری ساخته نشد'); await b.reload(); } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); } };
  return <section className="card"><h2 className="font-bold mb-1">💾 پشتیبان‌گیری</h2><p className="text-sm text-slate-500 mb-2">پشتیبان خودکار در بازه‌ی زمانی تنظیم‌شده انجام می‌شود (پیش‌فرض هر ۲۴ ساعت، بعد از ساعت ۳ بامداد). <b>اگر از آخرین پشتیبان چیزی تغییر نکرده باشد، نسخه‌ی تکراری ساخته نمی‌شود</b>؛ پایگاه داده و فایل‌ها (عکس، کتابخانه، آشپزی، پیوست‌ها) جدا بررسی می‌شوند و فقط بخشِ تغییرکرده نسخه‌ی تازه می‌گیرد. آخرین نسخه‌ی هر بخش هرگز پاک نمی‌شود.</p>
    <div className="flex gap-2 items-end flex-wrap mb-2"><Field label="بازه (ساعت)"><input className="input !w-24" type="number" min={1} max={168} value={iv || b.data?.intervalHours || 24} onChange={(e) => setIv(e.target.value)} /></Field><Field label="تعداد نسخه‌ی نگهداری"><input className="input !w-24" type="number" min={2} max={60} value={keep || b.data?.keep || 7} onChange={(e) => setKeep(e.target.value)} /></Field>
      <button className="btn mb-3" onClick={() => act(async () => { await api('/backups/settings', { method: 'PUT', body: { interval_hours: +(iv || b.data?.intervalHours || 24), keep: +(keep || b.data?.keep || 7) } }); await b.reload(); }, 'ذخیره شد')}>ثبت</button></div>
    <p className="text-xs text-slate-500 mb-2">آخرین بررسی: {b.data?.lastCheck ? instantFa(b.data.lastCheck) : 'هنوز انجام نشده'}</p>
    <div className="flex gap-2 flex-wrap mb-2"><button className="btn btn-teal" disabled={busy} onClick={() => run(false)}>{busy ? 'در حال بررسی…' : 'پشتیبان‌گیری (فقط اگر تغییری بوده)'}</button><button className="btn btn-ghost" disabled={busy} onClick={() => run(true)}>ساخت اجباری</button></div>
    {b.data?.items.length === 0 && <Empty>هنوز پشتیبانی نیست.</Empty>}{b.data?.items.slice(0, 8).map((x: any) => <div key={x.name} className="flex justify-between text-sm py-1 border-b border-slate-100"><span dir="ltr">{x.name}</span><span>{mb(x.bytes)} · {instantFa(x.at)} · <a className="underline" href={`/api/backups/${x.name}`}>دانلود</a></span></div>)}</section>;
}

const PROV: Record<string, string> = { bale: 'بله', telegram: 'تلگرام' };
/** Link the account to Bale / Telegram so notifications also arrive as bot messages. Switching provider is a server setting (MESSENGER_PROVIDERS). */
export function MessengerPanel() {
  const st = useLoad(() => api<any>('/messenger/status')); const act = useAction(); const toast = useToast(); const [code, setCode] = useState<Record<string, string>>({});
  return <section className="card"><h2 className="font-bold mb-1">💬 اتصال به بله / تلگرام</h2><p className="text-sm text-slate-500 mb-2">اعلان‌های مهم (رویدادها، اقساط، گزارش هفتگی، درخواست‌ها) علاوه بر اعلان برنامه، در پیام‌رسان هم می‌آید و با دستورهای <code>/today</code>، <code>/list</code>، <code>/add</code> می‌توانید از آنجا خلاصه‌ی امروز و لیست خرید را ببینید. بله به‌صورت پیش‌فرض فعال است؛ تلگرام هم در صورت فعال بودن توکنش روی سرور قابل اتصال است.</p>
    {st.data?.providers.map((p: any) => <div key={p.provider} className="border border-slate-200 rounded-2xl p-3 mb-2"><div className="flex items-center justify-between"><b>{PROV[p.provider]}</b>
      {!p.active ? <span className="chip">روی سرور فعال نیست</span> : p.link ? <span className="chip !bg-green-100">متصل ✅</span> : <span className="chip">متصل نیست</span>}</div>
      {p.active && !p.link && <div className="mt-2">{code[p.provider] ? <div className="text-sm">در {PROV[p.provider]} به ربات پیام بدهید: <code dir="ltr" className="select-all">/start {code[p.provider]}</code> (۱۰ دقیقه اعتبار)</div>
        : <button className="btn btn-teal" onClick={() => act(async () => { const r = await api<any>('/messenger/link-code', { body: { provider: p.provider } }); setCode({ ...code, [p.provider]: r.code }); })}>دریافت کد اتصال</button>}</div>}
      {p.link && <div className="flex gap-2 flex-wrap mt-2"><label className="text-sm flex items-center gap-1"><input type="checkbox" checked={p.link.enabled} onChange={(e) => act(async () => { await api('/messenger/toggle', { body: { provider: p.provider, enabled: e.target.checked } }); await st.reload(); })} /> ارسال اعلان‌ها</label>
        <button className="btn btn-ghost !py-1" onClick={async () => { try { const r = await api<any>('/messenger/test', { body: {} }); toast(r.status ?? 'ارسال شد'); } catch (e) { toast(errText(e), 'err'); } }}>پیام آزمایشی</button>
        <button className="btn btn-ghost !py-1" onClick={() => act(async () => { await api('/messenger/unlink', { body: { provider: p.provider } }); setCode({}); await st.reload(); }, 'قطع شد')}>قطع اتصال</button></div>}</div>)}</section>;
}

const ROLE: Record<string, string> = { parent: 'مدیر', member: 'بزرگسال', child: 'کودک' };
export function AccountsPanel() {
  const users = useLoad(() => api<any[]>('/users')); const { me } = useAuth(); const act = useAction(); const [edit, setEdit] = useState<any | null>(null);
  const [f, setF] = useState({ username: '', display_name: '', role: 'member', age_group: 'teen', password: '' });
  const preset = (username: string, display_name: string, role: string, age_group = 'teen') => setF({ username, display_name, role, age_group, password: '' });
  const minPw = f.role === 'parent' ? 8 : 4;
  return <section className="card"><h2 className="font-bold mb-1">🧑‍🤝‍🧑 حساب‌ها (فقط مدیر)</h2><p className="text-sm text-slate-500 mb-2">اینجا نام کاربری، نام و رمز همه‌ی اعضا را خودتان تعیین و هر وقت خواستید عوض می‌کنید. با عوض‌شدن رمز، آن فرد از همه‌ی دستگاه‌ها خارج می‌شود.</p>
    {users.data?.map((u) => <div key={u.id} className={`py-2 border-b border-slate-100 ${u.active ? '' : 'opacity-50'}`}><div className="flex items-center justify-between gap-2"><span>{u.display_name} <span className="text-xs text-slate-500" dir="ltr">({u.username})</span> <span className="chip">{ROLE[u.role]}</span>{u.id === me?.id ? <span className="chip">شما</span> : null}</span>
      <span className="flex items-center gap-2">{u.id !== me?.id && <label className="text-sm flex items-center gap-1"><input type="checkbox" checked={u.active} onChange={(e) => act(async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: e.target.checked } }); await users.reload(); })} /> فعال</label>}
        <button className="btn btn-ghost !py-1" onClick={() => setEdit(edit?.id === u.id ? null : { id: u.id, role: u.role, username: u.username, display_name: u.display_name, password: '' })}>ویرایش</button></span></div>
      {edit?.id === u.id && <div className="mt-2 grid sm:grid-cols-3 gap-2 items-end"><Field label="نام کاربری"><input className="input" dir="ltr" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value.toLowerCase() })} /></Field><Field label="نام نمایشی"><input className="input" value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} /></Field>
        <button className="btn btn-teal mb-3" disabled={!/^[a-z0-9_]{3,32}$/.test(edit.username) || !edit.display_name.trim()} onClick={() => act(async () => { await api(`/users/${u.id}`, { method: 'PATCH', body: { username: edit.username, display_name: edit.display_name } }); setEdit(null); await users.reload(); }, 'ذخیره شد')}>ذخیره‌ی نام</button>
        {u.id !== me?.id && <><Field label={`رمز جدید (حداقل ${u.role === 'parent' ? 8 : 4} نویسه)`}><input className="input" dir="ltr" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          <button className="btn mb-3" disabled={edit.password.length < (u.role === 'parent' ? 8 : 4)} onClick={() => act(async () => { await api(`/users/${u.id}/password`, { body: { password: edit.password } }); setEdit(null); }, 'رمز عوض شد')}>تغییر رمز</button></>}
        {u.id === me?.id && <p className="text-xs text-slate-500 sm:col-span-3">رمز خودتان را از بخش «تغییر رمز عبور» پایین‌تر عوض کنید.</p>}</div>}</div>)}
    <h3 className="font-bold mt-3 mb-1">افزودن حساب جدید</h3>
    <div className="flex gap-1 flex-wrap mb-2"><span className="text-xs text-slate-500 self-center">پیشنهاد سریع:</span>{[['vahid', 'وحید', 'member', 'teen'], ['sarina', 'سارینا', 'child', 'teen'], ['saman', 'سامان', 'child', 'young'], ['mana', 'مانا', 'parent', 'teen']].map(([u, n, r, a]) => <button key={u} className="chip hover:bg-teal-soft !px-3 !py-1.5" onClick={() => preset(u, n, r, a)}>{n}</button>)}</div>
    <div className="grid sm:grid-cols-2 gap-2"><Field label="نام کاربری (انگلیسی کوچک)"><input className="input" dir="ltr" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} /></Field><Field label="نام نمایشی"><input className="input" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="نوع"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">بزرگسال (دسترسی را بعداً تعیین می‌کنید)</option><option value="child">کودک</option><option value="parent">مدیر (دسترسی کامل)</option></select></Field>
      {f.role === 'child' && <Field label="گروه سنی"><select className="input" value={f.age_group} onChange={(e) => setF({ ...f, age_group: e.target.value })}><option value="young">کودک خردسال (حدود ۷ سال، رابط تصویری)</option><option value="teen">نوجوان</option></select></Field>}
      <Field label={`رمز عبور (حداقل ${minPw} نویسه)`}><input className="input" dir="ltr" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field></div>
    <button className="btn btn-teal" disabled={!/^[a-z0-9_]{3,32}$/.test(f.username) || !f.display_name.trim() || f.password.length < minPw} onClick={() => act(async () => { await api('/users', { body: { ...f, age_group: f.role === 'child' ? f.age_group : undefined } }); setF({ ...f, username: '', display_name: '', password: '' }); await users.reload(); }, 'حساب ساخته شد')}>＋ ساخت حساب</button></section>;
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
