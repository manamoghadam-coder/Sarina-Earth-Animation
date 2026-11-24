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
import LibraryPage from './LibraryPage';
import ShoppingPage from './ShoppingPage';
import HealthPage from './HealthPage';
import { RecipesView } from '../RecipesView';
import AIPage from './AIPage';
import SettingsPage from './SettingsPage';

const allNav = [['/', '🏠', 'داشبورد', ''], ['/tasks', '✅', 'کارها', 'tasks'], ['/calendar', '📅', 'تقویم', 'events'], ['/family', '👨‍👩‍👧‍👦', 'خانواده', 'children'], ['/finance', '💰', 'مالی', 'finance'], ['/goals', '🎯', 'اهداف', 'goals'], ['/shopping', '🛒', 'خرید', 'shopping'], ['/health', '🩺', 'سلامت', 'health'], ['/library', '📚', 'کتابخانه', 'library'], ['/recipes', '🍳', 'آشپزی', 'recipes'], ['/settings', '⚙️', 'تنظیمات', '']] as const;

export default function ParentApp() {
  const { me, logout } = useAuth(); const go = useNavigate(); const isMom = me!.role === 'parent';
  const nav = allNav.filter(([, , , m]) => !m || (me!.permissions[m] ?? 0) >= 1 || (m === 'finance' && (me!.permissions.debts ?? 0) >= 1));
  return <div className="min-h-full md:flex adult-bg">
    <aside className="hidden md:flex md:flex-col w-60 bg-navy-800 text-white p-4 gap-1 sticky top-0 h-screen">
      <div className="flex items-center gap-2 mb-4"><img src="/logo-family.webp" alt="Our Little World" className="w-10 h-10 rounded-full" /><div><b>دنیای کوچک ما</b><div className="text-xs text-teal-soft">Our Little World</div></div></div>
      {nav.map(([to, ic, t]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rounded-xl px-3 py-2 ${isActive ? 'bg-teal-mana text-white' : 'hover:bg-navy-700'}`}>{ic} {t}</NavLink>)}
      {isMom && <NavLink to="/ai" className={({ isActive }) => `rounded-xl px-3 py-2 ${isActive ? 'bg-teal-mana' : 'hover:bg-navy-700'}`}>🤖 دستیار هوشمند</NavLink>}
      <div className="mt-auto flex items-center gap-2"><Avatar id={me!.avatar_photo_id} name={me!.display_name} size={36} /><span className="flex-1">{me!.display_name}</span><button className="text-sm underline" onClick={logout}>خروج</button></div>
    </aside>
    <main className="flex-1 min-w-0 p-4 pb-44 md:pb-24 max-w-5xl mx-auto w-full"><NotificationCenter speakAloud={false} />
      <Routes><Route path="/" element={<Dashboard />} /><Route path="/tasks" element={<Need module="tasks"><Tasks /></Need>} /><Route path="/calendar" element={<Need module="events"><CalendarPage /></Need>} /><Route path="/family" element={<Need module="children"><Family /></Need>} />
        <Route path="/finance" element={<Need module={(me!.permissions.finance ?? 0) >= 1 ? 'finance' : 'debts'}><Finance /></Need>} /><Route path="/goals" element={<Need module="goals"><GoalsPage /></Need>} /><Route path="/library" element={<Need module="library"><LibraryPage /></Need>} /><Route path="/shopping" element={<Need module="shopping"><ShoppingPage /></Need>} /><Route path="/health" element={<Need module="health"><HealthPage /></Need>} /><Route path="/recipes" element={<Need module="recipes"><RecipesView /></Need>} />{isMom && <Route path="/ai" element={<AIPage />} />}<Route path="/settings" element={<SettingsPage />} /></Routes></main>
    {/* fixed assistant button (always visible) */}
    {isMom && <button onClick={() => go('/ai?mic=1')} className="fixed z-40 bottom-[4.6rem] md:bottom-5 inset-x-4 md:inset-x-auto md:left-6 mx-auto md:mx-0 md:w-72 rounded-full bg-teal-mana text-white font-extrabold text-xl py-4 shadow-xl active:scale-95">دستیار من 🎙️</button>}
    <nav aria-label="منوی اصلی" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-navy-800 text-white flex justify-around pb-[env(safe-area-inset-bottom)]">
      {nav.map(([to, ic, t]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex-1 text-center py-2 text-[11px] ${isActive ? 'text-teal-300' : 'text-slate-300'}`}><div className="text-lg">{ic}</div>{t}</NavLink>)}</nav>
  </div>;
}
