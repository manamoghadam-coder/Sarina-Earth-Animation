import * as jalaali from 'jalaali-js';
import { config } from './config.ts';

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** Wall-clock parts in Asia/Tehran for an instant. */
export function tehranParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { y: +p.year, m: +p.month, d: +p.day, hour, minute: +p.minute, date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + +p.minute };
}
export const todayISO = () => tehranParts().date;

/** 0=Saturday..6=Friday for an ISO date (calendar arithmetic only, no TZ). */
export function persianWeekday(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return (js + 1) % 7;
}
export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function toJalali(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return jalaali.toJalaali(y, m, d);
}
export function fromJalali(jy: number, jm: number, jd: number) {
  const g = jalaali.toGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}
export function jalaliMonthRange(jy: number, jm: number) {
  return { from: fromJalali(jy, jm, 1), to: fromJalali(jy, jm, jalaali.jalaaliMonthLength(jy, jm)) };
}
/** Add one Jalali month keeping the day (clamped). */
export function addJalaliMonth(iso: string, n = 1) {
  const j = toJalali(iso);
  let m = j.jm + n, y = j.jy;
  while (m > 12) { m -= 12; y++; }
  const day = Math.min(j.jd, jalaali.jalaaliMonthLength(y, m));
  return fromJalali(y, m, day);
}
export const fmtJalali = (iso: string) => { const j = toJalali(iso); return `${WEEKDAYS[persianWeekday(iso)]} ${j.jd} ${MONTHS[j.jm - 1]} ${j.jy}`; };
/** Instant for a Tehran wall-clock date+time (Iran has no DST since 2022; offset resolved via Intl to be safe). */
export function tehranInstant(iso: string, hhmm: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = tehranParts(new Date(guess));
    const want = Date.UTC(y, m - 1, d, h, mi), got = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
    guess += want - got;
  }
  return new Date(guess);
}
