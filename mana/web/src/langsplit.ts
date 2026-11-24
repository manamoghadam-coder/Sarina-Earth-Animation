/** Splits mixed Persian/English text into runs so each can be spoken with the right voice (fa-IR / en-US). */
export type Run = { text: string; lang: 'fa-IR' | 'en-US' };
const EN = /[A-Za-z][A-Za-z0-9'’\-]*(?:[ ,]+[A-Za-z][A-Za-z0-9'’\-]*)*(?:[.!?])?/g;
export function splitLang(text: string): Run[] {
  const out: Run[] = []; let last = 0; let m: RegExpExecArray | null;
  EN.lastIndex = 0;
  while ((m = EN.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), lang: 'fa-IR' });
    out.push({ text: m[0], lang: 'en-US' }); last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), lang: 'fa-IR' });
  return out.filter((r) => /[\p{L}\p{N}]/u.test(r.text));
}
