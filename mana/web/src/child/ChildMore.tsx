import { useState } from 'react';
import { api, errText } from '../api';
import { fa, fmtTime } from '../jalali';
import { Empty, Loading, useLoad, useToast } from '../ui';
import { speak, spokenTime } from '../voice';
import { useReadable } from './ReadAloud';

export function HabitsPage() {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/child/routines')); const toast = useToast();
  useReadable(data ? ['عادت‌های من.', ...data.map((r) => `${r.title}${r.slots.some((s: any) => s.slot) ? '، ' + r.slots.map((s: any) => spokenTime(s.slot)).join('، ') : ''}`)] : null);
  const log = async (id: string, slot: string, title: string) => { try { await api(`/child/routines/${id}/log`, { body: { slot } }); toast('آفرین! ✅'); void speak(`آفرین! ${title} انجام شد.`); await reload(); } catch (e) { toast(errText(e), 'err'); } };
  return <><h1 className="text-3xl font-extrabold">عادت‌های من 🌟</h1><Loading error={error} loading={loading} />
    {data?.length === 0 && <Empty>امروز عادتی نداری. مامان می‌تواند اضافه کند.</Empty>}
    {data?.map((r) => <div key={r.id} className="kid-card"><div className="flex items-center gap-3"><button aria-label={`بشنو: ${r.title}`} className="text-5xl" onClick={() => speak(`${r.title}${r.dose ? '، ' + r.dose : ''}`)}>{r.icon}</button>
      <div className="flex-1"><b className="text-xl block">{r.title}</b>{r.dose && <span className="opacity-70">{r.dose}</span>}{r.kind === 'medicine' && <span className="chip ms-2">💊 دارو</span>}</div></div>
      <div className="flex flex-wrap gap-2 mt-3">{r.slots.map((s: any) => s.done ? <span key={s.slot} className="chip !bg-green-100 !text-lg">✅ {s.slot ? fmtTime(s.slot) : 'انجام شد'}</span>
        : <button key={s.slot} className="btn !bg-[var(--k4)] !text-lg !rounded-2xl" onClick={() => log(r.id, s.slot, r.title)}>{s.slot ? `${fmtTime(s.slot)} — ` : ''}انجام دادم</button>)}</div></div>)}</>;
}

const CATS: [string, string, string][] = [['food', '🍎', 'تغذیه مدرسه'], ['clothes', '👕', 'لباس'], ['school', '✏️', 'وسایل مدرسه'], ['class_fee', '🎓', 'کلاس / ثبت‌نام'], ['other', '📦', 'چیز دیگر']];
const ST: Record<string, string> = { requested: '🕓 منتظر مامان', approved: '👍 مامان قبول کرد', bought: '🎁 خریده شد', rejected: '🙁 فعلاً نه' };
export function RequestsPage() {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/child/requests')); const [cat, setCat] = useState('school'); const [title, setTitle] = useState(''); const toast = useToast();
  useReadable(['درخواست خرید. بنویس چه چیزی لازم داری.', ...(data ?? []).map((r) => `${r.title}، ${ST[r.status]}`)]);
  const send = async () => { try { await api('/child/requests', { body: { category: cat, title } }); setTitle(''); toast('درخواستت برای مامان رفت 🛍️'); void speak('درخواستت را برای مامان فرستادم.'); await reload(); } catch (e) { toast(errText(e), 'err'); } };
  return <><h1 className="text-3xl font-extrabold">درخواست خرید 🛍️</h1>
    <div className="kid-card"><b className="text-lg">چه چیزی لازم داری؟</b><div className="flex flex-wrap gap-2 my-3">{CATS.map(([k, ic, t]) => <button key={k} className={`btn !text-lg !rounded-2xl ${cat === k ? '' : 'btn-ghost'}`} onClick={() => { setCat(k); void speak(t); }}>{ic} {t}</button>)}</div>
      <input className="input !text-lg" placeholder="مثلاً: دفتر نقاشی" value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn !bg-[var(--k1)] w-full mt-3 !text-xl !py-4 !rounded-2xl" disabled={!title.trim()} onClick={send}>فرستادن برای مامان</button></div>
    <Loading error={error} loading={loading} />{data?.length === 0 && <Empty>هنوز درخواستی نداری.</Empty>}
    {data?.map((r) => <div key={r.id} className="kid-card flex items-center gap-3"><span className="text-3xl">{CATS.find((c) => c[0] === r.category)?.[1]}</span><div className="flex-1"><b className="text-lg block">{r.title}</b>{r.mom_note && <span className="text-sm opacity-70">مامان: {r.mom_note}</span>}</div><span className="chip !text-base">{ST[r.status]}</span></div>)}</>;
}

const KINDS: [string, string, string][] = [['food', '🍕', 'غذا'], ['fun', '🎡', 'تفریح'], ['other', '💭', 'چیز دیگر']];
export function SuggestPage() {
  const { data, error, loading, reload } = useLoad(() => api<any[]>('/child/suggestions')); const [kind, setKind] = useState('food'); const [text, setText] = useState(''); const toast = useToast();
  useReadable(['پیشنهاد من. اینجا غذا یا تفریح مورد علاقه‌ات را می‌نویسی.']);
  const send = async () => { try { await api('/child/suggestions', { body: { kind, text } }); setText(''); toast('پیشنهادت رفت 💡'); void speak('پیشنهادت را فرستادم. ممنون!'); await reload(); } catch (e) { toast(errText(e), 'err'); } };
  return <><h1 className="text-3xl font-extrabold">پیشنهاد من 💡</h1>
    <div className="kid-card"><b className="text-lg">دوست داری چه کار کنیم؟</b><div className="flex gap-2 my-3">{KINDS.map(([k, ic, t]) => <button key={k} className={`btn flex-1 !text-lg !rounded-2xl ${kind === k ? '' : 'btn-ghost'}`} onClick={() => { setKind(k); void speak(t); }}>{ic} {t}</button>)}</div>
      <textarea className="input !text-lg" rows={3} placeholder="مثلاً: آخر هفته کباب درست کنیم / بریم پارک" value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn !bg-[var(--k1)] w-full mt-3 !text-xl !py-4 !rounded-2xl" disabled={!text.trim()} onClick={send}>فرستادن</button></div>
    <Loading error={error} loading={loading} />{data?.map((s) => <div key={s.id} className="kid-card flex gap-3 items-center"><span className="text-3xl">{KINDS.find((k) => k[0] === s.kind)?.[1]}</span><span className="flex-1 text-lg">{s.text}</span><span className="chip">{s.status === 'new' ? 'فرستاده شد' : s.status === 'seen' ? '👀 مامان دید' : '✅ انجام شد'}</span></div>)}
    <p className="hidden">{fa(0)}</p></>;
}
