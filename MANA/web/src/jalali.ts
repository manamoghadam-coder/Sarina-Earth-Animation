import * as j from 'jalaali-js';
export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const fa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
export const money = (n: number) => fa(new Intl.NumberFormat('en-US').format(n).replace(/,/g, '٬'));
export const toEnDigits = (s: string) => s.replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[٬,]/g, '');
const pad = (n: number) => String(n).padStart(2, '0');
export const tehranToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
export function parts(iso: string) { const [y, m, d] = iso.split('-').map(Number); return j.toJalaali(y, m, d); }
export const isoFromJ = (jy: number, jm: number, jd: number) => { const g = j.toGregorian(jy, jm, jd); return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`; };
export const wd = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7; };
export const addDays = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
export const jmLen = (jy: number, jm: number) => j.jalaaliMonthLength(jy, jm);
export const fmtDate = (iso?: string | null, withWd = true) => { if (!iso) return '—'; const p = parts(iso.slice(0, 10)); return `${withWd ? WEEKDAYS[wd(iso.slice(0, 10))] + ' ' : ''}${fa(p.jd)} ${MONTHS[p.jm - 1]} ${fa(p.jy)}`; };
export const fmtTime = (t?: string | null) => (t ? fa(t.slice(0, 5)) : '');
export const fmtInstant = (ts: string) => { const d = new Date(ts); const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d); const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); return { date, time }; };
export const instantFa = (ts: string) => { const x = fmtInstant(ts); return `${fmtDate(x.date)} ${fa(x.time)}`; };
/** ISO instant (with +03:30 offset) for a Tehran wall-clock date+time. Iran has no DST now. */
export const tehranIso = (date: string, time: string) => `${date}T${time}:00+03:30`;
