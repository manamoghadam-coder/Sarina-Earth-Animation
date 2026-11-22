import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.ts';
import { requireParent, requireUser } from '../auth.ts';
import { withActor } from '../db.ts';
import { pushReady } from '../push.ts';
import { todayISO } from '../jalali.ts';
import { zId } from '../util.ts';

export default async function notificationRoutes(app: FastifyInstance) {
  // delivered (due) notifications for the signed-in user; the PWA polls this while open
  app.get('/api/notifications', { preHandler: requireUser }, async (req) => {
    const { unseen } = z.object({ unseen: z.enum(['1', '0']).optional() }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT id,kind,title,body,icon,voice_text,ref_type,ref_id,ref_day,due_at,seen_at,done_at,snoozed_count FROM notifications
      WHERE user_id=$1 AND due_at <= now() ${unseen === '1' ? 'AND seen_at IS NULL AND done_at IS NULL' : ''} ORDER BY due_at DESC LIMIT 50`, [req.actor!.id]));
  });
  app.get('/api/notifications/history', { preHandler: requireParent }, async (req) => {
    const { user_id } = z.object({ user_id: zId.optional() }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT n.id,n.kind,n.title,n.body,n.icon,n.due_at,n.sent_at,n.push_status,n.seen_at,n.done_at,n.snoozed_count,u.display_name AS user_name,
        (SELECT status FROM completions c WHERE n.ref_type='activity' AND c.activity_id=n.ref_id AND c.day=n.ref_day) AS completion
      FROM notifications n JOIN users u ON u.id=n.user_id WHERE ($1::uuid IS NULL OR n.user_id=$1) AND n.due_at <= now() ORDER BY n.due_at DESC LIMIT 100`, [user_id ?? null]));
  });
  app.post('/api/notifications/:id/seen', { preHandler: requireUser }, async (req) => {
    const id = zId.parse((req.params as any).id);
    await withActor(req.actor!, (q) => q(`UPDATE notifications SET seen_at = COALESCE(seen_at, now()) WHERE id=$1 AND user_id=$2`, [id, req.actor!.id]));
    return { ok: true };
  });
  app.post('/api/notifications/:id/snooze', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { minutes } = z.object({ minutes: z.number().int().min(1).max(120).default(10) }).parse(req.body ?? {});
    const r = await withActor(req.actor!, (q) => q(`UPDATE notifications SET due_at = now() + $3::int * interval '1 minute', sent_at=NULL, push_status=NULL, seen_at=NULL, snoozed_count=snoozed_count+1
      WHERE id=$1 AND user_id=$2 AND snoozed_count < 3 AND done_at IS NULL RETURNING id`, [id, req.actor!.id, minutes]));
    return r[0] ? { ok: true } : reply.code(409).send({ error: 'snooze_limit' });
  });
  // "done" from a notification: child => pending completion for mother's approval; parent => mark task done
  app.post('/api/notifications/:id/done', { preHandler: requireUser }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    return withActor(req.actor!, async (q) => {
      const [n] = await q(`UPDATE notifications SET done_at=now(), seen_at=COALESCE(seen_at, now()) WHERE id=$1 AND user_id=$2 RETURNING ref_type, ref_id, ref_day`, [id, req.actor!.id]);
      if (!n) return reply.code(404).send({ error: 'not_found' });
      if (n.ref_type === 'activity' && req.actor!.role === 'child')
        await q(`INSERT INTO completions (activity_id, child_id, day) VALUES ($1,$2,$3) ON CONFLICT (activity_id, day) DO NOTHING`, [n.ref_id, req.actor!.id, n.ref_day ?? todayISO()]);
      if (n.ref_type === 'task' && req.actor!.role === 'parent') await q(`UPDATE tasks SET status='done', done_at=now() WHERE id=$1`, [n.ref_id]);
      return { ok: true, awaiting_approval: n.ref_type === 'activity' && req.actor!.role === 'child' };
    });
  });
  // parent: send a test notification now (also tries real Web Push)
  app.post('/api/notifications/test', { preHandler: requireParent }, async (req) => {
    const { user_id, text } = z.object({ user_id: zId, text: z.string().max(200).optional() }).parse(req.body);
    const body = text ?? 'این یک اعلان آزمایشی است.';
    const r = await withActor(req.actor!, (q) => q(`INSERT INTO notifications (user_id,kind,title,body,icon,voice_text,due_at,dedupe_key) VALUES ($1,'test','اعلان آزمایشی',$2,'🔔',$2, now(), 'test:'||gen_random_uuid()) RETURNING id`, [user_id, body]));
    return { id: r[0].id, push_configured: pushReady, note: 'scheduler delivers it within ~30s' };
  });
  app.get('/api/push/key', { preHandler: requireUser }, async () => ({ publicKey: config.vapidPublic || null, configured: pushReady }));
  app.post('/api/push/subscribe', { preHandler: requireUser }, async (req) => {
    const s = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body);
    await withActor(req.actor!, (q) => q(`INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES ($1,$2,$3,$4) ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`, [req.actor!.id, s.endpoint, s.keys.p256dh, s.keys.auth]));
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', { preHandler: requireUser }, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await withActor(req.actor!, (q) => q(`DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2`, [endpoint, req.actor!.id]));
    return { ok: true };
  });
}
