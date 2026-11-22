import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errText } from './api';
import { speak } from './voice';
import { useToast } from './ui';

export type Notif = { id: string; kind: string; title: string; body: string; icon: string; voice_text: string | null; ref_type: string | null };
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

/** In-app delivery: polls due notifications; optionally reads them aloud (children with voice notifications). */
export function NotificationCenter({ speakAloud, kid, paused }: { speakAloud: boolean; kid?: boolean; paused?: boolean }) {
  const go = useNavigate();
  const [queue, setQueue] = useState<Notif[]>([]); const spoken = useRef(new Set<string>()); const toast = useToast();
  useEffect(() => {
    let live = true;
    const tick = async () => { try { const rows = await api<Notif[]>('/notifications?unseen=1'); if (live) setQueue(rows.slice(0, 3)); } catch { /* offline: ignore */ } };
    void tick(); const h = setInterval(tick, 20000); const vis = () => document.visibilityState === 'visible' && tick(); document.addEventListener('visibilitychange', vis);
    return () => { live = false; clearInterval(h); document.removeEventListener('visibilitychange', vis); };
  }, []);
  const cur = paused ? undefined : queue[0];
  useEffect(() => { if (cur && speakAloud && !spoken.current.has(cur.id)) { spoken.current.add(cur.id); void speak(cur.voice_text ?? cur.body); } }, [cur, speakAloud]);
  if (!cur) return null;
  const act = async (p: 'seen' | 'done' | 'snooze') => { try { const r = await api(`/notifications/${cur.id}/${p}`, { body: p === 'snooze' ? { minutes: 10 } : {} }); if (p === 'done') toast((r as any).awaiting_approval ? 'آفرین! منتظر تأیید مامان ✨' : 'ثبت شد ✅'); } catch (e) { toast(errText(e), 'err'); } setQueue((q) => q.slice(1)); };
  return <div role="alertdialog" aria-label="اعلان" className={`fixed top-3 inset-x-3 z-[90] mx-auto max-w-md rounded-3xl bg-white shadow-2xl border-2 border-teal-mana p-4 ${kid ? 'text-xl' : ''}`}>
    <div className="flex items-start gap-3"><span className="text-4xl">{cur.icon}</span><div className="flex-1"><b className="block">{cur.title}</b><span>{cur.body}</span></div>
      {speakAloud && <button aria-label="دوباره بخوان" className="btn btn-ghost !px-3" onClick={() => speak(cur.voice_text ?? cur.body)}>🔊</button>}</div>
    <div className="flex gap-2 mt-3 flex-wrap">
      {(cur.ref_type === 'activity' || cur.ref_type === 'task') && <button className="btn btn-teal flex-1" onClick={() => act('done')}>انجام شد ✅</button>}
      {cur.ref_type === 'mom_message' && <button className="btn btn-teal flex-1" onClick={async () => { await act('seen'); go('/messages'); }}>💌 بخوان</button>}
      {cur.ref_type !== 'mom_message' && <button className="btn btn-ghost flex-1" onClick={() => act('snooze')}>۱۰ دقیقه بعد ⏰</button>}
      <button className="btn btn-ghost flex-1" onClick={() => act('seen')}>باشه</button></div>
    {queue.length > 1 && <p className="text-xs text-slate-500 mt-2">{queue.length - 1} اعلان دیگر</p>}</div>;
}

export type PushState = { supported: boolean; permission: NotificationPermission | 'unsupported'; subscribed: boolean; serverConfigured: boolean; busy: boolean; error: string | null; enable: () => Promise<void>; disable: () => Promise<void> };
export function usePush(): PushState {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [permission, setPermission] = useState<PushState['permission']>(supported ? Notification.permission : 'unsupported');
  const [subscribed, setSub] = useState(false); const [serverConfigured, setCfg] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!supported) return; (async () => { const reg = await navigator.serviceWorker.getRegistration(); setSub(!!(await reg?.pushManager.getSubscription())); try { setCfg((await api<{ configured: boolean }>('/push/key')).configured); } catch {} })(); }, [supported]);
  const enable = async () => {
    setBusy(true); setError(null);
    try {
      if (!supported) throw new Error('این مرورگر از اعلان پوش پشتیبانی نمی‌کند (در آیفون ابتدا برنامه را به صفحه اصلی اضافه کنید).');
      const { publicKey, configured } = await api<{ publicKey: string | null; configured: boolean }>('/push/key');
      if (!configured || !publicKey) throw new Error('کلیدهای اعلان پوش روی سرور تنظیم نشده است (VAPID). اعلان‌ها فقط هنگام باز بودن برنامه نمایش داده می‌شوند.');
      const perm = await Notification.requestPermission(); setPermission(perm);
      if (perm !== 'granted') throw new Error('اجازه‌ی اعلان داده نشد. از تنظیمات مرورگر/گوشی فعالش کنید.');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      await api('/push/subscribe', { body: sub.toJSON() }); setSub(true);
    } catch (e) { setError(e instanceof Error && !(e as any).status ? e.message : errText(e)); } finally { setBusy(false); }
  };
  const disable = async () => { const reg = await navigator.serviceWorker.getRegistration(); const s = await reg?.pushManager.getSubscription(); if (s) { await api('/push/unsubscribe', { body: { endpoint: s.endpoint } }).catch(() => {}); await s.unsubscribe(); } setSub(false); };
  return { supported, permission, subscribed, serverConfigured, busy, error, enable, disable };
}
export function PushPanel({ big }: { big?: boolean }) {
  const p = usePush();
  if (p.subscribed) return <div className="flex items-center gap-2 flex-wrap"><span className="chip bg-teal-100">🔔 اعلان پوش روی این دستگاه فعال است</span><button className="btn btn-ghost" onClick={p.disable}>غیرفعال</button></div>;
  return <div><button className={`btn btn-teal ${big ? '!text-xl !py-4 w-full' : ''}`} disabled={p.busy} onClick={p.enable}>🔔 روشن کردن اعلان روی این دستگاه</button>
    {!p.supported && <p className="text-sm text-amber-700 mt-2">این مرورگر اعلان پوش را پشتیبانی نمی‌کند.</p>}
    {p.permission === 'denied' && <p className="text-sm text-amber-700 mt-2">اعلان در تنظیمات مرورگر مسدود شده است.</p>}
    {p.error && <p role="alert" className="text-sm text-red-600 mt-2">{p.error}</p>}</div>;
}
