import { useState } from 'react';
import { useAuth } from './auth';
import { errText } from './api';
import ParentApp from './parent/ParentApp';
import ChildApp from './child/ChildApp';

function Login() {
  const { login } = useAuth(); const [u, setU] = useState(''); const [p, setP] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  return <main className="min-h-full grid place-items-center bg-navy-800 p-4">
    <form className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); try { await login(u, p); } catch (x) { setErr(errText(x)); } finally { setBusy(false); } }}>
      <div className="text-center mb-5"><img src="/logo.svg" alt="لوگوی خانواده BK" className="mx-auto w-24 h-24 rounded-3xl shadow-lg" />
        <h1 className="text-2xl font-extrabold mt-3">MANA</h1><p className="text-slate-500 text-sm">دستیار اجرایی زندگی و خانواده</p></div>
      <label className="label" htmlFor="u">نام کاربری</label><input id="u" className="input mb-3" dir="ltr" autoCapitalize="none" autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required />
      <label className="label" htmlFor="p">رمز عبور</label><input id="p" className="input mb-3" dir="ltr" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required />
      {err && <p role="alert" className="text-red-600 text-sm mb-3">{err}</p>}
      <button className="btn btn-teal w-full" disabled={busy}>{busy ? 'در حال ورود…' : 'ورود'}</button></form></main>;
}
export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <p className="p-8 text-center text-slate-500">MANA…</p>;
  if (!me) return <Login />;
  return me.role === 'parent' ? <ParentApp /> : <ChildApp />;
}
