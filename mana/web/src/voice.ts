// Persian + English voice layer. TTS = speechSynthesis; STT = SpeechRecognition (Chrome/Android). Nothing is recorded or stored by the app.
import { splitLang } from './langsplit';
type Listener = () => void;
const rateKey = 'mana.voice.rate', faKey = 'mana.voice.fa', enKey = 'mana.voice.en', listenKey = 'mana.voice.listen';
const store = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

/** Speed presets: slow by default (kids), because fast speech is hard to follow. */
export const SPEEDS: [string, number][] = [['خیلی آرام', 0.55], ['آرام', 0.7], ['معمولی', 0.9]];
export const DEFAULT_RATE = 0.7;
export const getRate = () => { const v = Number(store(rateKey)); return v >= 0.4 && v <= 1.2 ? v : DEFAULT_RATE; };
export const setRate = (r: number) => { store(rateKey, String(r)); };
export type ListenLang = 'fa-IR' | 'en-US';
export const getListenLang = (): ListenLang => (store(listenKey) === 'en-US' ? 'en-US' : 'fa-IR');
export const setListenLang = (l: ListenLang) => { store(listenKey, l); };

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const sttSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

let voicesCache: SpeechSynthesisVoice[] = [];
const loadVoices = () => { if (ttsSupported()) voicesCache = speechSynthesis.getVoices(); };
if (ttsSupported()) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }
export const listVoices = (p: 'fa' | 'en') => voicesCache.filter((v) => new RegExp(`^${p}`, 'i').test(v.lang));
const quality = (v: SpeechSynthesisVoice) => (/google|neural|natural|online|enhanced|premium/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1) + (/^en[-_]US/i.test(v.lang) ? 1 : 0);
const best = (p: 'fa' | 'en') => { const chosen = store(p === 'fa' ? faKey : enKey); const list = listVoices(p); return list.find((v) => v.name === chosen) ?? [...list].sort((a, b) => quality(b) - quality(a))[0] ?? null; };
export const chooseVoice = (p: 'fa' | 'en', name: string) => { store(p === 'fa' ? faKey : enKey, name); };
export const chosenVoiceName = (p: 'fa' | 'en') => best(p)?.name ?? '';
export const persianVoice = () => best('fa');
export const englishVoice = () => best('en');
/** 'ok' = a Persian voice exists; 'maybe' = engine exists but no Persian voice is listed (Android may still voice it); 'none' = no TTS. */
export const ttsStatus = (): 'ok' | 'maybe' | 'none' => (!ttsSupported() ? 'none' : persianVoice() ? 'ok' : 'maybe');

let token = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sentencesOf = (t: string) => t.split(/(?<=[.!؟?۔\n])\s+/u).map((x) => x.trim()).filter(Boolean);
function utter(text: string, lang: 'fa-IR' | 'en-US', rate: number): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = lang === 'en-US' ? Math.min(rate, 0.85) : rate; u.pitch = 1; u.volume = 1;
    const v = lang === 'en-US' ? englishVoice() : persianVoice(); if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = (ev) => { if (ev.error !== 'canceled' && ev.error !== 'interrupted') window.dispatchEvent(new CustomEvent('mana-voice-error', { detail: ev.error })); resolve(); };
    speechSynthesis.speak(u);
  });
}
/** Speaks Persian text slowly and clearly: one sentence at a time with a short pause; English words/sentences inside it use an English voice. Resolves when finished or cancelled. */
export async function speak(text: string, opts: { rate?: number; cancel?: boolean; source?: 'readaloud' } = {}): Promise<void> {
  if (!ttsSupported() || !text.trim()) return;
  if (opts.source !== 'readaloud') window.dispatchEvent(new Event('mana-user-speak'));   // read-aloud yields to any other speech
  const clean = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ');   // emojis are not spoken
  const my = opts.cancel === false ? token : ++token; if (opts.cancel !== false) speechSynthesis.cancel();
  const rate = opts.rate ?? getRate();
  for (const sent of sentencesOf(clean)) {
    for (const r of splitLang(sent)) { if (my !== token) return; await utter(r.text, r.lang, rate); }
    if (my !== token) return; await sleep(Math.round(260 / Math.max(rate, 0.5)));
  }
}
export const stopSpeaking = () => { token++; if (ttsSupported()) speechSynthesis.cancel(); };
export const pauseSpeaking = () => ttsSupported() && speechSynthesis.pause();
export const resumeSpeaking = () => ttsSupported() && speechSynthesis.resume();

/** One-shot listening. Microphone permission is requested by the browser only when this is called from a tap. */
export function listen(lang: ListenLang = getListenLang()): { result: Promise<string>; stop: () => void } {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return { result: Promise.reject(new Error('unsupported')), stop() {} };
  const rec = new Ctor(); rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  const result = new Promise<string>((resolve, reject) => {
    let got = false;
    rec.onresult = (e: any) => { got = true; resolve(e.results[0][0].transcript as string); };
    rec.onerror = (e: any) => reject(new Error(e.error || 'error'));
    rec.onend = () => { if (!got) reject(new Error('no-speech')); };
    try { rec.start(); } catch (e) { reject(e as Error); }
  });
  return { result, stop: () => { try { rec.stop(); } catch {} } };
}
export const sttErrorText = (code: string) => ({
  'not-allowed': 'اجازه‌ی میکروفون داده نشد. از تنظیمات مرورگر اجازه بده.', 'service-not-allowed': 'سرویس تشخیص گفتار در این دستگاه فعال نیست.',
  'no-speech': 'صدایی نشنیدم. دوباره بگو.', 'audio-capture': 'میکروفون پیدا نشد.', network: 'برای تشخیص گفتار اینترنت لازم است.', unsupported: 'این مرورگر تشخیص گفتار فارسی ندارد؛ از دکمه‌های تصویری استفاده کن.',
} as Record<string, string>)[code] ?? 'تشخیص صدا انجام نشد.';

// ---------- command matching (pure) ----------
const norm = (s: string) => s.replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[‌‌]/g, ' ').replace(/[؟?!.،,]/g, ' ').replace(/\s+/g, ' ').trim();
export type VoiceCmd = 'greet' | 'today' | 'now' | 'next' | 'done' | 'story' | 'stars' | 'diary' | 'wishes' | 'night' | 'mom' | 'chat' | 'profile' | 'yes' | 'no' | 'help' | 'unknown';
export function matchCommand(raw: string): VoiceCmd {
  const t = norm(raw);
  if (/^(بله|آره|اره|باشه|تایید|درسته)( |$)/.test(t)) return 'yes';
  if (/^(نه|نخیر|نمیخوام|نمی خوام|لغو)( |$)/.test(t)) return 'no';
  if (/(انجام دادم|انجام شد|تموم شد|تموم کردم|تمام شد|تمام کردم|نوشتم|خوندم|خواندم)/.test(t)) return 'done';
  if (/(پیام مامان|پیامهای مامان|پیام های مامان|نامه مامان|مامان.*(نوشته|فرستاده)|نامه)/.test(t)) return 'mom';
  if (/(تابلو|آرزو)/.test(t)) return 'wishes';
  if (/(مرور (امروز|شب|شبانه)|سوال(های)? شبانه|سوال شب|شکر|سپاس)/.test(t)) return 'night';
  if (/(دفترچه|دفتر خاطرات|دلنوشته|خاطرات)/.test(t)) return 'diary';
  if (/(چت|گپ|با (بابا|مامان|سامان|سارینا) (حرف|صحبت|پیام))/.test(t)) return 'chat';
  if (/(عکس پروفایل|عکس خودم|عوض کردن عکس)/.test(t)) return 'profile';
  if (/(بعدش|بعد از این|بعدی)/.test(t)) return 'next';
  if (/(الان|چیکار کنم|چه کار کنم|چی کار کنم|چه کاری)/.test(t)) return 'now';
  if (/(برنامه|امروز|کارهام|کارهای من)/.test(t)) return 'today';
  if (/(قصه|داستان)/.test(t)) return 'story';
  if (/(ستاره|امتیاز)/.test(t)) return 'stars';
  if (/(کمک|چیکار میتونی|چه کار می ?تونی)/.test(t)) return 'help';
  if (/^(سلام|درود|هی|های)( |$)/.test(t)) return 'greet';
  return 'unknown';
}
export const listeners = new Set<Listener>();

/** «ساعت ۱۶ و ۳۰ دقیقه» for speech. */
export const spokenTime = (t?: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `ساعت ${h}${m ? ` و ${m} دقیقه` : ''}`; };
