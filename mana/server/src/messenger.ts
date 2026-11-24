// Messenger channel (Bale by default; Telegram optional). Both speak the same "Bot API"; only the base URL/token differ.
// Linking: a signed-in user asks for a one-time code in the app and sends "/start CODE" to the bot. Long polling is used,
// so no public webhook is needed (works on a laptop or behind NAT). Switching provider = change MESSENGER_PROVIDERS.
import crypto from 'node:crypto';
import { config } from './config.ts';
import { sys } from './db.ts';
import { fmtJalali, todayISO } from './jalali.ts';

export type Provider = 'bale' | 'telegram';
const P = (p: Provider) => (p === 'bale' ? { token: config.baleToken, base: config.baleBase } : { token: config.telegramToken, base: config.telegramBase });
export const activeProviders = (): Provider[] => (config.messengerProviders.filter((p) => (p === 'bale' || p === 'telegram') && P(p as Provider).token) as Provider[]);
export const providerLabel = (p: Provider) => (p === 'bale' ? 'بله' : 'تلگرام');

async function call(p: Provider, method: string, body: Record<string, unknown>, timeoutMs = 15000) {
  const { token, base } = P(p);
  const r = await fetch(`${base}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const j: any = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(`${p} ${method} failed: ${r.status} ${j.description ?? ''}`);
  return j.result;
}
export const sendMessage = (p: Provider, chatId: string, text: string) => call(p, 'sendMessage', { chat_id: chatId, text: text.slice(0, 3800) });

/** Sends a message to every linked, enabled chat of the user on the active providers. Returns a short status for the notification log. */
export async function sendToUser(userId: string, text: string): Promise<string | null> {
  const act = activeProviders(); if (!act.length) return null;
  const links = await sys(`SELECT provider, chat_id FROM messenger_links WHERE user_id=$1 AND enabled AND provider = ANY($2)`, [userId, act]);
  if (!links.length) return null;
  const out: string[] = [];
  for (const l of links) { try { await sendMessage(l.provider, l.chat_id, text); out.push(`${l.provider}:ok`); } catch (e: any) { out.push(`${l.provider}:fail`); } }
  return out.join(',');
}

export async function newLinkCode(userId: string, provider: Provider) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const code = Array.from(crypto.randomBytes(8), (b) => A[b % A.length]).join('');
  await sys(`DELETE FROM messenger_codes WHERE user_id=$1 AND provider=$2 OR expires_at < now()`, [userId, provider]);
  await sys(`INSERT INTO messenger_codes (code,user_id,provider,expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`, [code, userId, provider]);
  return code;
}

const HELP = 'دستورها:\n/today — خلاصه‌ی امروز\n/list — لیست خرید\n/add نام کالا — افزودن به لیست خرید\n/unlink — قطع اتصال این گفتگو';
const lvl = (u: any, m: string) => (u.role === 'parent' ? 2 : u.role === 'member' ? Math.min(2, Number(u.permissions?.[m] ?? 0)) : 0);

/** Handles one incoming bot message and returns the reply text (null = no reply). Exported for tests. */
export async function handleMessage(provider: Provider, chatId: string, text: string): Promise<string | null> {
  const t = text.trim(); const [cmdRaw, ...rest] = t.split(/\s+/); const cmd = cmdRaw.toLowerCase().replace(/@\S+$/, ''); const arg = rest.join(' ');
  if (cmd === '/start' || cmd === '/link') {
    if (!arg) return 'سلام! برای اتصال، در برنامه به «تنظیمات ← اتصال به پیام‌رسان» بروید، کد را بگیرید و اینجا بفرستید: /start کد';
    const [c] = await sys(`DELETE FROM messenger_codes WHERE code=$1 AND provider=$2 AND expires_at > now() RETURNING user_id`, [arg.toUpperCase(), provider]);
    if (!c) return 'کد معتبر نیست یا منقضی شده. در برنامه کد تازه بگیرید.';
    await sys(`DELETE FROM messenger_links WHERE provider=$1 AND chat_id=$2`, [provider, chatId]);
    await sys(`INSERT INTO messenger_links (user_id,provider,chat_id) VALUES ($1,$2,$3) ON CONFLICT (user_id,provider) DO UPDATE SET chat_id=EXCLUDED.chat_id, enabled=true, linked_at=now()`, [c.user_id, provider, chatId]);
    return `✅ اتصال انجام شد. از این پس اعلان‌ها در ${providerLabel(provider)} هم می‌رسد.\n\n${HELP}`;
  }
  const [u] = await sys(`SELECT u.id, u.role, u.display_name, u.permissions FROM messenger_links l JOIN users u ON u.id=l.user_id WHERE l.provider=$1 AND l.chat_id=$2 AND u.active`, [provider, chatId]);
  if (!u) return 'این گفتگو به هیچ حسابی متصل نیست. در برنامه کد اتصال بگیرید و بفرستید: /start کد';
  if (cmd === '/help') return HELP;
  if (cmd === '/unlink') { await sys(`DELETE FROM messenger_links WHERE provider=$1 AND chat_id=$2`, [provider, chatId]); return 'اتصال قطع شد.'; }
  if (cmd === '/today') {
    const today = todayISO(); const lines: string[] = [`📅 ${fmtJalali(today)}`];
    if (lvl(u, 'tasks') >= 1) { const r = await sys(`SELECT title FROM tasks WHERE status IN ('todo','doing','waiting') AND (due_date <= $1) ORDER BY priority LIMIT 6`, [today]); lines.push(r.length ? '✅ کارها:\n' + r.map((x: any) => `• ${x.title}`).join('\n') : '✅ کار سررسیدشده‌ای نیست.'); }
    if (lvl(u, 'events') >= 1) { const r = await sys(`SELECT title, starts_at FROM events WHERE starts_at::date = $1::date OR (starts_at >= now() AND starts_at < now() + interval '1 day') ORDER BY starts_at LIMIT 5`, [today]); if (r.length) lines.push('🗓 رویدادها:\n' + r.map((x: any) => `• ${x.title}`).join('\n')); }
    if (lvl(u, 'children') >= 1) { const [{ n }] = await sys(`SELECT count(*)::int n FROM completions WHERE status='pending'`); const [{ m }] = await sys(`SELECT count(*)::int m FROM purchase_requests WHERE status='requested'`); lines.push(`⭐ منتظر تأیید: ${n} فعالیت، ${m} درخواست خرید`); }
    return lines.length > 1 ? lines.join('\n\n') : lines[0] + '\nدسترسی‌ای برای نمایش خلاصه ندارید.';
  }
  if (cmd === '/list') {
    if (lvl(u, 'shopping') < 1) return 'به لیست خرید دسترسی ندارید.';
    const r = await sys(`SELECT title, qty FROM shopping_items WHERE status='open' ORDER BY category, added_at LIMIT 40`);
    return r.length ? '🛒 لیست خرید:\n' + r.map((x: any) => `• ${x.title}${x.qty ? ' (' + x.qty + ')' : ''}`).join('\n') : '🛒 لیست خرید خالی است.';
  }
  if (cmd === '/add') {
    if (lvl(u, 'shopping') < 2) return 'اجازه‌ی افزودن به لیست خرید را ندارید.'; if (!arg) return 'مثال: /add شیر';
    await sys(`INSERT INTO shopping_items (title, added_by) VALUES ($1,$2)`, [arg.slice(0, 120), u.id]); return `✅ «${arg.slice(0, 120)}» به لیست خرید اضافه شد.`;
  }
  return HELP;
}

/** Long-polling loop for one provider. Failures back off; never throws. */
export function startMessengerPolling(log: { info: Function; warn: Function }) {
  const stops: (() => void)[] = [];
  for (const p of activeProviders()) {
    let offset = 0; let alive = true; let delay = 2000;
    (async () => {
      log.info(`messenger polling started: ${p}`);
      while (alive) {
        try {
          const ups: any[] = await call(p, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 40000);
          delay = 2000;
          for (const u of ups) { offset = Math.max(offset, (u.update_id ?? 0) + 1); const m = u.message; if (!m?.text || !m.chat?.id) continue;
            try { const reply = await handleMessage(p, String(m.chat.id), m.text); if (reply) await sendMessage(p, String(m.chat.id), reply); } catch (e: any) { log.warn(`messenger handle failed: ${e.message}`); } }
        } catch (e: any) { log.warn(`messenger ${p} poll error: ${e.message}`); await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 60000); }
      }
    })();
    stops.push(() => { alive = false; });
  }
  return () => stops.forEach((s) => s());
}
