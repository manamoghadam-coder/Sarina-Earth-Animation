import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, requireUser } from '../auth.ts';
import { sys, withActor } from '../db.ts';
import { askModel, flagged, REDIRECT, type Msg } from '../kidai.ts';
import { todayISO, tehranInstant } from '../jalali.ts';
import { zId } from '../util.ts';

export default async function kidAiRoutes(app: FastifyInstance) {
  // child asks; both sides are stored with the system pool (children cannot write the log themselves)
  app.post('/api/child/ask', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (req.actor!.role !== 'child') return reply.code(403).send({ error: 'children_only' });
    const { question } = z.object({ question: z.string().trim().min(1).max(400) }).strict().parse(req.body); const cid = req.actor!.id;
    const [s] = await sys(`SELECT u.display_name, u.age_group, c.ai_enabled, c.ai_daily_limit FROM users u JOIN child_settings c ON c.child_id=u.id WHERE u.id=$1`, [cid]);
    if (!s.ai_enabled) return reply.code(403).send({ error: 'ai_disabled', message: 'مامان هنوز این بخش را برایت روشن نکرده.' });
    const start = tehranInstant(todayISO(), '00:00');
    const [{ n }] = await sys(`SELECT count(*)::int n FROM kid_ai_chats WHERE child_id=$1 AND role='user' AND at >= $2`, [cid, start]);
    if (n >= s.ai_daily_limit) return reply.code(429).send({ error: 'daily_limit', message: 'امروز به اندازه‌ی کافی سؤال پرسیدی! فردا دوباره بپرس. 🌙' });
    if (flagged(question)) {
      await sys(`INSERT INTO kid_ai_chats (child_id, role, content, flagged) VALUES ($1,'user',$2,true), ($1,'assistant',$3,true)`, [cid, question, REDIRECT]);
      return { answer: REDIRECT, flagged: true };
    }
    const hist = await sys(`SELECT role, content FROM (SELECT role, content, at, id FROM kid_ai_chats WHERE child_id=$1 AND at > now() - interval '30 minutes' AND NOT flagged ORDER BY id DESC LIMIT 6) t ORDER BY id`, [cid]) as Msg[];
    const r = await askModel(s.age_group === 'young' ? 'young' : 'teen', s.display_name, [...hist, { role: 'user', content: question }]);
    if ('error' in r) {
      await sys(`INSERT INTO kid_ai_chats (child_id, role, content) VALUES ($1,'user',$2)`, [cid, question]);
      return reply.code(503).send({ error: r.error, message: r.error === 'not_configured' ? 'دستیار هوشمند هنوز فعال نشده. از مامان بخواه فعالش کند.' : 'الان نمی‌توانم جواب بدهم. کمی بعد دوباره امتحان کن.' });
    }
    await sys(`INSERT INTO kid_ai_chats (child_id, role, content) VALUES ($1,'user',$2), ($1,'assistant',$3)`, [cid, question, r.text]);
    return { answer: r.text, flagged: false, remaining: s.ai_daily_limit - n - 1 };
  });
  // Mana reads the conversations
  app.get('/api/children/:id/ai-chats', { preHandler: requirePerm('children', 1) }, async (req) => {
    const cid = zId.parse((req.params as any).id); const { flagged_only } = z.object({ flagged_only: z.enum(['1']).optional() }).parse(req.query);
    return withActor(req.actor!, async (q) => ({
      today: (await q(`SELECT count(*)::int n FROM kid_ai_chats WHERE child_id=$1 AND role='user' AND at >= $2`, [cid, tehranInstant(todayISO(), '00:00')]))[0].n,
      flagged: (await q(`SELECT count(*)::int n FROM kid_ai_chats WHERE child_id=$1 AND flagged AND role='user'`, [cid]))[0].n,
      chats: await q(`SELECT id, role, content, flagged, at FROM kid_ai_chats WHERE child_id=$1 ${flagged_only ? 'AND flagged' : ''} ORDER BY id DESC LIMIT 200`, [cid]),
    }));
  });
}
