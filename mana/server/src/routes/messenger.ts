import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdult } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { activeProviders, newLinkCode, providerLabel, sendToUser, type Provider } from '../messenger.ts';

export default async function messengerRoutes(app: FastifyInstance) {
  const prov = z.enum(['bale', 'telegram']);
  app.get('/api/messenger/status', { preHandler: requireAdult }, async (req) => {
    const links = await withActor(req.actor!, (q) => q(`SELECT provider, enabled, linked_at FROM messenger_links WHERE user_id=$1`, [req.actor!.id]));
    const act = activeProviders();
    return { providers: (['bale', 'telegram'] as Provider[]).map((p) => ({ provider: p, label: providerLabel(p), active: act.includes(p), link: links.find((l: any) => l.provider === p) ?? null })) };
  });
  app.post('/api/messenger/link-code', { preHandler: requireAdult }, async (req, reply) => {
    const { provider } = z.object({ provider: prov }).strict().parse(req.body);
    if (!activeProviders().includes(provider)) return reply.code(409).send({ error: 'provider_inactive', message: `ربات ${providerLabel(provider)} روی سرور فعال نشده (توکن یا MESSENGER_PROVIDERS).` });
    return { code: await newLinkCode(req.actor!.id, provider), expires_minutes: 10, command: '/start' };
  });
  app.post('/api/messenger/toggle', { preHandler: requireAdult }, async (req) => {
    const { provider, enabled } = z.object({ provider: prov, enabled: z.boolean() }).strict().parse(req.body);
    await withActor(req.actor!, (q) => q(`UPDATE messenger_links SET enabled=$3 WHERE user_id=$1 AND provider=$2`, [req.actor!.id, provider, enabled])); return { ok: true };
  });
  app.post('/api/messenger/unlink', { preHandler: requireAdult }, async (req) => {
    const { provider } = z.object({ provider: prov }).strict().parse(req.body);
    await withActor(req.actor!, (q) => q(`DELETE FROM messenger_links WHERE user_id=$1 AND provider=$2`, [req.actor!.id, provider])); return { ok: true };
  });
  app.post('/api/messenger/test', { preHandler: requireAdult }, async (req) => ({ status: (await sendToUser(req.actor!.id, '🔔 پیام آزمایشی از «دنیای کوچک ما»')) ?? 'not_linked' }));
  void sys;
}
