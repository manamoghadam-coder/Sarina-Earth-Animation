import * as webpushNs from 'web-push';
const webpush: typeof import('web-push') = (webpushNs as any).default ?? webpushNs;
import { config } from './config.ts';
import { sys } from './db.ts';

export const pushReady = !!(config.vapidPublic && config.vapidPrivate);
if (pushReady) webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);

/** Sends a Web Push to all devices of a user. Returns a status string stored on the notification. */
export async function sendPush(userId: string, payload: Record<string, unknown>): Promise<string> {
  if (!pushReady) return 'no_vapid_keys';
  const subs = await sys(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1`, [userId]);
  if (!subs.length) return 'no_subscription';
  let ok = 0, fail = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 }); ok++; }
    catch (e: any) { fail++; if (e.statusCode === 404 || e.statusCode === 410) await sys(`DELETE FROM push_subscriptions WHERE id=$1`, [s.id]); }
  }
  return ok ? `sent:${ok}` : `failed:${fail}`;
}
