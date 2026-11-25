import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { useAuth } from '../auth';
import { Mixed } from '../ui';
import { getListenLang, setListenLang, listen, speak, sttErrorText, sttSupported, stopSpeaking } from '../voice';
import { useReadable } from './ReadAloud';

type Turn = { who: 'me' | 'ai'; text: string };
const IDEAS = ['آسمان چرا آبی است؟', 'یک چیز جالب درباره‌ی حیوانات بگو', 'How do you say "thank you" in English?', 'یک قصه‌ی کوتاه بگو'];
/** Voice-first Q&A with the safe AI helper. The answer is always read aloud (Persian + English words). */
export function AskPage() {
  const { me } = useAuth(); const [turns, setTurns] = useState<Turn[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [rec, setRec] = useState(false); const [lang, setLang] = useState(getListenLang()); const stop = useRef<() => void>(() => {}); const end = useRef<HTMLDivElement>(null);
  useReadable(['از دستیار بپرس. دکمه‌ی میکروفون را بزن و سؤالت را بگو.']);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);
  useEffect(() => () => { stopSpeaking(); stop.current(); }, []);
  const ask = async (q: string) => {
    if (!q.trim() || busy) return; setTurns((t) => [...t, { who: 'me', text: q }]); setText(''); setBusy(true);
    try { const r = await api<{ answer: string }>('/child/ask', { body: { question: q } }); setTurns((t) => [...t, { who: 'ai', text: r.answer }]); void speak(r.answer); }
    catch (e) { const m = e instanceof ApiError && e.body?.message ? e.body.message : 'الان نمی‌توانم جواب بدهم.'; setTurns((t) => [...t, { who: 'ai', text: m }]); void speak(m); }
    finally { setBusy(false); }
  };
  const mic = () => {
    if (rec) { stop.current(); return; }
    if (me?.settings && me.settings.mic_allowed === false) { void speak('مامان هنوز اجازه‌ی میکروفون را نداده. می‌توانی تایپ کنی.'); return; }
    if (!sttSupported()) { const m = sttErrorText('unsupported'); setTurns((t) => [...t, { who: 'ai', text: m }]); void speak(m); return; }
    stopSpeaking(); const l = listen(); stop.current = l.stop; setRec(true);
    l.result.then((t) => { setRec(false); return ask(t); }).catch((e) => { setRec(false); const m = sttErrorText(e.message); setTurns((t) => [...t, { who: 'ai', text: m }]); void speak(m); });
  };
  return <><h1 className="text-3xl font-extrabold">از دستیار بپرس 🤖</h1><p className="opacity-70">هر چیزی که کنجکاوی، بپرس! مامان می‌تواند گفتگوها را ببیند.</p>
    <div className="space-y-2" aria-live="polite">{turns.map((t, i) => <div key={i} className={`kid-card text-xl leading-9 ${t.who === 'me' ? '!bg-[var(--k3)]/30' : ''}`} ><Mixed text={t.text} />{t.who === 'ai' && <button className="btn btn-ghost ms-2" aria-label="دوباره بخوان" onClick={() => speak(t.text)}>🔊</button>}</div>)}{busy && <div className="kid-card text-xl">در حال فکر کردن… 🤔</div>}<div ref={end} /></div>
    {turns.length === 0 && <div className="flex flex-wrap gap-2">{IDEAS.map((i) => <button key={i} className="chip !text-base !px-3 !py-2 hover:bg-white" dir="auto" onClick={() => ask(i)}>{i}</button>)}</div>}
    <div className="flex gap-2">{([['fa-IR', '🇮🇷 فارسی'], ['en-US', '🇬🇧 English']] as const).map(([c, t]) => <button key={c} className={`btn flex-1 ${lang === c ? '' : 'btn-ghost'}`} onClick={() => { setListenLang(c); setLang(c); }}>{t}</button>)}</div>
    <button onClick={mic} className={`w-full rounded-3xl py-5 text-2xl font-extrabold text-white ${rec ? 'bg-red-500 listening' : 'bg-[var(--k1)]'}`}>{rec ? '👂 دارم گوش می‌دم… (بزن تا تمام شود)' : '🎤 بزن و سؤالت را بپرس'}</button>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(text); }}><input className="input !text-lg" placeholder="یا اینجا تایپ کن" value={text} onChange={(e) => setText(e.target.value)} dir="auto" /><button className="btn" disabled={busy || !text.trim()}>بپرس</button></form></>;
}
