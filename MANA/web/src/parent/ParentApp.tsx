import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { NotificationCenter } from '../notify';
import { Avatar, Need } from '../ui';
import Dashboard from './Dashboard';
import Tasks from './Tasks';
import CalendarPage from './CalendarPage';
import Family from './Family';
import Finance from './Finance';
import GoalsPage from './GoalsPage';
import AIPage from './AIPage';
import SettingsPage from './SettingsPage';
import Diary from '../social/Diary';
import Messages from '../social/Messages';
import Chat from '../social/Chat';
import Wishes from '../social/Wishes';
import WeeklyReport from './WeeklyReport';
import HomePage from './HomePage';
import { useUnread } from '../social/badges';

const allNav = [['/', '🏠', 'داشبورد', ''], ['/tasks', '✅', 'کارها', 'tasks'], ['/calendar', '📅', 'تقویم', 'events'], ['/family', '👨‍👩‍👧‍👦', 'خانواده', 'children'], ['/finance', '💰', 'مالی', 'finance'], ['/goals', '🎯', 'اهداف', 'goals'], ['/report', '📊', 'گزارش', 'parent'], ['/home', '🛒', 'خانه‌داری', 'home'], ['/wishes', '🌠', 'آرزوها', 'wishes'], ['/messages', '💌', 'پیام‌ها', 'inbox'], ['/chat', '💬', 'چت', 'chat'], ['/diary', '📖', 'دفترچه', 'diary'], ['/settings', '⚙️', 'تنظیمات', '']] as const;

export default function ParentApp() {
  const { me, logout } = useAuth(); const go = useNavigate(); const isMom = me!.role === 'parent';
  const { chat, inbox } = useUnread(); const badge = (to: string) => (to === '/chat' ? chat : to === '/messages' ? inbox : 0);
  const nav = allNav.filter(([, , , m]) => !m || (m === 'parent' ? isMom : (me!.permissions[m] ?? 0) >= 1));
  return <div className="min-h-full md:flex">
    <aside className="hidden md:flex md:flex-col w-60 bg-navy-800 text-white p-4 gap-1 sticky top-0 h-screen">
      <div className="flex items-center gap-2 mb-4"><img src="/logo-family.webp" alt="Our Little World" className="w-10 h-10 rounded-full" /><div><b>MANA</b><div className="text-xs text-teal-soft">دستیار اجرایی</div></div></div>
      {nav.map(([to, ic, t]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rounded-xl px-3 py-2 ${isActive ? 'bg-teal-mana text-white' : 'hover:bg-navy-700'}`}>{ic} {t} {badge(to) > 0 && <span className="ms-1 rounded-full bg-red-500 text-white text-[11px] px-1.5">{badge(to)}</span>}</NavLink>)}
      {isMom && <NavLink to="/ai" className={({ isActive }) => `rounded-xl px-3 py-2 ${isActive ? 'bg-teal-mana' : 'hover:bg-navy-700'}`}>🤖 MANA AI</NavLink>}
      <div className="mt-auto flex items-center gap-2"><Avatar id={me!.avatar_photo_id} name={me!.display_name} size={36} /><span className="flex-1">{me!.display_name}</span><button className="text-sm underline" onClick={logout}>خروج</button></div>
    </aside>
    <main className="flex-1 p-4 pb-44 md:pb-24 max-w-5xl mx-auto w-full"><NotificationCenter speakAloud={false} />
      <Routes><Route path="/" element={<Dashboard />} /><Route path="/tasks" element={<Need module="tasks"><Tasks /></Need>} /><Route path="/calendar" element={<Need module="events"><CalendarPage /></Need>} /><Route path="/family" element={<Need module="children"><Family /></Need>} />
        <Route path="/finance" element={<Need module="finance"><Finance /></Need>} /><Route path="/goals" element={<Need module="goals"><GoalsPage /></Need>} />{isMom && <Route path="/ai" element={<AIPage />} />}<Route path="/report" element={isMom ? <WeeklyReport /> : <Need module="parent"><WeeklyReport /></Need>} /><Route path="/home" element={<Need module="home"><HomePage /></Need>} /><Route path="/wishes" element={<Need module="wishes"><Wishes /></Need>} /><Route path="/messages" element={<Need module="inbox"><Messages /></Need>} /><Route path="/chat" element={<Need module="chat"><Chat /></Need>} /><Route path="/diary" element={<Need module="diary"><Diary /></Need>} /><Route path="/settings" element={<SettingsPage />} /></Routes></main>
    {/* fixed assistant button (always visible) */}
    {isMom && <button onClick={() => go('/ai?mic=1')} className="fixed z-40 bottom-[4.6rem] md:bottom-5 inset-x-4 md:inset-x-auto md:left-6 mx-auto md:mx-0 md:w-72 rounded-full bg-teal-mana text-white font-extrabold text-xl py-4 shadow-xl active:scale-95">دستیار من 🎙️</button>}
    <nav aria-label="منوی اصلی" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-navy-800 text-white flex overflow-x-auto pb-[env(safe-area-inset-bottom)]">
      {nav.map(([to, ic, t]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex-none min-w-[4.4rem] text-center py-2 text-[11px] relative ${isActive ? 'text-teal-300' : 'text-slate-300'}`}><div className="text-lg">{ic}</div>{t}{badge(to) > 0 && <span className="absolute top-0.5 end-2 rounded-full bg-red-500 text-white text-[10px] px-1">{badge(to)}</span>}</NavLink>)}</nav>
  </div>;
}
