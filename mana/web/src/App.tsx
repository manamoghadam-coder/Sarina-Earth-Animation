import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { api, errText } from './api';
import ParentApp from './parent/ParentApp';
import ChildApp from './child/ChildApp';

function Setup({ onDone }: { onDone: () => void }) {
  const { refresh } = useAuth(); const [f, setF] = useState({ username: 'admin', display_name: '', password: '', again: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const ok = /^[a-z0-9_]{3,32}$/.test(f.username) && f.display_name.trim() && f.password.length >= 8 && f.password === f.again;
  return <main className="min-h-full grid place-items-center bg-navy-800 p-4"><form className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await api('/setup', { body: { username: f.username, display_name: f.display_name, password: f.password } }); onDone(); await refresh(); } catch (x) { setErr(errText(x)); } finally { setBusy(false); } }}>
    <img src="/logo-family.webp" alt="Our Little World" className="mx-auto w-28 h-28 rounded-full shadow-lg" /><h1 className="text-xl font-extrabold text-center mt-3">راه‌اندازی اولیه</h1>
    <p className="text-sm text-slate-500 text-center mb-4">اولین حساب، «مدیر» است: خودتان نام کاربری و رمز را انتخاب می‌کنید. بعد از ورود، از «تنظیمات ← حساب‌ها» برای وحید، سارینا و سامان حساب و رمز می‌سازید.</p>
    <label className="label" htmlFor="su">نام کاربری مدیر (انگلیسی کوچک، بدون فاصله)</label><input id="su" className="input mb-3" dir="ltr" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} />
    <label className="label" htmlFor="sn">نام نمایشی</label><input id="sn" className="input mb-3" placeholder="مثلاً مانا" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
    <label className="label" htmlFor="sp">رمز عبور (حداقل ۸ نویسه)</label><input id="sp" className="input mb-3" dir="ltr" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
    <label className="label" htmlFor="sa">تکرار رمز</label><input id="sa" className="input mb-3" dir="ltr" type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} />
    {f.again && f.password !== f.again && <p className="text-sm text-red-600 mb-2">رمزها یکی نیستند.</p>}{err && <p role="alert" className="text-red-600 text-sm mb-2">{err}</p>}
    <button className="btn btn-teal w-full" disabled={!ok || busy}>{busy ? 'در حال ساخت…' : 'ساخت حساب مدیر و ورود'}</button><p className="text-xs text-slate-400 text-center mt-3">نام کاربری و رمز را جایی امن یادداشت کنید.</p></form></main>;
}
function Login() {
  const { login } = useAuth(); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [need2fa, setNeed2fa] = useState(false); const [code, setCode] = useState('');
  return <main className="min-h-full grid place-items-center bg-navy-800 p-4">
    <form className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(u, p, need2fa ? code : undefined); } catch (x) { if ((x as any)?.body?.error === 'totp_required') { setNeed2fa(true); setErr(''); } else setErr(errText(x)); } finally { setBusy(false); } }}>
      <div className="text-center mb-5"><img src="/logo-family.webp" alt="Our Little World" className="mx-auto w-40 h-40 rounded-full shadow-lg" />
        <h1 className="text-2xl font-extrabold mt-3">دنیای کوچک ما</h1><p className="text-slate-500 text-sm">Our Little World · Four Hearts, One World</p></div>
      <label className="label" htmlFor="u">نام کاربری</label><input id="u" className="input mb-3" dir="ltr" autoCapitalize="none" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required />
      <label className="label" htmlFor="p">رمز عبور</label><input id="p" className="input mb-3" dir="ltr" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required />
      {need2fa && <><label className="label" htmlFor="c">کد تأیید دومرحله‌ای (۶ رقم)</label><input id="c" className="input mb-3" dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></>}
      {err && <p role="alert" className="text-red-600 text-sm mb-3">{err}</p>}
      <button className="btn btn-teal w-full" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود'}</button><p className="text-center text-xs text-slate-500 mt-4">رمز را فراموش کرده‌اید؟ مدیر در «تنظیمات ← حساب‌ها» رمز را عوض می‌کند؛ اگر رمز خود مدیر را فراموش کرده‌اید، فایل <b dir="ltr">reset-password.bat</b> را اجرا کنید.</p><p className="text-center text-xs text-slate-400 mt-2">نسخه ۶</p></form></main>;
}
export default function App() {
  const { me, loading } = useAuth(); const [needs, setNeeds] = useState<boolean | null>(null);
  useEffect(() => { if (!me && !loading) api<{ needs_setup: boolean }>('/setup/status').then((r) => setNeeds(r.needs_setup)).catch(() => setNeeds(false)); }, [me, loading]);
  if (loading) return <p className="p-8 text-center text-slate-500">دنیای کوچک ما…</p>;
  if (!me) return needs === null ? <p className="p-8 text-center text-slate-500">…</p> : needs ? <Setup onDone={() => setNeeds(false)} /> : <Login />;
  return me.role === 'child' ? <ChildApp /> : <ParentApp />;
}
