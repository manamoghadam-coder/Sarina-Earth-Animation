import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errText, photoUrl } from '../api';
import { useAuth } from '../auth';
import { WEEKDAYS, fa, fmtTime } from '../jalali';
import { Empty, Loading, Modal, useLoad, useToast } from '../ui';
import { speak, spokenTime, ttsStatus } from '../voice';
import { PushPanel } from '../notify';
import { useReadable } from './ReadAloud';
import { STORIES } from './stories';

const TILES = [
  { to: '/today', icon: '📅', title: 'برنامه امروز', desc: 'اینجا می‌توانی برنامه‌ی امروزت را ببینی.', c: 'var(--k1)' },
  { to: '/homework', icon: '✏️', title: 'تکالیف من', desc: 'اینجا می‌توانی تکالیف مدرسه‌ات را ببینی.', c: 'var(--k3)' },
  { to: '/stories', icon: '🐻', title: 'قصه‌های من', desc: 'اینجا می‌توانی قصه‌های جالب گوش کنی.', c: 'var(--k4)' },
  { to: '/stars', icon: '⭐', title: 'ستاره‌های من', desc: 'اینجا تعداد ستاره‌هایی را که جمع کرده‌ای می‌بینی.', c: 'var(--k2)' },
  { to: '/week', icon: '🗓️', title: 'برنامه هفته', desc: 'اینجا برنامه‌ی کل هفته‌ات را می‌بینی.', c: 'var(--k1)' },
  { to: '/facts', icon: '🧠', title: 'دانستنی‌ها', desc: 'اینجا هر روز یک چیز جالب و تازه یاد می‌گیری.', c: 'var(--k3)' },
  { to: '/money', icon: '🐷', title: 'پول و پس‌انداز', desc: 'اینجا پول‌توجیبی و قلک‌هایت را می‌بینی و درس پول یاد می‌گیری.', c: 'var(--k2)' },
  { to: '/habits', icon: '🪥', title: 'عادت‌های من', desc: 'اینجا عادت‌های خوبت و داروهایت را تیک می‌زنی.', c: 'var(--k4)' },
  { to: '/requests', icon: '🛍️', title: 'درخواست خرید', desc: 'اینجا از مامان چیزهایی را که لازم داری می‌خواهی.', c: 'var(--k2)' },
  { to: '/suggest', icon: '💡', title: 'پیشنهاد من', desc: 'اینجا غذا یا تفریح مورد علاقه‌ات را پیشنهاد می‌دهی.', c: 'var(--k1)' },
  { to: '/gallery', icon: '🖼️', title: 'عکس‌های من', desc: 'اینجا عکس‌های خودت را می‌بینی.', c: 'var(--k3)' },
];
export function Home() {
  const { me } = useAuth(); const go = useNavigate(); const photos = useLoad(() => api<any[]>('/photos')); const today = useLoad(() => api<any>('/child/today'));
  const tiles = me!.age_group === 'young' ? TILES : TILES.filter((t) => t.to !== '/homework');
  const [tested, setTested] = useState(false); const quote = useLoad(() => api<{ text: string | null }>('/quote/today')); const fact = useLoad(() => api<any>('/facts/today')); const occ = useLoad(() => api<any[]>('/occasions/upcoming?days=30'));
  useReadable([...(quote.data?.text ? [`جمله‌ی امروز: ${quote.data.text}`] : []), ...(fact.data?.today ? [`دانستنی امروز. ${fact.data.today.title}. ${fact.data.today.body}`] : []), ...tiles.map((t) => `${t.title}. ${t.desc}`)]);
  return <>
    {quote.data?.text && <div className="quote-card" role="note"><div className="text-sm opacity-80">✨ جمله‌ی امروز</div><p className="text-xl font-bold leading-9 mt-1">{quote.data.text}</p><button className="text-sm underline mt-1" onClick={() => speak(quote.data!.text!)}>🔊 بشنو</button></div>}
    {fact.data?.today && <button className="kid-card w-full text-start" onClick={() => { void speak(`${fact.data.today.title}. ${fact.data.today.body}`); go('/facts'); }}><div className="text-sm opacity-70">🧠 دانستنی امروز</div><b className="text-xl" dir="auto">{fact.data.today.title}</b><p className="mt-1 line-clamp-2" dir="auto">{fact.data.today.body}</p></button>}
    {occ.data && occ.data.length > 0 && <div className="kid-card"><b className="text-lg">🎉 مناسبت‌های نزدیک</b>{occ.data.slice(0, 3).map((o) => <div key={o.id} className="flex items-center gap-2 py-1 text-lg"><span className="text-3xl">{o.icon}</span><span className="flex-1">{o.title}{o.age ? ` (${fa(o.age)} سالگی)` : ''}</span><span className="opacity-70 text-sm">{o.days_left === 0 ? 'امروز!' : o.days_left === 1 ? 'فردا' : `${fa(o.days_left)} روز دیگر`}</span></div>)}</div>}
    {photos.data && photos.data.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1" aria-label="عکس‌های من">{photos.data.slice(0, 6).map((p) => <img key={p.id} src={photoUrl(p.id)} alt="" className="h-28 w-28 rounded-3xl object-cover flex-none shadow" />)}</div>}
    {today.data && <div className="kid-card flex items-center justify-between text-xl"><span>⭐ {fa(today.data.balance)} ستاره</span><span className="text-sm opacity-70">این هفته {fa(today.data.week_stars)} از {fa(today.data.settings.weekly_goal_stars)}</span></div>}
    <div className="grid grid-cols-2 gap-4">{tiles.map((t) => <div key={t.to} className="relative">
      <button className="kid-tile w-full" style={{ background: t.c }} onClick={() => { void speak(`${t.title}. ${t.desc}`); go(t.to); }}><span className="text-6xl" aria-hidden>{t.icon}</span><span className="text-xl">{t.title}</span></button>
      <button aria-label={`بشنو: ${t.title}`} className="absolute top-2 start-2 w-11 h-11 rounded-full bg-white/90 text-xl shadow" onClick={() => speak(`${t.title}. ${t.desc}`)}>🔊</button></div>)}</div>
    <div className="kid-card space-y-2"><PushPanel big />
      <button className="btn btn-ghost w-full" onClick={() => { setTested(true); void speak(`سلام ${me!.display_name} جان! اگر صدای من را می‌شنوی، همه چیز درست است.`); }}>🔈 آزمایش صدا</button>
      {tested && ttsStatus() !== 'ok' && <p className="text-sm text-amber-700">اگر صدایی نشنیدی: این دستگاه شاید صدای فارسی نصب ندارد. به مامان بگو تا در تنظیمات گوشی («خروجی تبدیل متن به گفتار») فارسی را فعال کند.</p>}</div></>;
}

type Item = { id: string; title: string; kind: string; icon: string; description: string | null; start_time: string | null; end_time: string | null; stars: number; completion: string | null };
export function TodayPage({ onlyKinds, title = 'برنامه امروز' }: { onlyKinds?: string[]; title?: string }) {
  const { data, error, loading, reload } = useLoad(() => api<any>('/child/today')); const [ask, setAsk] = useState<Item | null>(null); const toast = useToast();
  const items: Item[] = (data?.items ?? []).filter((i: Item) => !onlyKinds || onlyKinds.includes(i.kind));
  useReadable(data ? [`${title}. ${data.day_fa}.`, ...(items.length ? items.map((i) => `${i.title}${i.start_time ? '، ' + spokenTime(i.start_time) : ''}${i.completion ? '، انجام شده' : ''}`) : ['امروز کاری نداری.']), 'آفرین! ادامه بده.'] : null);
  const done = async (i: Item) => { setAsk(null); try { await api('/child/complete', { body: { activity_id: i.id } }); toast('آفرین! منتظر تأیید مامان ✨'); void speak('آفرین! منتظر تأیید مامان باش.'); await reload(); } catch (e) { toast(errText(e), 'err'); } };
  return <><h1 className="text-3xl font-extrabold">{title}</h1>{data && <p className="opacity-70">{data.day_fa}</p>}<Loading error={error} loading={loading} />
    {data && items.length === 0 && <Empty>امروز کاری نداری 🎉</Empty>}
    {items.map((i) => <div key={i.id} className={`kid-card flex items-center gap-3 ${i.completion === 'approved' ? 'opacity-70' : ''}`}>
      <button aria-label={`بشنو: ${i.title}`} className="text-5xl" onClick={() => speak(`${i.title}${i.start_time ? '، ' + spokenTime(i.start_time) : ''}. ${i.description ?? ''}`)}>{i.icon}</button>
      <div className="flex-1"><b className="text-xl block">{i.title}</b><span className="opacity-70">{i.start_time ? `${fmtTime(i.start_time)} تا ${fmtTime(i.end_time)}` : 'هر وقت'} · ⭐ {fa(i.stars)}</span></div>
      {i.completion === 'approved' ? <span className="text-3xl" aria-label="تأیید شد">✅</span> : i.completion === 'pending' ? <span className="chip !bg-amber-100">🕓 منتظر مامان</span> : i.completion === 'rejected' ? <span className="chip">دوباره امتحان کن</span>
        : <button className="btn !bg-[var(--k4)] !text-lg !rounded-2xl" onClick={() => setAsk(i)}>انجام دادم ✅</button>}</div>)}
    {ask && <Modal title="مطمئنی؟" onClose={() => setAsk(null)}><p className="text-2xl mb-4">«{ask.title}» را انجام دادی؟</p><div className="flex gap-3"><button className="btn !bg-[var(--k4)] flex-1 !text-xl !py-4" onClick={() => done(ask)}>✅ بله</button><button className="btn btn-ghost flex-1 !text-xl !py-4" onClick={() => setAsk(null)}>❌ نه</button></div></Modal>}</>;
}

export function WeekPage() {
  const { data, error, loading } = useLoad(() => api<any[]>('/child/week'));
  useReadable(data ? WEEKDAYS.flatMap((w, d) => { const l = data.filter((a) => a.weekdays?.includes(d)); return l.length ? [`${w}: ` + l.map((a) => `${a.title}${a.start_time ? ' ' + spokenTime(a.start_time) : ''}`).join('، ')] : []; }) : null);
  return <><h1 className="text-3xl font-extrabold">برنامه هفته</h1><Loading error={error} loading={loading} />
    {WEEKDAYS.map((w, d) => { const l = (data ?? []).filter((a) => a.weekdays?.includes(d)); return l.length ? <div key={w} className="kid-card"><b className="text-xl">{w}</b>{l.map((a) => <div key={a.id} className="flex items-center gap-2 py-1 text-lg"><span className="text-2xl">{a.icon}</span>{a.title}<span className="opacity-60 ms-auto">{fmtTime(a.start_time)}</span></div>)}</div> : null; })}</>;
}

export function StarsPage() {
  const { data, error, loading, reload } = useLoad(() => api<any>('/child/stars')); const today = useLoad(() => api<any>('/child/today')); const [ask, setAsk] = useState<any | null>(null); const toast = useToast();
  useReadable(data ? [`تو ${data.balance} ستاره داری.`, data.badges.length ? `مدال‌هایت: ${data.badges.map((b: any) => b.title).join('، ')}.` : 'هنوز مدالی نگرفته‌ای. ادامه بده!', ...data.rewards.map((r: any) => `جایزه: ${r.title}، ${r.cost_stars} ستاره`)] : null);
  const claim = async (r: any) => { setAsk(null); try { await api('/child/claim', { body: { reward_id: r.id } }); toast('درخواستت برای مامان رفت 🎁'); void speak('درخواستت را برای مامان فرستادم.'); await reload(); } catch (e) { toast(errText(e), 'err'); } };
  const goal = today.data?.settings.weekly_goal_stars || 1; const wk = today.data?.week_stars ?? 0;
  return <><h1 className="text-3xl font-extrabold">ستاره‌های من ⭐</h1><Loading error={error} loading={loading} />
    {data && <><div className="kid-card text-center"><div className="text-7xl font-extrabold">{fa(data.balance)}</div><div className="text-xl">ستاره</div>
      <div className="mt-3 h-5 rounded-full bg-white/70 overflow-hidden" role="progressbar" aria-valuenow={wk} aria-valuemax={goal}><div className="h-full bg-[var(--k2)]" style={{ width: `${Math.min(100, (wk / goal) * 100)}%` }} /></div><p className="text-sm mt-1">هدف این هفته: {fa(wk)} از {fa(goal)}</p></div>
      <div className="kid-card"><b className="text-xl">🏅 مدال‌ها</b><div className="flex flex-wrap gap-3 mt-2">{data.badges.length ? data.badges.map((b: any) => <div key={b.code} className="text-center w-20"><div className="text-5xl">{b.icon}</div><div className="text-xs">{b.title}</div></div>) : <span className="opacity-70">با انجام کارها مدال می‌گیری!</span>}</div></div>
      <div className="kid-card"><b className="text-xl">🎁 جایزه‌ها</b>{data.rewards.map((r: any) => <div key={r.id} className="flex items-center gap-2 py-2 text-lg"><span className="text-3xl">{r.icon}</span><span className="flex-1">{r.title}<span className="block text-sm opacity-60">{fa(r.cost_stars)} ستاره</span></span>
        <button className="btn !bg-[var(--k1)] !rounded-2xl" disabled={data.balance < r.cost_stars} onClick={() => setAsk(r)}>{data.balance >= r.cost_stars ? 'می‌خوام!' : `${fa(r.cost_stars - data.balance)} تا مونده`}</button></div>)}
        {data.claims.filter((c: any) => c.status === 'requested').map((c: any) => <div key={c.id} className="text-sm opacity-70">🕓 منتظر مامان: {c.title}</div>)}</div>
      <div className="kid-card"><b className="text-xl">🎯 هدف‌ها</b>{data.goals.map((g: any) => <div key={g.id} className="py-1 text-lg">{g.done ? '✅' : g.icon} {g.title}</div>)}</div></>}
    {ask && <Modal title="جایزه" onClose={() => setAsk(null)}><p className="text-2xl mb-4">{ask.icon} «{ask.title}» را می‌خواهی؟ ({fa(ask.cost_stars)} ستاره)</p><div className="flex gap-3"><button className="btn !bg-[var(--k4)] flex-1 !text-xl !py-4" onClick={() => claim(ask)}>✅ بله</button><button className="btn btn-ghost flex-1 !text-xl !py-4" onClick={() => setAsk(null)}>❌ نه</button></div></Modal>}</>;
}

export function Gallery() {
  const { data, error, loading } = useLoad(() => api<any[]>('/photos')); const [big, setBig] = useState<string | null>(null);
  useReadable(['عکس‌های من.']);
  return <><h1 className="text-3xl font-extrabold">عکس‌های من 🖼️</h1><Loading error={error} loading={loading} />{data?.length === 0 && <Empty>هنوز عکسی نیست. مامان می‌تواند عکس اضافه کند.</Empty>}
    <div className="grid grid-cols-2 gap-3">{data?.map((p) => <button key={p.id} onClick={() => setBig(p.id)}><img src={photoUrl(p.id)} alt={p.caption ?? 'عکس'} className="w-full aspect-square object-cover rounded-3xl shadow" loading="lazy" /></button>)}</div>
    {big && <div className="fixed inset-0 z-[80] bg-black/80 grid place-items-center p-4" onClick={() => setBig(null)}><img src={photoUrl(big)} alt="" className="max-h-full max-w-full rounded-2xl" /></div>}</>;
}

export function StoriesPage() {
  const [cur, setCur] = useState<(typeof STORIES)[number] | null>(null);
  useReadable(cur ? [cur.title, cur.text] : ['قصه‌های من.', ...STORIES.map((s) => s.title)]);
  return <><h1 className="text-3xl font-extrabold">قصه‌های من 🐻</h1>
    {!cur ? STORIES.map((s) => <button key={s.id} className="kid-card w-full flex items-center gap-3 text-start" onClick={() => { setCur(s); void speak(`${s.title}. ${s.text}`); }}><span className="text-6xl">{s.icon}</span><b className="text-xl flex-1">{s.title}</b><span className="text-3xl">▶</span></button>)
      : <div className="kid-card"><button className="btn btn-ghost mb-3" onClick={() => setCur(null)}>→ قصه‌های دیگر</button><h2 className="text-2xl font-extrabold mb-2">{cur.icon} {cur.title}</h2><p className="text-xl leading-10">{cur.text}</p>
        <button className="btn !bg-[var(--k4)] mt-3" onClick={() => speak(`${cur.title}. ${cur.text}`)}>🔊 دوباره بخوان</button></div>}
    <Link to="/" className="hidden" /></>;
}
