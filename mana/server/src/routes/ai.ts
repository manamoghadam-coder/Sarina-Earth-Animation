import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { llmParse, ruleParse, type Intent } from '../ai.ts';
import { requireParent } from '../auth.ts';
import { withActor, type Q } from '../db.ts';
import { fmtJalali, jalaliMonthRange, tehranInstant, toJalali, todayISO } from '../jalali.ts';
import { decideCompletion } from '../rewards.ts';
import { fmtMoney, zId } from '../util.ts';

const intentSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('create_event'), title: z.string().min(1).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ intent: z.literal('create_transaction'), kind: z.enum(['income', 'expense']), amount: z.number().int().positive().max(1e13), category: z.string().max(60), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(300) }),
  z.object({ intent: z.literal('create_child_activity'), child: z.enum(['sarina', 'saman']), title: z.string().min(1).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).nullable(), kind: z.string().max(20) }),
  z.object({ intent: z.literal('child_done'), child: z.enum(['sarina', 'saman']), keyword: z.string().max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ intent: z.literal('create_task'), title: z.string().min(1).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }),
]);
const KINDS = ['homework', 'study', 'class', 'music', 'language', 'reading', 'chore', 'story', 'writing', 'game', 'other'];
const childName = { sarina: 'سارینا', saman: 'سامان' };

function summarize(p: z.infer<typeof intentSchema>): string {
  switch (p.intent) {
    case 'create_event': return `ثبت رویداد «${p.title}» در ${fmtJalali(p.date)} ساعت ${p.time}`;
    case 'create_transaction': return `ثبت ${p.kind === 'expense' ? 'هزینه' : 'درآمد'} ${fmtMoney(p.amount)} تومان (${p.category}) در ${fmtJalali(p.date)}`;
    case 'create_child_activity': return `ثبت «${p.title}» برای ${childName[p.child]} در ${fmtJalali(p.date)}${p.time ? ' ساعت ' + p.time : ''}`;
    case 'child_done': return `ثبت انجام «${p.keyword || 'فعالیت'}» توسط ${childName[p.child]} در ${fmtJalali(p.date)} و تأیید ستاره‌ها`;
    case 'create_task': return `ثبت کار «${p.title}»${p.date ? ' با مهلت ' + fmtJalali(p.date) : ''}`;
  }
}

async function execute(q: Q, p: z.infer<typeof intentSchema>): Promise<string> {
  switch (p.intent) {
    case 'create_event': await q(`INSERT INTO events (title,starts_at) VALUES ($1,$2)`, [p.title, tehranInstant(p.date, p.time)]); return 'رویداد ثبت شد.';
    case 'create_transaction': await q(`INSERT INTO transactions (kind,amount,category,occurred_on,note) VALUES ($1,$2,$3,$4,$5)`, [p.kind, p.amount, p.category, p.date, p.note]); return 'تراکنش ثبت شد.';
    case 'create_task': await q(`INSERT INTO tasks (title,due_date) VALUES ($1,$2)`, [p.title, p.date]); return 'کار ثبت شد.';
    case 'create_child_activity': {
      const [kid] = await q(`SELECT id FROM users WHERE username=$1 AND role='child'`, [p.child]);
      if (!kid) throw new Error('child_not_found');
      await q(`INSERT INTO activities (child_id,title,kind,on_date,start_time,notify) VALUES ($1,$2,$3,$4,$5,$5::time IS NOT NULL)`, [kid.id, p.title, KINDS.includes(p.kind) ? p.kind : 'other', p.date, p.time]);
      return `برنامه برای ${childName[p.child]} ثبت شد.`;
    }
    case 'child_done': {
      const [kid] = await q(`SELECT id FROM users WHERE username=$1 AND role='child'`, [p.child]);
      const acts = await q(`SELECT id, title FROM activities WHERE child_id=$1 AND active ORDER BY title`, [kid.id]);
      const kw = p.keyword.split(' ')[0] ?? '';
      const hit = acts.filter((a: any) => kw && a.title.includes(kw.replace(/^تمرین /, '')));
      if (hit.length !== 1) throw new Error(hit.length ? 'ambiguous_activity' : 'activity_not_found');
      await q(`INSERT INTO completions (activity_id,child_id,day) VALUES ($1,$2,$3) ON CONFLICT (activity_id,day) DO NOTHING`, [hit[0].id, kid.id, p.date]);
      const [c] = await q(`SELECT id FROM completions WHERE activity_id=$1 AND day=$2`, [hit[0].id, p.date]);
      const r = await decideCompletion(q, c.id, true);
      return r ? `انجام «${hit[0].title}» تأیید شد (${r.stars_awarded} ستاره).` : 'این مورد قبلاً بررسی شده بود.';
    }
  }
}

export default async function aiRoutes(app: FastifyInstance) {
  app.post('/api/ai/message', { preHandler: requireParent }, async (req) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    const viaLlm = await llmParse(text);
    let intent: Intent = viaLlm ?? ruleParse(text);
    const source = viaLlm ? 'claude' : 'rules';
    return withActor(req.actor!, async (q) => {
      if (intent.intent === 'unknown') return { kind: 'unknown', source, message: 'متوجه نشدم. مثال: «فردا ساعت ۱۰ جلسه دارم» یا «امروز ۸۰۰ هزار تومان خرید خانه داشتم».' };
      if (intent.intent === 'report_expenses') {     // read-only: answer immediately
        const t = toJalali(todayISO()); const { from, to } = jalaliMonthRange(t.jy, t.jm);
        const rows = await q(`SELECT category, SUM(amount)::bigint total FROM transactions WHERE kind='expense' AND occurred_on BETWEEN $1 AND $2 GROUP BY category ORDER BY total DESC`, [from, to]);
        const sum = rows.reduce((a: number, r: any) => a + r.total, 0);
        return { kind: 'answer', source, message: rows.length ? `هزینه‌های این ماه: ${fmtMoney(sum)} تومان\n` + rows.map((r: any) => `• ${r.category}: ${fmtMoney(r.total)}`).join('\n') : 'این ماه هزینه‌ای ثبت نشده است.' };
      }
      if (intent.intent === 'top_priorities') {
        const rows = await q(`SELECT title, priority, due_date FROM tasks WHERE status IN ('todo','doing') ORDER BY (due_date = $1) DESC, priority, due_date NULLS LAST LIMIT 3`, [intent.date]);
        return { kind: 'answer', source, message: rows.length ? `سه اولویت پیشنهادی برای ${fmtJalali(intent.date)}:\n` + rows.map((r: any, i: number) => `${i + 1}. ${r.title}${r.due_date ? ' (مهلت ' + fmtJalali(r.due_date) + ')' : ''}`).join('\n') : 'کار بازی ثبت نشده است.' };
      }
      const parsed = intentSchema.safeParse(intent);
      if (!parsed.success) return { kind: 'unknown', source, message: 'اطلاعات کافی برای ثبت نبود (مثلاً تاریخ یا ساعت). لطفاً دقیق‌تر بنویسید.' };
      const summary = summarize(parsed.data);
      const [p] = await q(`INSERT INTO ai_proposals (user_id,input,intent,params,summary) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [req.actor!.id, text, parsed.data.intent, parsed.data, summary]);
      return { kind: 'proposal', source, proposal_id: p.id, summary, message: `${summary}\nتأیید می‌کنید؟` };
    });
  });
  app.post('/api/ai/proposals/:id/confirm', { preHandler: requireParent }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    return withActor(req.actor!, async (q) => {
      const [p] = await q(`SELECT * FROM ai_proposals WHERE id=$1 AND status='pending' FOR UPDATE`, [id]);
      if (!p) return reply.code(409).send({ error: 'not_pending' });
      if (!approve) { await q(`UPDATE ai_proposals SET status='rejected' WHERE id=$1`, [id]); return { ok: true, message: 'لغو شد.' }; }
      const params = intentSchema.parse(p.params);           // re-validate what was stored
      try { const message = await execute(q, params); await q(`UPDATE ai_proposals SET status='confirmed' WHERE id=$1`, [id]); await q(`INSERT INTO audit_log (user_id,action,detail) VALUES ($1,'ai_confirm',$2)`, [req.actor!.id, params]); return { ok: true, message }; }
      catch (e: any) { return reply.code(422).send({ error: e.message, message: e.message === 'activity_not_found' ? 'فعالیت مرتبط پیدا نشد؛ از بخش خانواده ثبت کنید.' : e.message === 'ambiguous_activity' ? 'چند فعالیت مشابه هست؛ از بخش خانواده انتخاب کنید.' : 'خطا در ثبت.' }); }
    });
  });
}
