import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getRate, setRate, speak, stopSpeaking } from '../voice';

const Ctx = createContext<{ setLines: (l: string[]) => void; lines: string[]; on: boolean; setOn: (v: boolean) => void }>(null as any);
export const ReadProvider = ({ children, initialOn }: { children: ReactNode; initialOn: boolean }) => {
  const [lines, setLines] = useState<string[]>([]); const [on, setOn] = useState(initialOn);
  return <Ctx.Provider value={{ lines, setLines, on, setOn }}>{children}</Ctx.Provider>;
};
/** Pages call this to say what "🔊 برایم بخوان" should read. */
export function useReadable(lines: string[] | null) {
  const { setLines } = useContext(Ctx); const key = (lines ?? []).join('|');
  useEffect(() => { setLines(lines ?? []); return () => setLines([]); /* eslint-disable-next-line */ }, [key]);
}
export function ReadAloudBar() {
  const { lines, on, setOn } = useContext(Ctx); const [idx, setIdx] = useState(-1); const [playing, setPlaying] = useState(false); const [rate, setR] = useState(getRate()); const token = useRef(0); const pos = useRef(0);
  const play = async (from: number) => {
    const my = ++token.current; setPlaying(true);
    for (let i = from; i < lines.length; i++) { if (my !== token.current) return; pos.current = i; setIdx(i); await speak(lines[i], { rate: getRate(), source: 'readaloud' }); }
    if (my === token.current) { setPlaying(false); setIdx(-1); pos.current = 0; }
  };
  const halt = () => { token.current++; stopSpeaking(); setPlaying(false); };
  useEffect(() => { const h = () => { token.current++; setPlaying(false); }; window.addEventListener('mana-user-speak', h); return () => { window.removeEventListener('mana-user-speak', h); token.current++; stopSpeaking(); }; }, []);
  useEffect(() => { halt(); if (on && lines.length) void play(0); /* eslint-disable-next-line */ }, [lines.join('|'), on]);
  if (!on) return <button className="btn !bg-[var(--k2)] !text-[var(--kd)] !text-lg !rounded-2xl" onClick={() => setOn(true)}>🔊 برایم بخوان</button>;
  return <div className="kid-card flex items-center gap-2 flex-wrap" role="group" aria-label="کنترل خواندن">
    <b className="text-lg">🔊 برایم بخوان</b>
    {playing ? <button className="btn !bg-[var(--k1)]" onClick={halt} aria-label="توقف">⏸ توقف</button> : <button className="btn !bg-[var(--k4)]" onClick={() => play(pos.current)} aria-label="ادامه">▶ ادامه</button>}
    <button className="btn btn-ghost" onClick={() => { halt(); void play(0); }} aria-label="تکرار">🔁 تکرار</button>
    <label className="flex items-center gap-1 text-sm">🐢<input type="range" min={0.5} max={1.2} step={0.05} value={rate} aria-label="سرعت صدا" onChange={(e) => { setR(+e.target.value); setRate(+e.target.value); }} />🐇</label>
    <button className="btn btn-ghost" onClick={() => { halt(); setOn(false); }} aria-label="بستن خواندن">✕</button>
    {idx >= 0 && <p className="w-full text-sm opacity-70 truncate">{lines[idx]}</p>}</div>;
}
