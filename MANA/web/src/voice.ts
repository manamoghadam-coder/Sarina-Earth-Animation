// Persian voice layer. TTS = speechSynthesis; STT = SpeechRecognition (Chrome/Android). Nothing is recorded or stored by MANA.
type Listener = () => void;
const rateKey = 'mana.voice.rate';
export const getRate = () => { try { return Number(localStorage.getItem(rateKey)) || 0.85; } catch { return 0.85; } };
export const setRate = (r: number) => { try { localStorage.setItem(rateKey, String(r)); } catch {} };

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const sttSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

let voicesCache: SpeechSynthesisVoice[] = [];
const loadVoices = () => { if (ttsSupported()) voicesCache = speechSynthesis.getVoices(); };
if (ttsSupported()) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }
export const persianVoice = () => voicesCache.find((v) => /^fa/i.test(v.lang)) ?? null;
/** 'ok' = a Persian voice exists; 'maybe' = engine exists but no Persian voice is listed (Android may still voice it); 'none' = no TTS. */
export const ttsStatus = (): 'ok' | 'maybe' | 'none' => (!ttsSupported() ? 'none' : persianVoice() ? 'ok' : 'maybe');

let current: SpeechSynthesisUtterance | null = null;
/** Speaks Persian text. Resolves when finished (or cancelled). Cancels anything already speaking. */
export function speak(text: string, opts: { rate?: number; cancel?: boolean; source?: 'readaloud' } = {}): Promise<void> {
  if (!ttsSupported() || !text.trim()) return Promise.resolve();
  if (opts.source !== 'readaloud') window.dispatchEvent(new Event('mana-user-speak'));   // read-aloud yields to any other speech
  return new Promise((resolve) => {
    if (opts.cancel !== false) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' '));  // emojis are not spoken
    u.lang = 'fa-IR'; u.rate = opts.rate ?? getRate(); u.pitch = 1.05;
    const v = persianVoice(); if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = (ev) => { if (ev.error !== 'canceled' && ev.error !== 'interrupted') window.dispatchEvent(new CustomEvent('mana-voice-error', { detail: ev.error })); resolve(); };
    current = u; speechSynthesis.speak(u);
  });
}
export const stopSpeaking = () => { if (ttsSupported()) speechSynthesis.cancel(); current = null; };
export const pauseSpeaking = () => ttsSupported() && speechSynthesis.pause();
export const resumeSpeaking = () => ttsSupported() && speechSynthesis.resume();

/** One-shot listening. Microphone permission is requested by the browser only when this is called from a tap. */
export function listen(): { result: Promise<string>; stop: () => void } {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return { result: Promise.reject(new Error('unsupported')), stop() {} };
  const rec = new Ctor(); rec.lang = 'fa-IR'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
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
  if (/(پیام مامان|پیامهای مامان|پیام های مامان|نامه مامان|مامان.*(نوشته|فرستاده)|نامه)/.test(t)) return 'mom';
  if (/(تابلو|آرزو)/.test(t)) return 'wishes';
  if (/(مرور (امروز|شب|شبانه)|سوال(های)? شبانه|سوال شب|شکر|سپاس)/.test(t)) return 'night';
  if (/(دفترچه|دفتر خاطرات|دلنوشته|خاطرات)/.test(t)) return 'diary';
  if (/(چت|گپ|با (بابا|مامان|سامان|سارینا) (حرف|صحبت|پیام))/.test(t)) return 'chat';
  if (/(عکس پروفایل|عکس خودم|عوض کردن عکس)/.test(t)) return 'profile';
  if (/(انجام دادم|انجام شد|تموم شد|تموم کردم|تمام شد|تمام کردم|نوشتم|خوندم|خواندم)/.test(t)) return 'done';
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
void current;

/** «ساعت ۱۶ و ۳۰ دقیقه» for speech. */
export const spokenTime = (t?: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `ساعت ${h}${m ? ` و ${m} دقیقه` : ''}`; };
