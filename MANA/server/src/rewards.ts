import type { Q } from './db.ts';
import { addDays, todayISO } from './jalali.ts';

export const balanceOf = async (q: Q, childId: string) => (await q(`SELECT COALESCE(SUM(delta),0)::int b FROM star_ledger WHERE child_id=$1`, [childId]))[0].b as number;

/** Awards milestone badges. Called after a parent approves stars. */
export async function awardBadges(q: Q, childId: string) {
  const [{ earned }] = await q(`SELECT COALESCE(SUM(delta) FILTER (WHERE delta > 0),0)::int earned FROM star_ledger WHERE child_id=$1`, [childId]);
  const rules: [string, number, string, string][] = [['first_star', 1, 'اولین ستاره', '⭐'], ['stars_10', 10, 'ده ستاره', '🌟'], ['stars_50', 50, 'پنجاه ستاره', '🥈'], ['stars_100', 100, 'صد ستاره', '🥇'], ['stars_250', 250, 'ستاره‌ی درخشان', '🏆']];
  for (const [code, min, title, icon] of rules) if (earned >= min) await q(`INSERT INTO badges (child_id,code,title,icon) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [childId, code, title, icon]);
  const days = new Set((await q(`SELECT DISTINCT day FROM completions WHERE child_id=$1 AND status='approved' AND day > $2`, [childId, addDays(todayISO(), -10)])).map((r: any) => r.day));
  let streak = 0; for (let i = 0; i < 10 && days.has(addDays(todayISO(), -i)); i++) streak++;
  if (streak >= 7) await q(`INSERT INTO badges (child_id,code,title,icon) VALUES ($1,'streak_7','هفت روز پشت سر هم','🔥') ON CONFLICT DO NOTHING`, [childId]);
}

/** Approve (or reject) a completion and credit stars. Idempotent: only pending rows change. */
export async function decideCompletion(q: Q, id: string, approve: boolean, stars?: number) {
  const [c] = await q(`SELECT c.*, a.stars AS default_stars, a.title FROM completions c JOIN activities a ON a.id=c.activity_id WHERE c.id=$1 FOR UPDATE OF c`, [id]);
  if (!c || c.status !== 'pending') return null;
  const award = approve ? (stars ?? c.default_stars) : 0;
  await q(`UPDATE completions SET status=$2, stars_awarded=$3, decided_at=now() WHERE id=$1`, [id, approve ? 'approved' : 'rejected', award]);
  if (approve && award > 0) { await q(`INSERT INTO star_ledger (child_id,delta,reason,completion_id) VALUES ($1,$2,$3,$4)`, [c.child_id, award, `انجام: ${c.title}`, id]); await awardBadges(q, c.child_id); }
  return { ...c, status: approve ? 'approved' : 'rejected', stars_awarded: award };
}
