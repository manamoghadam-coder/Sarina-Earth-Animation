import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate } from '../jalali';
import { Loading, useAction, useLoad } from '../ui';
import { speak, stopSpeaking } from '../voice';
import { DictateButton } from '../social/shared';

type Q = { id: string; text: string; kind: 'text' | 'gratitude' };
/** Nightly reflection: a few short questions, one at a time, ending with the gratitude sentence. */
export default function Night() {
  const { me } = useAuth(); const go = useNavigate(); const act = useAction(); const kid = me!.role === 'child';
  const t = useLoad(() => api<{ day: string; questions: Q[]; entry: null | { answers: { q: string; kind: string; a: string }[] } }>('/reflection/today'));
  const [ans, setAns] = useState<Record<string, string>>({}); const [i, setI] = useState(0); const [done, setDone] = useState(false); const init = useRef(false);
  const canWrite = (me!.permissions.diary ?? 0) >= 2;
  useEffect(() => { if (t.data && !init.current) { init.current = true; const m: Record<string, string> = {}; t.data.entry?.answers.forEach((x) => { m[x.q] = x.a; }); setAns(m); } }, [t.data]);
  const qs = t.data?.questions ?? []; const q = qs[i];
  useEffect(() => { if (q && !done && kid) void speak(q.kind === 'gratitude' ? 'خدایا ازت سپاسگزارم که… ادامه‌اش را بگو.' : q.text); return () => stopSpeaking(); }, [q?.id, done]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (v: string) => q && setAns((a) => ({ ...a, [q.text]: v }));
  const save = () => act(async () => { await api('/reflection/today', { method: 'PUT', body: { answers: qs.map((x) => ({ q: x.text, kind: x.kind, a: (ans[x.text] ?? '').trim() })) } }); setDone(true); void speak(`آفرین ${me!.display_name} جان! شب بخیر و خوابهای خوب ببینی.`); });
  const card = kid ? 'kid-card' : 'card';
  if (!t.data) return <Loading error={t.error} loading={t.loading} />;
  if (!canWrite) return <div className={card}><p>نوشتن مرور شبانه برای این حساب غیرفعال است.</p></div>;
  if (done) return <div className={`${card} text-center space-y-3`}><div className="text-7xl">🌙</div><h1 className="text-3xl font-extrabold">آفرین! شب بخیر</h1><p>مرور امروزت ثبت شد. هر وقت خواستی دوباره بیا و ویرایشش کن.</p><button className="btn btn-teal" onClick={() => go('/')}>🏠 خانه</button></div>;
  if (!q) return <div className={card}><p>سؤالی تعریف نشده است.</p></div>;
  const last = i === qs.length - 1; const gr = q.kind === 'gratitude';
  return <div className="space-y-3 max-w-2xl"><h1 className={`${kid ? 'text-3xl' : 'text-xl'} font-extrabold`}>🌙 مرور امروز <span className="text-base opacity-60">{fmtDate(t.data.day)}</span></h1>
    <div className="h-2 rounded-full bg-white/60 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={i + 1}><div className="h-full bg-[var(--k1,#8b5cf6)]" style={{ width: `${((i + 1) / qs.length) * 100}%` }} /></div>
    <section className={`${card} space-y-3`}>
      <div className="flex items-start gap-2"><h2 className={`flex-1 ${kid ? 'text-2xl' : 'text-lg'} font-extrabold leading-9`}>{gr ? '🤲 خدایا ازت سپاسگزارم که …' : q.text}</h2>
        <button className="btn btn-ghost !px-3" aria-label="بخوان" onClick={() => speak(gr ? 'خدایا ازت سپاسگزارم که' : q.text)}>🔊</button></div>
      <textarea className="input min-h-36 w-full" maxLength={2000} value={ans[q.text] ?? ''} onChange={(e) => set(e.target.value)} placeholder={gr ? 'ادامه‌ی جمله را بنویس…' : 'جوابت را بنویس…'} />
      <DictateButton kid={kid} onText={(x) => set(((ans[q.text] ?? '') + ' ' + x).trim())} />
      <p className="text-xs opacity-60">سؤال {i + 1} از {qs.length}. پرکردن همه‌ی سؤال‌ها لازم نیست.{kid ? ' مامان این مرور را می‌تواند بخواند.' : ''}</p></section>
    <div className="flex gap-2"><button className="btn btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← قبلی</button>
      {last ? <button className="btn btn-teal flex-1" disabled={!Object.values(ans).some((x) => x.trim())} onClick={save}>ذخیره 🌙</button> : <button className="btn btn-teal flex-1" onClick={() => setI(i + 1)}>بعدی →</button>}</div></div>;
}
