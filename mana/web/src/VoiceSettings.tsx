import { useState } from 'react';
import { SPEEDS, chooseVoice, chosenVoiceName, getListenLang, getRate, listVoices, setListenLang, setRate, speak, sttSupported, ttsStatus, type ListenLang } from './voice';

/** Per-device voice settings: speed (slow by default), voice choice for Persian/English, microphone language, and a test button. */
export function VoiceSettings({ kid }: { kid?: boolean }) {
  const [rate, setR] = useState(getRate()); const [ll, setLL] = useState<ListenLang>(getListenLang()); const [, force] = useState(0);
  const fa = listVoices('fa'), en = listVoices('en'); const near = (a: number, b: number) => Math.abs(a - b) < 0.03;
  return <div className={`space-y-3 ${kid ? 'text-lg' : ''}`}>
    <div><div className="label">🐢 سرعت صدا</div><div className="flex gap-2 flex-wrap">{SPEEDS.map(([t, v]) => <button key={t} className={`btn ${near(rate, v) ? '' : 'btn-ghost'}`} onClick={() => { setRate(v); setR(v); void speak('سلام! این سرعت صدای من است. Hello! This is my speed.', { rate: v }); }}>{t}</button>)}</div></div>
    <div className="grid sm:grid-cols-2 gap-2">
      <label className="block"><span className="label">صدای فارسی</span>{fa.length ? <select className="input" value={chosenVoiceName('fa')} onChange={(e) => { chooseVoice('fa', e.target.value); force((n) => n + 1); }}>{fa.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select> : <p className="text-sm text-amber-700">صدای فارسی روی این دستگاه نصب نیست (تنظیمات گوشی ← تبدیل متن به گفتار ← فارسی).</p>}</label>
      <label className="block"><span className="label">English voice</span>{en.length ? <select className="input" value={chosenVoiceName('en')} onChange={(e) => { chooseVoice('en', e.target.value); force((n) => n + 1); }}>{en.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</select> : <p className="text-sm text-amber-700">صدای انگلیسی پیدا نشد.</p>}</label></div>
    {sttSupported() && <div><div className="label">🎙️ زبان میکروفون</div><div className="flex gap-2">{([['fa-IR', '🇮🇷 فارسی'], ['en-US', '🇬🇧 English']] as const).map(([k, t]) => <button key={k} className={`btn ${ll === k ? '' : 'btn-ghost'}`} onClick={() => { setListenLang(k); setLL(k); }}>{t}</button>)}</div></div>}
    <button className="btn btn-teal" onClick={() => speak('سلام! امروز می‌خواهیم با هم انگلیسی یاد بگیریم. Good morning! How are you? این یک آزمایش صدا بود.')}>🔈 آزمایش صدا (فارسی و انگلیسی)</button>
    {ttsStatus() !== 'ok' && <p className="text-sm text-amber-700">اگر صدایی نشنیدید، صدای فارسی یا انگلیسی روی این دستگاه نصب نیست.</p>}
  </div>;
}
