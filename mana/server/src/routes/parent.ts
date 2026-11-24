import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdult, requirePerm } from '../auth.ts';
import { withActor } from '../db.ts';
import { addDays, addJalaliMonth, fmtJalali, jalaliMonthRange, tehranParts, toJalali, todayISO } from '../jalali.ts';
import { crud, zDate, zId, zText, zTime } from '../util.ts';

export default async function parentRoutes(app: FastifyInstance) {
  crud(app, 'projects', 'projects', z.object({ title: zText(), description: z.string().max(2000).nullable().optional(), status: z.enum(['active', 'done', 'archived']).optional(), start_date: zDate.nullable().optional(), end_date: zDate.nullable().optional() }), 'created_at DESC', [], 'tasks');
  crud(app, 'tasks', 'tasks', z.object({
    project_id: zId.nullable().optional(), title: zText(), description: z.string().max(4000).nullable().optional(), assignee: z.string().max(60).nullable().optional(),
    start_date: zDate.nullable().optional(), due_date: zDate.nullable().optional(), due_time: zTime.nullable().optional(),
    priority: z.number().int().min(1).max(3).optional(), status: z.enum(['todo', 'doing', 'waiting', 'done', 'cancelled']).optional(),
  }), 'priority, due_date NULLS LAST', ['status', 'project_id'], 'tasks');
  crud(app, 'events', 'events', z.object({
    title: zText(), kind: z.enum(['meeting', 'family', 'birthday', 'occasion', 'other']).optional(), starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }).nullable().optional(),
    note: z.string().max(2000).nullable().optional(), remind_minutes: z.array(z.number().int().min(0).max(10080)).max(5).optional(),
  }), 'starts_at', [], 'events');
  crud(app, 'transactions', 'transactions', z.object({ kind: z.enum(['income', 'expense']), amount: z.number().int().positive().max(1e13), category: zText(60).optional(), occurred_on: zDate, note: z.string().max(500).nullable().optional() }), 'occurred_on DESC, created_at DESC', [], 'finance');
  crud(app, 'debts', 'debts', z.object({
    title: zText(), type: z.enum(['debt', 'installment', 'loan']), total_amount: z.number().int().min(0), paid_amount: z.number().int().min(0).optional(),
    installment_amount: z.number().int().positive().nullable().optional(), next_due_date: zDate.nullable().optional(), remaining_installments: z.number().int().min(0).nullable().optional(), status: z.enum(['open', 'closed']).optional(),
  }), 'next_due_date NULLS LAST', [], 'debts');
  crud(app, 'goals', 'goals', z.object({ title: zText(), horizon: z.enum(['short', 'long', 'learning']).optional(), progress: z.number().int().min(0).max(100).optional(), target_date: zDate.nullable().optional(), status: z.enum(['active', 'done', 'dropped']).optional() }), 'created_at DESC', [], 'goals');
  crud(app, 'habits', 'habits', z.object({ title: zText(), active: z.boolean().optional() }), 'title', [], 'goals');

  app.put('/api/budgets', { preHandler: requirePerm('finance', 2) }, async (req) => {
    const b = z.object({ jy: z.number().int().min(1300).max(1600), jm: z.number().int().min(1).max(12), category: zText(60), amount: z.number().int().min(0) }).strict().parse(req.body);
    return withActor(req.actor!, async (q) => (await q(`INSERT INTO budgets (jy,jm,category,amount) VALUES ($1,$2,$3,$4) ON CONFLICT (jy,jm,category) DO UPDATE SET amount = EXCLUDED.amount RETURNING *`, [b.jy, b.jm, b.category, b.amount]))[0]);
  });

  app.post('/api/tasks/:id/status', { preHandler: requirePerm('tasks', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { status } = z.object({ status: z.enum(['todo', 'doing', 'waiting', 'done', 'cancelled']) }).parse(req.body);
    const r = await withActor(req.actor!, (q) => q(`UPDATE tasks SET status=$2, done_at = CASE WHEN $2='done' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`, [id, status]));
    return r[0] ?? reply.code(404).send({ error: 'not_found' });
  });

  app.put('/api/habits/:id/log', { preHandler: requirePerm('goals', 2) }, async (req) => {
    const id = zId.parse((req.params as any).id);
    const { day, done } = z.object({ day: zDate, done: z.boolean() }).parse(req.body);
    await withActor(req.actor!, (q) => done ? q(`INSERT INTO habit_logs VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, day]) : q(`DELETE FROM habit_logs WHERE habit_id=$1 AND day=$2`, [id, day]));
    return { ok: true };
  });
  app.get('/api/habits/logs', { preHandler: requirePerm('goals', 1) }, async (req) => {
    const { from, to } = z.object({ from: zDate, to: zDate }).parse(req.query);
    return withActor(req.actor!, (q) => q(`SELECT habit_id, day FROM habit_logs WHERE day BETWEEN $1 AND $2`, [from, to]));
  });

  // pay one installment / a custom amount; records an expense and moves the due date by one Jalali month
  app.post('/api/debts/:id/pay', { preHandler: requirePerm('debts', 2) }, async (req, reply) => {
    const id = zId.parse((req.params as any).id);
    const { amount } = z.object({ amount: z.number().int().positive().optional() }).parse(req.body ?? {});
    return withActor(req.actor!, async (q) => {
      const [d] = await q(`SELECT * FROM debts WHERE id=$1 FOR UPDATE`, [id]);
      if (!d) return reply.code(404).send({ error: 'not_found' });
      if (d.status === 'closed') return reply.code(409).send({ error: 'already_closed' });
      const pay = amount ?? d.installment_amount ?? d.total_amount - d.paid_amount;
      const paid = d.paid_amount + pay;
      const remaining = d.remaining_installments != null ? Math.max(0, d.remaining_installments - 1) : null;
      const closed = paid >= d.total_amount || remaining === 0;
      await q(`UPDATE debts SET paid_amount=$2, remaining_installments=$3, next_due_date=$4, status=$5 WHERE id=$1`,
        [id, paid, remaining, closed || !d.next_due_date ? d.next_due_date : addJalaliMonth(d.next_due_date), closed ? 'closed' : 'open']);
      await q(`INSERT INTO transactions (kind,amount,category,occurred_on,note) VALUES ('expense',$1,'اقساط و بدهی',$2,$3)`, [pay, todayISO(), `پرداخت: ${d.title}`]);
      return { ok: true, paid, closed };
    });
  });

  app.get('/api/finance/summary', { preHandler: requirePerm('finance', 1) }, async (req) => {
    const t = toJalali(todayISO());
    const { jy, jm } = z.object({ jy: z.coerce.number().int().default(t.jy), jm: z.coerce.number().int().min(1).max(12).default(t.jm) }).parse(req.query);
    const { from, to } = jalaliMonthRange(jy, jm);
    return withActor(req.actor!, async (q) => {
      const byKind = await q(`SELECT kind, COALESCE(SUM(amount),0)::bigint total FROM transactions WHERE occurred_on BETWEEN $1 AND $2 GROUP BY kind`, [from, to]);
      const byCat = await q(`SELECT category, SUM(amount)::bigint total FROM transactions WHERE kind='expense' AND occurred_on BETWEEN $1 AND $2 GROUP BY category ORDER BY total DESC`, [from, to]);
      const budgets = await q(`SELECT category, amount FROM budgets WHERE jy=$1 AND jm=$2`, [jy, jm]);
      const [bal] = await q(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE -amount END),0)::bigint balance FROM transactions`);
      const dues = await q(`SELECT id,title,type,installment_amount,next_due_date,total_amount-paid_amount AS remaining FROM debts WHERE status='open' ORDER BY next_due_date NULLS LAST`);
      const sum = (k: string) => byKind.find((r: any) => r.kind === k)?.total ?? 0;
      return { jy, jm, from, to, income: sum('income'), expense: sum('expense'), net: sum('income') - sum('expense'), balance: bal.balance,
        by_category: byCat.map((c: any) => ({ ...c, budget: budgets.find((b: any) => b.category === c.category)?.amount ?? null })),
        budgets, dues };
    });
  });

  app.get('/api/dashboard', { preHandler: requireAdult }, async (req) => {
    const today = todayISO(); const now = tehranParts();
    const t = toJalali(today); const { from, to } = jalaliMonthRange(t.jy, t.jm);
    return withActor(req.actor!, async (q) => {
      const open = `status IN ('todo','doing','waiting')`;
      const important = await q(`SELECT * FROM tasks WHERE ${open} ORDER BY priority, due_date NULLS LAST LIMIT 5`);
      const todayTasks = await q(`SELECT * FROM tasks WHERE ${open} AND due_date = $1 ORDER BY priority`, [today]);
      const overdue = await q(`SELECT * FROM tasks WHERE ${open} AND due_date < $1 ORDER BY due_date`, [today]);
      const events = await q(`SELECT * FROM events WHERE starts_at >= now() - interval '2 hours' AND starts_at < now() + interval '7 days' ORDER BY starts_at LIMIT 10`);
      const dues = await q(`SELECT id,title,installment_amount,next_due_date FROM debts WHERE status='open' AND next_due_date <= $1 ORDER BY next_due_date LIMIT 5`, [addDays(today, 7)]);
      const [fin] = await q(`SELECT COALESCE(SUM(amount) FILTER (WHERE kind='income'),0)::bigint income, COALESCE(SUM(amount) FILTER (WHERE kind='expense'),0)::bigint expense FROM transactions WHERE occurred_on BETWEEN $1 AND $2`, [from, to]);
      const [bal] = await q(`SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE -amount END),0)::bigint balance FROM transactions`);
      const pending = await q(`SELECT c.id, u.display_name child, a.title FROM completions c JOIN users u ON u.id=c.child_id JOIN activities a ON a.id=c.activity_id WHERE c.status='pending' ORDER BY c.created_at`);
      const [wk] = await q(`SELECT count(*) FILTER (WHERE status='done' AND done_at >= now() - interval '7 days')::int done_7d, count(*) FILTER (WHERE ${open})::int open_now FROM tasks`);
      const [spend7] = await q(`SELECT COALESCE(SUM(amount),0)::bigint total FROM transactions WHERE kind='expense' AND occurred_on > $1`, [addDays(today, -7)]);
      const habits = await q(`SELECT h.id, h.title, EXISTS (SELECT 1 FROM habit_logs l WHERE l.habit_id=h.id AND l.day=$1) AS done FROM habits h WHERE h.active ORDER BY h.title`, [today]);
      return { today, today_fa: fmtJalali(today), time: `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`, important, todayTasks, overdue, events, dues, finance: { ...fin, balance: bal.balance }, pending_completions: pending, weekly: { tasks_done: wk.done_7d, tasks_open: wk.open_now, spend: spend7.total }, habits };
    });
  });
}
