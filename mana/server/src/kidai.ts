// Child-safe AI helper. The API key stays on the server. Every question and answer is logged for Mana.
import { config } from './config.ts';

export type Msg = { role: 'user' | 'assistant'; content: string };
/** Topics we do not send to the model at all; the child gets a gentle "ask Mom/Dad" and Mana sees a flagged entry. */
const SENSITIVE: RegExp[] = [
  /خودکشی|خودم را بکشم|بمیرم|خودزنی|آسیب به خودم/, /سکس|جنسی|برهنه|پورن|رابطه‌ی جنسی/, /قتل|(?:کسی|آدم|حیوان|معلم|همکلاسی)(?:\s\S{0,8})?\sرا بکشم|چاقو بزنم|بمب|اسلحه|تفنگ بسازم|مواد مخدر|ترياک|تریاک|حشیش/,
  /رمز (?:کارت|بانک|حساب)|شماره (?:کارت|ملی)|آدرس خانه|شماره‌ی موبایل|آدرس (?:منزل|مدرسه)/,
  /kill myself|suicide|porn|sex\b|bomb|weapon|drugs?\b/i,
];
export const flagged = (t: string) => SENSITIVE.some((r) => r.test(t));
export const REDIRECT = 'این سؤال را بهتر است از مامان یا بابا بپرسی. آن‌ها بهترین کمک برای تو هستند. 💜';

const system = (age: 'young' | 'teen', name: string) => `You are a friendly, safe learning helper inside a family app for a child named ${name} (${age === 'young' ? 'about 7 years old, cannot read well' : 'about 13 years old'}).
Rules:
- Reply in simple, warm Persian (Farsi). ${age === 'young' ? 'Use very short sentences (max 3-4), simple words.' : 'Use clear, short paragraphs (max ~6 sentences).'} You may include a short English word or sentence only when teaching English; write English words in Latin letters.
- Help with school subjects, curiosity questions, English practice, stories, crafts, healthy habits, money basics, and kindness. Encourage thinking; for homework explain the idea and guide, do not just give answers to cheat.
- Never ask for or accept personal information (full name, address, phone, school, passwords, card numbers). If the child shares any, gently tell them not to share it and to tell a parent.
- Refuse and redirect to parents for: violence, weapons, sexual content, drugs, self-harm, dangerous experiments, dating, scary or hateful content, medical/legal decisions. For feelings of sadness or danger, be kind and tell the child to talk to Mom or Dad right now.
- Do not pretend to be a person, do not make promises, do not ask the child to keep secrets from parents.
- BILINGUAL: if the child writes or speaks English, or asks to practise English, answer with a short Persian explanation first and then the simple English sentence or word in Latin letters (repeat the key English word once). Never mix scripts inside one word.
- Keep answers short. Do not include links.`;

/** Returns the assistant's reply text, or null when the AI is not configured / failed. */
export async function askModel(age: 'young' | 'teen', name: string, history: Msg[]): Promise<{ text: string } | { error: 'not_configured' | 'failed' }> {
  if (!config.anthropicKey) return { error: 'not_configured' };
  try {
    const r = await fetch(`${config.anthropicBase}/v1/messages`, {
      method: 'POST', headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.anthropicModel, max_tokens: age === 'young' ? 250 : 450, system: system(age, name), messages: history.slice(-8) }), signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return { error: 'failed' };
    const j: any = await r.json(); const text = (j.content ?? []).map((c: any) => c.text ?? '').join('').trim();
    return text ? { text } : { error: 'failed' };
  } catch { return { error: 'failed' }; }
}
