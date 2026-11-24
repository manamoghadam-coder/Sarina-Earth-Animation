import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { AccessPanel } from './AccessPanel';
import { QuotesPanel } from './QuotesPanel';
import { ContentPanel } from './ContentPanel';
import { AccountsPanel, BackupPanel, MessengerPanel, TwoFactorPanel } from './SecurityPanels';
import { PushPanel } from '../notify';
import { ttsStatus, sttSupported } from '../voice';
import { Field, useAction } from '../ui';

export default function SettingsPage() {
  const { logout, me } = useAuth(); const act = useAction(); const [cur, setCur] = useState(''); const [nxt, setNxt] = useState('');
  return <div className="space-y-4 max-w-xl"><h1 className="text-xl font-extrabold">تنظیمات</h1>
    {me!.role === 'parent' && <AccessPanel />}
    <MessengerPanel />
    {me!.role === 'parent' && <QuotesPanel />}
    {me!.role === 'parent' && <ContentPanel />}
    {me!.role === 'parent' && <AccountsPanel />}
    {me!.role === 'parent' && <TwoFactorPanel />}
    {me!.role === 'parent' && <BackupPanel />}
    <section className="card"><h2 className="font-bold mb-2">🔔 اعلان روی این دستگاه</h2><PushPanel /><p className="text-xs text-slate-500 mt-2">برای دریافت اعلان هنگام بسته بودن برنامه، باید روی هر دستگاه یک‌بار فعال شود.</p></section>
    <section className="card"><h2 className="font-bold mb-2">🎙️ وضعیت قابلیت صوتی این دستگاه</h2>
      <p>خواندن متن فارسی: <b>{({ ok: 'آماده (صدای فارسی موجود)', maybe: 'موتور گفتار هست ولی صدای فارسی گزارش نشده؛ آزمایش کنید', none: 'پشتیبانی نمی‌شود' })[ttsStatus()]}</b></p>
      <p>تشخیص گفتار فارسی: <b>{sttSupported() ? 'پشتیبانی می‌شود (نیاز به اینترنت)' : 'پشتیبانی نمی‌شود؛ جایگزین: دکمه‌های تصویری'}</b></p></section>
    <section className="card"><h2 className="font-bold mb-2">🔑 تغییر رمز عبور</h2>
      <Field label="رمز فعلی"><input type="password" className="input" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="رمز جدید (حداقل ۸ نویسه)"><input type="password" className="input" dir="ltr" value={nxt} onChange={(e) => setNxt(e.target.value)} /></Field>
      <button className="btn" disabled={nxt.length < 8 || !cur} onClick={() => act(async () => { await api('/auth/password', { body: { current: cur, next: nxt } }); await logout().catch(() => {}); location.reload(); }, 'رمز تغییر کرد')}>تغییر رمز</button></section>
    <button className="btn btn-ghost" onClick={logout}>خروج از حساب</button></div>;
}
