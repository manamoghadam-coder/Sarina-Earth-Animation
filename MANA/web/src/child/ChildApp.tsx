import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { NotificationCenter } from '../notify';
import { Avatar } from '../ui';
import { ttsStatus } from '../voice';
import { AssistantSheet } from './Assistant';
import { Gallery, Home, StarsPage, StoriesPage, TodayPage, WeekPage } from './ChildPages';
import { ReadAloudBar, ReadProvider } from './ReadAloud';

export default function ChildApp() {
  const { me, logout } = useAuth(); const [open, setOpen] = useState(false); const [voiceErr, setVoiceErr] = useState<string | null>(null); const loc = useLocation();
  useEffect(() => { const h = (e: Event) => setVoiceErr((e as CustomEvent).detail); window.addEventListener('mana-voice-error', h); return () => window.removeEventListener('mana-voice-error', h); }, []);
  const theme = me!.username === 'saman' ? 'theme-saman' : 'theme-sarina';
  return <div className={`${theme} min-h-full`}>
    <ReadProvider initialOn={!!me!.settings?.read_aloud_default}>
      <NotificationCenter speakAloud={!!me!.settings?.voice_notifications} kid paused={open} />
      <header className="flex items-center gap-3 p-3 sticky top-0 z-20 backdrop-blur bg-white/60">
        {loc.pathname !== '/' ? <Link to="/" className="btn !bg-[var(--k3)] !text-xl !rounded-2xl" aria-label="خانه">🏠 خانه</Link> : <Avatar id={me!.avatar_photo_id} name={me!.display_name} size={44} />}
        <b className="flex-1 text-xl">{loc.pathname === '/' ? `سلام ${me!.display_name} جان!` : ''}</b>
        <button className="text-sm underline opacity-70" onClick={logout}>خروج</button></header>
      <main className="p-3 pb-40 max-w-2xl mx-auto space-y-3">
        {voiceErr && <div role="alert" className="kid-card !bg-amber-100 text-sm">⚠️ صدا پخش نشد ({voiceErr}). ممکن است صدای فارسی روی این دستگاه نصب نباشد؛ به مامان بگو. تا آن موقع می‌توانی متن‌ها را ببینی.<button className="ms-2 underline" onClick={() => setVoiceErr(null)}>باشه</button></div>}
        {ttsStatus() === 'none' && <div role="alert" className="kid-card !bg-amber-100 text-sm">⚠️ این مرورگر صدا ندارد (خواندن متن پشتیبانی نمی‌شود). از Chrome استفاده کنید.</div>}
        <ReadAloudBar />
        <Routes><Route path="/" element={<Home />} /><Route path="/today" element={<TodayPage />} /><Route path="/homework" element={<TodayPage onlyKinds={['homework', 'writing', 'study']} title="تکالیف من" />} /><Route path="/week" element={<WeekPage />} />
          <Route path="/stars" element={<StarsPage />} /><Route path="/gallery" element={<Gallery />} /><Route path="/stories" element={<StoriesPage />} /></Routes></main>
      {/* fixed, always-visible assistant button */}
      <button onClick={() => setOpen(true)} aria-label="دستیار من" className="fixed z-[70] bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 mx-auto max-w-md rounded-full bg-[var(--k1)] text-white text-2xl font-extrabold py-5 shadow-[0_8px_0_rgba(0,0,0,.2)] active:translate-y-1">دستیار من 🎙️</button>
      {open && <AssistantSheet onClose={() => setOpen(false)} />}
    </ReadProvider></div>;
}
