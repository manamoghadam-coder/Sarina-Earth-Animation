// Natural-language understanding for MANA AI.
// 1) Deterministic Persian rule parser (always available, no network).
// 2) Optional Claude call (key kept server-side) that returns the same structured intent; falls back to rules on any failure.
import { config } from './config.ts';
import { addDays, persianWeekday, tehranParts, todayISO, WEEKDAYS } from './jalali.ts';

export type Intent =
  | { intent: 'create_event'; title: string; date: string; time: string }
  | { intent: 'create_transaction'; kind: 'income' | 'expense'; amount: number; category: string; date: string; note: string }
  | { intent: 'create_child_activity'; child: 'sarina' | 'saman'; title: string; date: string; time: string | null; kind: string }
  | { intent: 'child_done'; child: 'sarina' | 'saman'; keyword: string; date: string }
  | { intent: 'report_expenses' }
  | { intent: 'top_priorities'; date: string }
  | { intent: 'create_task'; title: string; date: string | null }
  | { intent: 'unknown' };

const digitMap: Record<string, string> = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };
export const normalize = (s: string) => s.replace(/[۰-۹٠-٩]/g, (c) => digitMap[c]).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[‌‏]/g, ' ').replace(/[،,]/g, ' ').replace(/\s+/g, ' ').trim();

const UNITS: Record<string, number> = { صفر: 0, یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, شانزده: 16, هفده: 17, هجده: 18, نوزده: 19,
  بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60, هفتاد: 70, هشتاد: 80, نود: 90, صد: 100, یکصد: 100, دویست: 200, سیصد: 300, چهارصد: 400, پانصد: 500, ششصد: 600, هفتصد: 700, هشتصد: 800, نهصد: 900, نصف: 0.5 };
const SCALE: Record<string, number> = { هزار: 1e3, میلیون: 1e6, ملیون: 1e6, میلیارد: 1e9 };

/** Parses "۸۰۰ هزار تومان", "هشتصد هزار تومان", "2.5 میلیون", "۳۰۰۰۰۰ تومان". Returns TOMAN or null. */
export function parseAmount(raw: string): number | null {
  const s = normalize(raw).replace(/(\d),(\d{3})/g, '$1$2');
  const toks = s.split(' ');
  for (let i = 0; i < toks.length; i++) {
    // digits (+ optional scale)
    if (/^\d+(\.\d+)?$/.test(toks[i])) {
      const next = toks[i + 1], nn = toks[i + 2];
      if (SCALE[next]) return Math.round(Number(toks[i]) * SCALE[next]);
      if (next === 'تومان' || next === 'تومن' || next === 'ریال' || nn === 'تومان') return next === 'ریال' ? Math.round(Number(toks[i]) / 10) : Number(toks[i]);
      if (Number(toks[i]) >= 1000) return Number(toks[i]);
    }
    // word numbers
    let total = 0, cur = 0, seen = false, j = i;
    for (; j < toks.length; j++) {
      const t = toks[j];
      if (t === 'و' && seen) continue;
      if (t in UNITS) { cur += UNITS[t]; seen = true; }
      else if (t in SCALE) { if (!seen) break; total += (cur || 1) * SCALE[t]; cur = 0; }
      else break;
    }
    if (seen && (total > 0 || /تومان|تومن/.test(toks[j] ?? ''))) return Math.round(total + cur);
  }
  return null;
}

export function parseDate(s: string, today = todayISO()): string | null {
  const t = normalize(s);
  if (/پس ?فردا/.test(t)) return addDays(today, 2);
  if (/فردا/.test(t)) return addDays(today, 1);
  if (/دیروز/.test(t)) return addDays(today, -1);
  if (/امروز|امشب|امروز/.test(t)) return today;
  const names = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه ?شنبه', 'چهار ?شنبه', 'پنج ?شنبه', 'جمعه'];
  for (let i = 6; i >= 0; i--) if (new RegExp(`(^| )${names[i]}( |$)`).test(t) && !(i === 0 && /(یک|دو|سه|چهار|پنج) ?شنبه/.test(t) && !/(^| )شنبه/.test(t.replace(/(یک|دو|سه|چهار|پنج) ?شنبه/g, '')))) {
    const cur = persianWeekday(today); let diff = (i - cur + 7) % 7; if (diff === 0) diff = 7; return addDays(today, diff);
  }
  return null;
}
export function parseTime(s: string): string | null {
  const t = normalize(s);
  let m = t.match(/(?:ساعت )?(\d{1,2})[:٫.](\d{2})/);
  let h: number | null = null, mi = 0;
  if (m) { h = +m[1]; mi = +m[2]; }
  else if ((m = t.match(/ساعت (\d{1,2})( و (نیم|ربع|\d{1,2}))?/))) { h = +m[1]; mi = m[3] === 'نیم' ? 30 : m[3] === 'ربع' ? 15 : m[3] ? +m[3] : 0; }
  else if ((m = t.match(/(\d{1,2}) (صبح|ظهر|عصر|بعد از ظهر|شب)/))) h = +m[1];
  else if ((m = t.match(/ساعت (\S+)/)) && m[1] in UNITS) h = UNITS[m[1]];
  if (h === null) return null;
  if (/عصر|بعد از ظهر/.test(t) && h < 12) h += 12;
  else if (/شب/.test(t) && h >= 1 && h <= 11 && h !== 12) h += 12;   // «۱۰ شب» = 22:00
  else if (/ظهر/.test(t) && h < 11) h += 12;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const CATS: [RegExp, string][] = [[/خرید خانه|خانه|سوپرمارکت|میوه|نان|مواد غذایی|خوراک/, 'خانه'], [/بنزین|تاکسی|اسنپ|مترو|حمل/, 'حمل‌ونقل'], [/دارو|دکتر|درمان|بیمارستان/, 'سلامت'], [/مدرسه|کلاس|کتاب|آموزش/, 'آموزش'], [/رستوران|کافه|تفریح|سینما/, 'تفریح'], [/قبض|برق|گاز|آب|اینترنت|شارژ/, 'قبوض'], [/حقوق|پاداش/, 'حقوق'], [/لباس|پوشاک/, 'پوشاک']];
const kidOf = (t: string): 'sarina' | 'saman' | null => (/سارینا/.test(t) ? 'sarina' : /سامان/.test(t) ? 'saman' : null);
const KID_KINDS: [RegExp, string, string][] = [[/سنتور/, 'music', 'تمرین سنتور'], [/تکالیف|تکلیف|مشق/, 'homework', 'تکالیف'], [/مطالعه|کتاب/, 'reading', 'مطالعه'], [/زبان/, 'language', 'تمرین زبان'], [/رقص/, 'class', 'کلاس رقص'], [/قصه/, 'story', 'قصه'], [/نوشتن/, 'writing', 'تمرین نوشتن'], [/اتاق/, 'chore', 'مرتب کردن اتاق']];

export function ruleParse(input: string, today = todayISO()): Intent {
  const t = normalize(input);
  const kid = kidOf(t); const kk = KID_KINDS.find(([r]) => r.test(t));
  if (kid && /انجام داد|انجام شد|تمام کرد|تموم کرد|نوشت|خواند/.test(t) && !/ثبت کن/.test(t)) return { intent: 'child_done', child: kid, keyword: kk?.[2] ?? '', date: parseDate(t, today) ?? today };
  if (kid && /ثبت|اضافه|بگذار|بذار|یادآوری/.test(t)) return { intent: 'create_child_activity', child: kid, title: kk?.[2] ?? t.replace(/برای (سارینا|سامان)|ثبت کن|فردا|امروز/g, '').trim() ?? 'فعالیت', date: parseDate(t, today) ?? today, time: parseTime(t), kind: kk?.[1] ?? 'other' };
  if (/گزارش (هزینه|مالی)/.test(t) || /هزینه.*این ماه/.test(t)) return { intent: 'report_expenses' };
  if (/(سه|۳|3) (کار )?(مهم|اولویت)|اولویت/.test(t)) return { intent: 'top_priorities', date: parseDate(t, today) ?? addDays(today, 1) };
  const amount = parseAmount(t);
  if (amount && /خرید|هزینه|پرداخت|دادم|خرج|قسط|بنزین|قبض/.test(t) && !/درآمد|حقوق|دریافت/.test(t))
    return { intent: 'create_transaction', kind: 'expense', amount, category: CATS.find(([r]) => r.test(t))?.[1] ?? 'سایر', date: parseDate(t, today) ?? today, note: input.slice(0, 200) };
  if (amount && /درآمد|حقوق|دریافت|واریز|پاداش/.test(t))
    return { intent: 'create_transaction', kind: 'income', amount, category: CATS.find(([r]) => r.test(t))?.[1] ?? 'حقوق', date: parseDate(t, today) ?? today, note: input.slice(0, 200) };
  if (/جلسه|قرار|ملاقات|مصاحبه|دکتر|رویداد/.test(t)) {
    const time = parseTime(t); const date = parseDate(t, today);
    if (date && time) return { intent: 'create_event', title: /جلسه/.test(t) ? 'جلسه' : /قرار/.test(t) ? 'قرار' : 'رویداد', date, time };
  }
  if (/یادم باشه|کار|وظیفه|باید/.test(t) && !/چطور|چیه/.test(t)) return { intent: 'create_task', title: t.replace(/فردا|امروز|یادم باشه|ثبت کن/g, '').trim() || t, date: parseDate(t, today) };
  return { intent: 'unknown' };
}

export const SCHEMA_HELP = `Return ONLY JSON matching one of: {"intent":"create_event","title","date":"YYYY-MM-DD","time":"HH:MM"} | {"intent":"create_transaction","kind":"income|expense","amount":<toman integer>,"category","date","note"} | {"intent":"create_child_activity","child":"sarina|saman","title","date","time":"HH:MM|null","kind"} | {"intent":"child_done","child","keyword","date"} | {"intent":"report_expenses"} | {"intent":"top_priorities","date"} | {"intent":"create_task","title","date|null"} | {"intent":"unknown"}`;

export async function llmParse(input: string): Promise<Intent | null> {
  if (!config.anthropicKey) return null;
  try {
    const p = tehranParts();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: 400, system: `You convert Persian requests for a family assistant into a JSON intent. Today (Asia/Tehran) is ${p.date}, weekday ${WEEKDAYS[persianWeekday(p.date)]}. Amounts are in Toman. ${SCHEMA_HELP}`, messages: [{ role: 'user', content: input }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const text: string = j.content?.[0]?.text ?? '';
    const obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return typeof obj?.intent === 'string' ? (obj as Intent) : null;
  } catch { return null; }
}
