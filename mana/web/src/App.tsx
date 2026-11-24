import { useState } from 'react';
import { useAuth } from './auth';
import { errText } from './api';
import ParentApp from './parent/ParentApp';
import ChildApp from './child/ChildApp';

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
      <button className="btn btn-teal w-full" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود'}</button></form></main>;
}
export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <p className="p-8 text-center text-slate-500">دنیای کوچک ما…</p>;
  if (!me) return <Login />;
  return me.role === 'child' ? <ChildApp /> : <ParentApp />;
}
