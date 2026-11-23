import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errText } from '../api';
import { useAuth } from '../auth';
import { fmtTime } from '../jalali';
import { listen, matchCommand, speak, spokenTime, sttErrorText, sttSupported, stopSpeaking, type VoiceCmd } from '../voice';
import { STORIES } from './stories';

type Item = { id: string; title: string; start_time: string | null; completion: string | null; icon: string; stars: number };
export function AssistantSheet({ onClose }: { onClose: () => void }) {
  const { me } = useAuth(); const go = useNavigate(); const name = me!.display_name;
  const [items, setItems] = useState<Item[]>([]); const [stars, setStars] = useState(0); const [said, setSaid] = useState(''); const [reply, setReply] = useState('');
  const [listening, setListening] = useState(false); const [confirm, setConfirm] = useState<null | { text: string; yes: () => Promise<void> }>(null); const [choose, setChoose] = useState<Item[] | null>(null); const [typed, setTyped] = useState(''); const stopRef = useRef<() => void>(() => {});
  const micOk = me!.settings?.mic_allowed !== false;
  useEffect(() => { (async () => { try { const t = await api<any>('/child/today'); setItems(t.items); setStars(t.balance); } catch { /* handled on use */ } })(); return () => { stopSpeaking(); stopRef.current(); }; }, []);
  const say = (t: string) => { setReply(t); return speak(t); };
  const nowMin = () => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).split(':').map(Number); return p[0] * 60 + p[1]; };
  const mins = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  const pending = () => items.filter((i) => !i.completion);
  const current = () => { const n = nowMin(); const p = pending(); return p.filter((i) => mins(i.start_time) !== null && mins(i.start_time)! <= n + 20).at(-1) ?? p.find((i) => mins(i.start_time) === null) ?? p[0]; };
  const upcoming = () => { const n = nowMin(); return pending().filter((i) => mins(i.start_time) !== null && mins(i.start_time)! > n)[0]; };

  const run = async (cmd: VoiceCmd) => {
    switch (cmd) {
      case 'greet': return say(`سلام ${name} جان! من دستیار تو هستم. می‌توانی بپرسی: برنامه امروز من چیه؟`);
      case 'help': return say('من می‌توانم برنامه امروزت را بگویم، بگویم الان چه کاری داری، قصه بخوانم، ستاره‌هایت را بشمارم و کارهایی که انجام دادی را به مامان خبر بدهم.');
      case 'today': { if (!items.length) return say('امروز کاری برایت ثبت نشده. روز خوبی داشته باش!'); return say('امروز این کارها را داری: ' + items.map((i, k) => `${k + 1}. ${i.title}${i.start_time ? ' ' + spokenTime(i.start_time) : ''}${i.completion ? '، انجام شده' : ''}`).join('. ')); }
      case 'now': { const c = current(); return say(c ? `الان وقت ${c.title} است${c.start_time ? '، ' + spokenTime(c.start_time) : ''}. آماده‌ای شروع کنیم؟` : 'الان کار مهمی نداری. آفرین!'); }
      case 'next': { const u = upcoming(); return say(u ? `بعدش ${u.title} داری، ${spokenTime(u.start_time)}.` : 'دیگر کاری برای بعد نداری. آفرین!'); }
      case 'stars': return say(`تو الان ${stars} ستاره داری. ${stars >= 10 ? 'آفرین!' : 'ادامه بده!'}`);
      case 'story': { const s = STORIES[Math.floor(Math.random() * STORIES.length)]; go('/stories'); await say(`قصه‌ی ${s.title}. ${s.text}`); return; }
      case 'diary': go('/diary'); onClose(); return speak('دفترچه‌ی خاطراتت را باز کردم. هر چه دلت خواست بنویس. اگر بخواهی با صدا بنویسی، بگو: در دفترچه بنویس، و بعد حرفت را.');
      case 'night': go('/night'); onClose(); return speak('بیا مرور امروز را انجام بدهیم.');
      case 'chat': go('/chat'); onClose(); return speak('چت خانواده را باز کردم.');
      case 'profile': go('/profile'); onClose(); return speak('اینجا می‌توانی عکس پروفایلت را عوض کنی.');
      case 'mom': {
        try { const list = await api<any[]>('/mom-messages'); const m = list.find((x) => !x.read_at) ?? list[0];
          if (!m) return say('مامان هنوز پیامی برایت ننوشته.');
          void api(`/mom-messages/${m.id}/read`, { method: 'POST', body: {} }).then(() => window.dispatchEvent(new Event('mana-inbox-changed'))).catch(() => {});
          return say(`پیام مامان. ${m.title ? m.title + '. ' : ''}${m.body}`);
        } catch { return say('الان نتوانستم پیام‌ها را بخوانم.'); }
      }
      case 'done': {
        const p = pending(); if (!p.length) return say('همه‌ی کارهای امروزت را گزارش کرده‌ای. آفرین!');
        const c = current(); if (p.length > 1 && !c) { setChoose(p); return say('کدام کار را انجام دادی؟ روی آن بزن.'); }
        const target = c ?? p[0]; return ask(target);
      }
      case 'yes': if (confirm) { const f = confirm.yes; setConfirm(null); return f(); } return say('باشه!');
      case 'no': if (confirm) { setConfirm(null); return say('باشه، ثبت نکردم.'); } return say('باشه!');
      default: return say('متوجه نشدم. دوباره بگو یا یکی از دکمه‌های تصویری را بزن.');
    }
  };
  const ask = async (it: Item) => { setChoose(null); const yes = async () => { try { const r = await api<any>('/child/complete', { body: { activity_id: it.id } }); setItems((x) => x.map((y) => (y.id === it.id ? { ...y, completion: 'pending' } : y))); await say(r.status === 'already_reported' ? 'قبلاً گفته بودی. مامان به‌زودی نگاه می‌کند.' : `آفرین ${name}! به مامان خبر دادم. وقتی تأیید کند ستاره‌ات را می‌گیری.`); } catch (e) { await say('نتوانستم ثبت کنم. ' + errText(e)); } };
    setConfirm({ text: `«${it.title}» را انجام دادی؟`, yes }); await say(`«${it.title}» را انجام دادی؟ بله یا نه؟`); };
  // «در دفترچه بنویس ...» → asks for confirmation, then saves a private diary entry
  const handle = async (text: string) => {
    setSaid(text);
    const m = text.replace(/ي/g, 'ی').replace(/ك/g, 'ک').match(/(?:دفترچه|دفتر خاطرات|دفتر)(?: من| ام)? (?:بنویس|بنویسم|ثبت کن)[:،, ]*(.{3,})$/);
    if (m && (me!.permissions.diary ?? 0) >= 2) {
      const body = m[1].trim(); setConfirm({ text: `در دفترچه بنویسم: «${body}»؟`, yes: async () => { try { await api('/diary', { body: { body } }); await say('در دفترچه‌ات نوشتم. فقط خودت می‌بینی.'); } catch (e) { await say(errText(e)); } } });
      return say(`در دفترچه بنویسم: ${body}؟ بله یا نه؟`);
    }
    await run(matchCommand(text));
  };
  const mic = () => {
    if (listening) { stopRef.current(); return; }
    if (!micOk) { void say('مامان هنوز اجازه‌ی میکروفون را نداده. از دکمه‌های تصویری استفاده کن.'); return; }
    if (!sttSupported()) { setReply(sttErrorText('unsupported')); void speak('این دستگاه گوش دادن به صدا را ندارد. از دکمه‌های تصویری استفاده کن.'); return; }
    stopSpeaking(); const l = listen(); stopRef.current = l.stop; setListening(true);
    l.result.then((t) => { setListening(false); return handle(t); }).catch((e) => { setListening(false); const m = sttErrorText(e.message); setReply(m); void speak(m); });
  };
  const Q = ({ icon, label, cmd }: { icon: string; label: string; cmd: VoiceCmd }) => <button className="kid-tile !min-h-24 !text-base !bg-[var(--k3)]" onClick={() => { setSaid(label); void run(cmd); }}><span className="text-4xl">{icon}</span>{label}</button>;
  return <div className="fixed inset-0 z-[60] flex items-end bg-black/40" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="دستیار من" className="theme-sheet bg-white w-full rounded-t-[2rem] p-4 pb-28 max-h-[88vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-2"><h2 className="text-2xl font-extrabold">🎙️ دستیار من</h2><button className="btn btn-ghost" onClick={onClose} aria-label="بستن">✕</button></div>
      <button onClick={mic} className={`w-full rounded-3xl py-6 text-2xl font-extrabold text-white ${listening ? 'bg-red-500 listening' : 'bg-[var(--k1)]'}`}>{listening ? '👂 دارم گوش می‌دم… (بزن تا تمام شود)' : '🎤 بزن و حرف بزن'}</button>
      {said && <p className="mt-3 text-slate-500">تو گفتی: «{said}»</p>}
      {reply && <div className="mt-2 rounded-2xl bg-[var(--k2)]/30 p-3 text-xl flex gap-2 items-start" aria-live="polite"><span className="flex-1">{reply}</span><button className="btn btn-ghost" aria-label="دوباره بخوان" onClick={() => speak(reply)}>🔊</button></div>}
      {confirm && <div className="mt-3 rounded-2xl border-4 border-[var(--k4)] p-3"><p className="text-xl mb-2">{confirm.text}</p><div className="flex gap-3"><button className="kid-tile flex-1 !min-h-20 !bg-[var(--k4)]" onClick={async () => { const f = confirm.yes; setConfirm(null); await f(); }}>✅ بله</button><button className="kid-tile flex-1 !min-h-20 !bg-[var(--k1)]" onClick={() => { setConfirm(null); void say('باشه، ثبت نکردم.'); }}>❌ نه</button></div></div>}
      {choose && <div className="mt-3 grid gap-2">{choose.map((i) => <button key={i.id} className="kid-tile !min-h-16 !flex-row !bg-[var(--k2)] !text-[var(--kd)]" onClick={() => ask(i)}><span className="text-3xl">{i.icon}</span>{i.title} {fmtTime(i.start_time)}</button>)}</div>}
      <div className="grid grid-cols-3 gap-3 mt-4"><Q icon="📅" label="برنامه امروزم" cmd="today" /><Q icon="👉" label="الان چیکار کنم؟" cmd="now" /><Q icon="⭐" label="ستاره‌هام" cmd="stars" /><Q icon="🐻" label="قصه بخوان" cmd="story" /><Q icon="✅" label="انجام دادم" cmd="done" /><Q icon="👋" label="سلام" cmd="greet" /></div>
      <form className="flex gap-2 mt-4" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void handle(typed); setTyped(''); } }}><input className="input" placeholder="یا اینجا تایپ کن" value={typed} onChange={(e) => setTyped(e.target.value)} /><button className="btn">بفرست</button></form>
      {!sttSupported() && <p className="text-sm text-amber-700 mt-3">⚠️ این مرورگر تشخیص گفتار فارسی ندارد؛ دکمه‌های تصویری و تایپ کار می‌کنند. (برای میکروفون از Chrome روی اندروید استفاده کنید.)</p>}
      <p className="text-xs text-slate-400 mt-3">میکروفون فقط وقتی دکمه را می‌زنی روشن می‌شود. MANA صدای تو را ضبط یا ذخیره نمی‌کند؛ تشخیص گفتار توسط مرورگر انجام می‌شود.</p>
    </div></div>;
}
