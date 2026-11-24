import { useState } from 'react';
import { api, errText } from '../api';
import { fa, fmtDate, money } from '../jalali';
import { Empty, Loading, Mixed, Modal, useLoad, useToast } from '../ui';
import { speak } from '../voice';
import { useReadable } from './ReadAloud';

const TOPIC: Record<string, string> = { animals: '🐾 حیوانات', space: '🚀 فضا', nature: '🌳 طبیعت', body: '🫀 بدن', iran: '🇮🇷 ایران', science: '🔬 علم', english: '🔤 English', geography: '🗺️ جغرافیا', history: '🏛️ تاریخ', math: '➗ ریاضی', tech: '💻 فناوری', health: '💪 سلامت', money: '💰 پول', general: '📌 عمومی' };

export function FactsPage() {
  const { data, error, loading } = useLoad(() => api<any>('/facts/today'));
  const t = data?.today;
  useReadable(t ? [`دانستنی امروز. ${t.title}. ${t.body}`, ...(data.recent ?? []).map((f: any) => `${f.title}. ${f.body}`)] : null);
  return <><h1 className="text-3xl font-extrabold">دانستنی‌ها 🧠</h1><Loading error={error} loading={loading} />
    {data && !t && <Empty>فعلاً دانستنی‌ای نیست.</Empty>}
    {t && <div className="quote-card"><div className="text-sm opacity-80">{TOPIC[t.topic] ?? t.topic} · دانستنی امروز</div><h2 className="text-2xl font-extrabold mt-1"><Mixed text={t.title} /></h2><p className="text-xl leading-9 mt-2"><Mixed text={t.body} /></p>
      <button className="btn !bg-white/90 !text-[var(--kd)] mt-3 !text-lg !rounded-2xl" onClick={() => speak(`${t.title}. ${t.body}`)}>🔊 بخوان برایم</button></div>}
    {data?.recent?.length > 0 && <><h2 className="text-xl font-bold mt-2">دانستنی‌های روزهای قبل</h2>{data.recent.map((f: any) => <div key={f.id} className="kid-card"><div className="flex items-start gap-2"><div className="flex-1"><div className="text-xs opacity-60">{TOPIC[f.topic] ?? f.topic} · {fmtDate(f.day, false)}</div><b className="text-lg"><Mixed text={f.title} /></b><p className="mt-1 leading-8"><Mixed text={f.body} /></p></div>
      <button aria-label="بشنو" className="btn btn-ghost" onClick={() => speak(`${f.title}. ${f.body}`)}>🔊</button></div></div>)}</>}</>;
}

export function MoneyHub() {
  const lessons = useLoad(() => api<any[]>('/child/lessons')); const wallet = useLoad(() => api<any>('/child/wallet'));
  const [open, setOpen] = useState<string | null>(null); const [save, setSave] = useState<any | null>(null); const [spend, setSpend] = useState(false); const toast = useToast();
  useReadable(['سواد مالی و پول‌توجیبی.', wallet.data ? `پول‌توجیبی تو ${wallet.data.balance} تومان است.` : '', ...(lessons.data ?? []).map((l) => `درس: ${l.title}${l.done ? '، انجام شده' : ''}`)]);
  const done = (lessons.data ?? []).filter((l) => l.done).length;
  return <><h1 className="text-3xl font-extrabold">پول و پس‌انداز 💰</h1>
    <Loading error={wallet.error} loading={wallet.loading} />
    {wallet.data && <><div className="kid-card text-center"><div className="text-lg">پول‌توجیبی من</div><div className="text-5xl font-extrabold my-1">{money(wallet.data.balance)}</div><div>تومان</div>
      <div className="flex gap-2 mt-3 justify-center flex-wrap"><button className="btn !bg-[var(--k1)] !rounded-2xl" onClick={() => setSpend(true)}>🛒 خرج کردم</button>
        <button className="btn !bg-[var(--k3)] !rounded-2xl" onClick={() => speak(`پول‌توجیبی تو ${wallet.data.balance} تومان است.`)}>🔊 بشنو</button></div></div>
      <div className="kid-card"><b className="text-xl">🐷 قلک‌های من</b>{wallet.data.goals.length === 0 && <p className="opacity-70 mt-1">مامان می‌تواند برایت هدف پس‌انداز بسازد.</p>}
        {wallet.data.goals.map((g: any) => { const pct = Math.min(100, Math.round((g.saved / g.target_amount) * 100)); return <div key={g.id} className="py-2"><div className="flex items-center gap-2 text-lg"><span className="text-3xl">{g.icon}</span><span className="flex-1">{g.title}</span><span className="text-sm">{money(g.saved)} از {money(g.target_amount)}</span></div>
          <div className="h-4 rounded-full bg-white/70 overflow-hidden mt-1" role="progressbar" aria-valuenow={pct} aria-valuemax={100}><div className="h-full bg-[var(--k4)]" style={{ width: `${pct}%` }} /></div>
          {!g.done && <button className="btn btn-ghost mt-2" onClick={() => setSave(g)}>＋ در قلک بگذار</button>}{pct >= 100 && <p className="text-lg mt-1">🎉 به هدفت رسیدی! به مامان بگو.</p>}</div>; })}</div></>}
    <div className="kid-card"><b className="text-xl">📚 درس‌های سواد مالی</b><p className="text-sm opacity-70">{fa(done)} از {fa(lessons.data?.length ?? 0)} درس انجام شد. هر درس درست، ستاره می‌دهد!</p>
      <Loading error={lessons.error} loading={lessons.loading} />
      {lessons.data?.map((l) => <button key={l.id} className="w-full text-start flex items-center gap-3 py-2 text-lg border-b border-black/5 last:border-0" onClick={() => { setOpen(l.id); void speak(l.title); }}><span className="text-3xl">{l.done ? '✅' : '📖'}</span><span className="flex-1">{l.title}</span><span className="chip">⭐ {fa(l.stars)}</span></button>)}</div>
    {open && <LessonModal id={open} onClose={() => { setOpen(null); void lessons.reload(); }} />}
    {save && <AmountModal title={`در قلک «${save.title}» بگذار`} max={wallet.data.balance} onClose={() => setSave(null)} onOk={async (n) => { try { await api('/child/wallet/save', { body: { goal_id: save.id, amount: n } }); toast('آفرین! پس‌انداز شد 🐷'); void speak('آفرین! پس‌انداز کردی.'); setSave(null); await wallet.reload(); } catch (e) { toast(errText(e), 'err'); } }} />}
    {spend && <AmountModal title="چقدر خرج کردی؟" note max={wallet.data.balance} onClose={() => setSpend(false)} onOk={async (n, note) => { try { await api('/child/wallet/spend', { body: { amount: n, note } }); toast('ثبت شد'); setSpend(false); await wallet.reload(); } catch (e) { toast(errText(e), 'err'); } }} />}
    {wallet.data?.ledger.length > 0 && <div className="kid-card"><b>آخرین حساب‌ها</b>{wallet.data.ledger.slice(0, 8).map((l: any, i: number) => <div key={i} className="flex justify-between py-1 text-sm"><span>{l.reason}</span><span className={l.delta > 0 ? 'text-green-700' : 'text-red-600'}>{l.delta > 0 ? '+' : ''}{money(l.delta)}</span></div>)}</div>}</>;
}
function AmountModal({ title, max, note, onClose, onOk }: { title: string; max: number; note?: boolean; onClose: () => void; onOk: (n: number, note: string) => void }) {
  const [v, setV] = useState(''); const [n, setN] = useState(''); const num = Number(v.replace(/[^\d]/g, '').replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))) || 0;
  return <Modal title={title} onClose={onClose}><input className="input !text-2xl" inputMode="numeric" placeholder="مبلغ به تومان" value={v} onChange={(e) => setV(e.target.value)} dir="ltr" />{note && <input className="input !text-lg mt-2" placeholder="برای چی؟" value={n} onChange={(e) => setN(e.target.value)} />}
    <p className="text-sm opacity-70 mt-1">حداکثر: {money(max)} تومان</p><button className="btn !bg-[var(--k4)] w-full mt-3 !text-xl !py-4" disabled={!num || num > max || (!!note && !n.trim())} onClick={() => onOk(num, n)}>تأیید ✅</button></Modal>;
}
function LessonModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => api<any>(`/child/lessons/${id}`)); const [res, setRes] = useState<any | null>(null); const [picked, setPicked] = useState<number | null>(null);
  const answer = async (i: number) => { setPicked(i); try { const r = await api<any>(`/child/lessons/${id}/answer`, { body: { i } }); setRes(r); void speak(r.correct ? `آفرین! درست گفتی.${r.stars_awarded ? ` ${r.stars_awarded} ستاره گرفتی.` : ''}` : 'نزدیک بود! دوباره امتحان کن.'); } catch { /* shown below */ } };
  return <Modal title={data?.title ?? 'درس'} onClose={onClose}><Loading error={error} loading={loading} />
    {data && <><p className="text-xl leading-9">{data.body}</p><button className="btn btn-ghost my-2" onClick={() => speak(`${data.body}. سؤال: ${data.question}`)}>🔊 درس و سؤال را بخوان</button>
      <h3 className="text-xl font-bold mt-2">{data.question}</h3>
      <div className="grid gap-2 mt-2">{data.options.map((o: any) => <button key={o.i} className={`btn !justify-start !text-lg !rounded-2xl ${picked === o.i ? (res?.correct ? '!bg-green-600' : '!bg-red-500') : 'btn-ghost'}`} disabled={res?.correct} onClick={() => answer(o.i)}>{o.text}</button>)}</div>
      {res && <p className="text-xl mt-3" aria-live="polite">{res.correct ? `✅ آفرین! درست بود.${res.stars_awarded ? ` ⭐ ${fa(res.stars_awarded)} ستاره گرفتی.` : ''}` : '🙂 نزدیک بود! یک گزینه‌ی دیگر را امتحان کن.'}</p>}</>}</Modal>;
}
