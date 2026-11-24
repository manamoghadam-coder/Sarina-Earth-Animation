import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errText } from '../api';
import { listen, speak, sttErrorText, sttSupported } from '../voice';

type Msg = { who: 'me' | 'ai'; text: string; proposal?: string; done?: boolean };
const SAMPLES = ['فردا ساعت ۱۰ جلسه دارم.', 'امروز ۸۰۰ هزار تومان خرید خانه داشتم.', 'برای سارینا فردا تمرین سنتور ثبت کن.', 'سامان امروز تکالیفش را انجام داده است.', 'گزارش هزینه‌های این ماه را بده.', 'سه کار مهم فردا را مشخص کن.'];
export default function AIPage() {
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'ai', text: 'سلام مانا! بنویس یا با میکروفون بگو چه کاری ثبت شود. هیچ چیزی بدون تأیید تو ثبت نمی‌شود.' }]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [rec, setRec] = useState<null | (() => void)>(null); const [q] = useSearchParams(); const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);   // braces: never return scrollIntoView's value as an effect cleanup
  const send = async (t: string) => {
    if (!t.trim()) return; setMsgs((m) => [...m, { who: 'me', text: t }]); setText(''); setBusy(true);
    try { const r = await api<any>('/ai/message', { body: { text: t } }); setMsgs((m) => [...m, { who: 'ai', text: r.message, proposal: r.kind === 'proposal' ? r.proposal_id : undefined }]); }
    catch (e) { setMsgs((m) => [...m, { who: 'ai', text: errText(e) }]); } finally { setBusy(false); }
  };
  const decide = async (i: number, approve: boolean) => {
    const id = msgs[i].proposal!; setMsgs((m) => m.map((x, j) => (j === i ? { ...x, done: true } : x)));
    try { const r = await api<any>(`/ai/proposals/${id}/confirm`, { body: { approve } }); setMsgs((m) => [...m, { who: 'ai', text: (approve ? '✅ ' : '') + r.message }]); } catch (e) { setMsgs((m) => [...m, { who: 'ai', text: errText(e) }]); }
  };
  const mic = () => {
    if (rec) { rec(); return; }
    if (!sttSupported()) { setMsgs((m) => [...m, { who: 'ai', text: sttErrorText('unsupported') + ' می‌توانی متن را تایپ کنی.' }]); return; }
    const l = listen(); setRec(() => () => l.stop());
    l.result.then((t) => { setRec(null); void send(t); }).catch((e) => { setRec(null); setMsgs((m) => [...m, { who: 'ai', text: sttErrorText(e.message) }]); });
  };
  useEffect(() => { if (q.get('mic') === '1') mic(); /* eslint-disable-next-line */ }, []);
  return <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 14rem)' }}>
    <h1 className="text-xl font-extrabold mb-1">🤖 دستیار هوشمند</h1><p className="text-sm text-slate-500 mb-3">تشخیص فارسی تاریخ، ساعت و مبلغ — قبل از هر ثبت، تأیید می‌گیرد.</p>
    <div className="flex-1 space-y-2" aria-live="polite">{msgs.map((m, i) => <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2 whitespace-pre-line ${m.who === 'me' ? 'bg-navy-800 text-white me-auto' : 'bg-white border border-slate-200 ms-auto'}`} style={{ marginInlineStart: m.who === 'me' ? 0 : 'auto', marginInlineEnd: m.who === 'me' ? 'auto' : 0 }}>
      {m.text}{m.proposal && !m.done && <div className="flex gap-2 mt-2"><button className="btn btn-teal !py-1" onClick={() => decide(i, true)}>تأیید و ثبت</button><button className="btn btn-ghost !py-1" onClick={() => decide(i, false)}>لغو</button></div>}
      {m.who === 'ai' && <button aria-label="بخوان" className="text-xs text-slate-400 ms-2" onClick={() => speak(m.text)}>🔊</button>}</div>)}<div ref={end} /></div>
    <div className="flex gap-2 flex-wrap my-3">{SAMPLES.map((s) => <button key={s} className="chip hover:bg-teal-soft" onClick={() => send(s)}>{s}</button>)}</div>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}><input className="input" placeholder="مثلاً: فردا ساعت ۱۰ جلسه دارم" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <button type="button" className={`btn ${rec ? 'btn-danger listening' : 'btn-ghost'}`} aria-label="میکروفون" onClick={mic}>{rec ? '⏹' : '🎙️'}</button><button className="btn btn-teal" disabled={busy || !text.trim()}>ارسال</button></form>
  </div>;
}
