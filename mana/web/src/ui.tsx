import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { errText, photoUrl } from './api';
import { useLevel } from './auth';
import { splitLang } from './langsplit';
import { MONTHS, fa, isoFromJ, jmLen, parts, tehranToday, toEnDigits } from './jalali';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(async () => { try { setData(await fnRef.current()); setError(null); } catch (e) { setError(errText(e)); } finally { setLoading(false); } }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); void reload(); }, deps);
  return { data, error, loading, reload, setData };
}

const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; kind: string } | null>(null);
  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => { setT({ msg, kind }); setTimeout(() => setT(null), 3500); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div role="status" className={`fixed top-4 inset-x-4 z-[100] mx-auto max-w-md rounded-xl px-4 py-3 text-white shadow-lg ${t.kind === 'err' ? 'bg-red-600' : 'bg-teal-600'}`}>{t.msg}</div>}</ToastCtx.Provider>;
}
/** Runs an async action and reports errors via toast. */
export function useAction() { const toast = useToast(); return async (fn: () => Promise<unknown>, okMsg?: string) => { try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(errText(e), 'err'); return false; } }; }

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={title} className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-3xl sm:rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-3"><h3 className="text-lg font-bold">{title}</h3><button aria-label="بستن" className="btn btn-ghost !px-3" onClick={onClose}>✕</button></div>{children}</div></div>;
}
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="block mb-3"><span className="label">{label}</span>{children}</label>;

/** Jalali date picker (3 selects). value/onChange use ISO Gregorian 'YYYY-MM-DD'. */
export function DateField({ value, onChange, allowEmpty }: { value: string | null | undefined; onChange: (iso: string | null) => void; allowEmpty?: boolean }) {
  const base = parts(value || tehranToday()); const [jy, jm, jd] = [base.jy, base.jm, base.jd];
  const todayJ = parts(tehranToday());
  const set = (y: number, m: number, d: number) => onChange(isoFromJ(y, m, Math.min(d, jmLen(y, m))));
  return <div className="flex gap-2" dir="rtl">
    <select aria-label="روز" className="input" value={value ? jd : ''} onChange={(e) => (e.target.value === '' ? onChange(null) : set(jy, jm, +e.target.value))}>
      {allowEmpty && <option value="">—</option>}{Array.from({ length: jmLen(jy, jm) }, (_, i) => <option key={i} value={i + 1}>{fa(i + 1)}</option>)}</select>
    <select aria-label="ماه" className="input" value={value ? jm : ''} onChange={(e) => set(jy, +e.target.value, jd)}>{allowEmpty && !value && <option value="">—</option>}{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select>
    <select aria-label="سال" className="input" value={value ? jy : ''} onChange={(e) => set(+e.target.value, jm, jd)}>{allowEmpty && !value && <option value="">—</option>}{Array.from({ length: 11 }, (_, i) => todayJ.jy - 3 + i).map((y) => <option key={y} value={y}>{fa(y)}</option>)}</select>
  </div>;
}
export function MoneyField({ value, onChange }: { value: number | ''; onChange: (n: number | '') => void }) {
  return <input className="input" inputMode="numeric" dir="ltr" placeholder="مبلغ به تومان" value={value === '' ? '' : fa(new Intl.NumberFormat('en-US').format(value))}
    onChange={(e) => { const d = toEnDigits(e.target.value).replace(/\D/g, ''); onChange(d ? Number(d) : ''); }} />;
}
export function Avatar({ id, name, size = 48 }: { id?: string | null; name: string; size?: number }) {
  const [bad, setBad] = useState(false);
  return id && !bad ? <img src={photoUrl(id)} alt={name} onError={() => setBad(true)} style={{ width: size, height: size }} className="rounded-full object-cover bg-slate-200" />
    : <span style={{ width: size, height: size, fontSize: size * 0.45 }} className="rounded-full bg-teal-mana text-white grid place-items-center font-bold" aria-label={name}>{name[0]}</span>;
}
export const Empty = ({ children }: { children: ReactNode }) => <p className="text-slate-500 text-center py-6">{children}</p>;
export function Loading({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p role="alert" className="text-red-600 text-center py-6">{error}</p>;
  return loading ? <p className="text-slate-500 text-center py-6">در حال بارگذاری…</p> : null;
}
export function BarChart({ rows, fmt }: { rows: { label: string; value: number; budget?: number | null }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.budget ?? 0)));
  return <div className="space-y-2" role="img" aria-label="نمودار هزینه‌ها بر اساس دسته">{rows.map((r) => <div key={r.label}>
    <div className="flex justify-between text-sm"><span>{r.label}</span><span className={r.budget != null && r.value > r.budget ? 'text-red-600 font-bold' : ''}>{fmt(r.value)}{r.budget != null ? ` از ${fmt(r.budget)}` : ''}</span></div>
    <div className="h-3 rounded-full bg-slate-100 relative overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.budget != null && r.value > r.budget ? '#dc2626' : '#8b5cf6' }} />
      {r.budget != null && <div className="absolute top-0 h-full w-0.5 bg-navy-800" style={{ insetInlineStart: `${(r.budget / max) * 100}%` }} />}</div></div>)}</div>;
}
export function Confirm({ text, onYes, onNo }: { text: string; onYes: () => void; onNo: () => void }) {
  return <Modal title="تأیید" onClose={onNo}><p className="mb-4">{text}</p><div className="flex gap-2"><button className="btn btn-teal flex-1" onClick={onYes}>بله</button><button className="btn btn-ghost flex-1" onClick={onNo}>خیر</button></div></Modal>;
}

/** Shows a banner for read-only access; the API/DB reject writes regardless. */
export function ReadOnlyBanner({ module }: { module: string }) {
  return useLevel(module) === 1 ? <p role="note" className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 mb-3 text-sm">👁 دسترسی شما به این بخش فقط «مشاهده» است.</p> : null;
}
export function Need({ module, children }: { module: string; children: ReactNode }) {
  return useLevel(module) >= 1 ? <>{children}</> : <div className="card text-center my-8"><div className="text-4xl">🔒</div><p className="mt-2">به این بخش دسترسی ندارید. مانا می‌تواند از «تنظیمات ← حساب‌ها و دسترسی‌ها» آن را فعال کند.</p></div>;
}

/** Renders Persian text with English runs isolated (bdi dir=ltr) so punctuation and word order display correctly. */
export function Mixed({ text }: { text: string }) {
  return <>{splitLang(text).length ? (() => { const out: ReactNode[] = []; let rest = text; let i = 0;
    for (const r of splitLang(text)) { const at = rest.indexOf(r.text); if (at > 0) out.push(rest.slice(0, at)); out.push(r.lang === 'en-US' ? <bdi key={i++} dir="ltr" className="font-semibold">{r.text}</bdi> : r.text); rest = rest.slice(at + r.text.length); }
    if (rest) out.push(rest); return out; })() : text}</>;
}
