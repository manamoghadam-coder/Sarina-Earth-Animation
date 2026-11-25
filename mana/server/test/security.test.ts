import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { sys, sysPool, appPool, withActor } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
import { generate } from '../src/scheduler.ts';
import { tehranInstant, todayISO, persianWeekday, toJalali } from '../src/jalali.ts';

const PW = 'Test-pass-12345';
let app: Awaited<ReturnType<typeof buildApp>>;
const ids: Record<string, string> = {};
const jar: Record<string, string> = {};
const H = { 'x-requested-with': 'mana' };

async function mk(username: string, role: string) {
  const [u] = await sys(`INSERT INTO users (username,display_name,role,password_hash) VALUES ($1,$1,$2,$3) RETURNING id`, [username, role, await hashPassword(PW)]);
  if (role === 'child') await sys(`INSERT INTO child_settings (child_id) VALUES ($1)`, [u.id]);
  ids[username] = u.id;
}
async function signIn(u: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: PW } });
  assert.equal(r.statusCode, 200, r.body);
  jar[u] = `mana_session=${r.cookies[0].value}`;
}
const call = (u: string, method: any, url: string, payload?: any) => app.inject({ method, url, headers: { ...H, cookie: jar[u] }, payload });

before(async () => {
  process.env.LOGIN_RATE_MAX = '1000'; process.env.BACKUP_AUTO = 'off';
  app = await buildApp();
  await sys(`DELETE FROM users WHERE username LIKE 't\\_%'`);
  await mk('t_mom', 'parent'); await mk('t_sa', 'child'); await mk('t_sm', 'child'); await mk('t_dad', 'member');
  for (const u of ['t_mom', 't_sa', 't_sm', 't_dad']) await signIn(u);
});
after(async () => { await sys(`DELETE FROM users WHERE username LIKE 't\\_%'`); await app.close(); await sysPool.end(); await appPool.end(); });

test('unauthenticated requests are rejected', async () => {
  assert.equal((await app.inject({ url: '/api/tasks' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/me' })).statusCode, 401);
});
test('state-changing request without CSRF header is rejected', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/tasks', headers: { cookie: jar.t_mom }, payload: { title: 'x' } });
  assert.equal(r.statusCode, 403);
});
test('children cannot reach any parent-only API', async () => {
  for (const url of ['/api/tasks', '/api/transactions', '/api/debts', '/api/finance/summary', '/api/dashboard', '/api/goals', '/api/events', '/api/children', '/api/completions']) {
    assert.equal((await call('t_sa', 'GET', url)).statusCode, 403, url);
  }
  assert.equal((await call('t_sa', 'POST', '/api/ai/message', { text: 'گزارش هزینه‌ها' })).statusCode, 403);
  assert.equal((await call('t_sa', 'POST', `/api/children/${ids.t_sa}/stars`, { delta: 100, reason: 'cheat' })).statusCode, 403);
  assert.equal((await call('t_sa', 'PATCH', `/api/children/${ids.t_sa}/settings`, { notifications_enabled: false })).statusCode, 403);
});
test('DB-level RLS blocks children even if the API were bypassed', async () => {
  await sys(`INSERT INTO transactions (kind,amount,occurred_on) VALUES ('expense',1,current_date)`);
  const a = { id: ids.t_sa, role: 'child' as const };
  assert.equal((await withActor(a, (q) => q(`SELECT * FROM transactions`))).length, 0);
  assert.equal((await withActor(a, (q) => q(`SELECT * FROM tasks`))).length, 0);
  assert.equal((await withActor(a, (q) => q(`SELECT * FROM users`))).length, 1);                 // only herself
  await assert.rejects(withActor(a, (q) => q(`INSERT INTO tasks (title) VALUES ('hack')`)));
  await assert.rejects(withActor(a, (q) => q(`INSERT INTO star_ledger (child_id,delta,reason) VALUES ($1,999,'x')`, [ids.t_sa])));
  assert.equal((await withActor(a, (q) => q(`UPDATE users SET role='parent' WHERE id=$1 RETURNING id`, [ids.t_sa]))).length, 0);
  assert.equal((await withActor(a, (q) => q(`SELECT * FROM sessions`).catch(() => 'denied'))), 'denied');
  await sys(`DELETE FROM transactions WHERE amount=1`);
});
test('siblings are isolated from each other', async () => {
  const [act] = await sys(`INSERT INTO activities (child_id,title,weekdays,start_time) VALUES ($1,'secret-saman',ARRAY[0,1,2,3,4,5,6],'10:00') RETURNING id`, [ids.t_sm]);
  const sa = { id: ids.t_sa, role: 'child' as const };
  assert.equal((await withActor(sa, (q) => q(`SELECT * FROM activities WHERE child_id=$1`, [ids.t_sm]))).length, 0);
  await assert.rejects(withActor(sa, (q) => q(`INSERT INTO completions (activity_id,child_id,day) VALUES ($1,$2,current_date)`, [act.id, ids.t_sm])));
  const r = await call('t_sa', 'POST', '/api/child/complete', { activity_id: act.id });
  assert.equal(r.statusCode, 404);
  const today = JSON.parse((await call('t_sa', 'GET', `/api/child/today?child_id=${ids.t_sm}`)).body);   // child_id param must be ignored
  assert.equal(today.items.length, 0);
});
test('child completion is pending; stars only after the mother approves', async () => {
  const [act] = await sys(`INSERT INTO activities (child_id,title,weekdays,start_time,stars) VALUES ($1,'homework-x',ARRAY[0,1,2,3,4,5,6],'10:00',5) RETURNING id`, [ids.t_sa]);
  let r = await call('t_sa', 'POST', '/api/child/complete', { activity_id: act.id });
  assert.equal(JSON.parse(r.body).status, 'pending');
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/stars')).body).balance, 0);
  const pend = JSON.parse((await call('t_mom', 'GET', '/api/completions')).body);
  const c = pend.find((x: any) => x.title === 'homework-x'); assert.ok(c);
  assert.equal((await call('t_sa', 'POST', `/api/completions/${c.id}/decide`, { approve: true })).statusCode, 403);
  r = await call('t_mom', 'POST', `/api/completions/${c.id}/decide`, { approve: true });
  assert.equal(r.statusCode, 200);
  assert.equal((await call('t_mom', 'POST', `/api/completions/${c.id}/decide`, { approve: true })).statusCode, 409);   // no double award
  const s = JSON.parse((await call('t_sa', 'GET', '/api/child/stars')).body);
  assert.equal(s.balance, 5); assert.ok(s.badges.some((b: any) => b.code === 'first_star'));
});
test('photos: private to owner child and mother', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const boundary = 'xBOUNDARYx';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = await app.inject({ method: 'POST', url: `/api/users/${ids.t_sa}/photos`, headers: { ...H, cookie: jar.t_mom, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
  assert.equal(up.statusCode, 201, up.body);
  const pid = JSON.parse(up.body).id;
  assert.equal((await call('t_sa', 'GET', `/api/photos/${pid}/file`)).statusCode, 200);
  assert.equal((await call('t_mom', 'GET', `/api/photos/${pid}/file`)).statusCode, 200);
  assert.equal((await call('t_sm', 'GET', `/api/photos/${pid}/file`)).statusCode, 404);
  assert.equal((await call('t_sm', 'GET', `/api/photos?owner_id=${ids.t_sa}`)).body.includes(pid), false);
  assert.equal((await call('t_sa', 'DELETE', `/api/photos/${pid}`)).statusCode, 403);
  const bad = await app.inject({ method: 'POST', url: `/api/users/${ids.t_sa}/photos`, headers: { ...H, cookie: jar.t_mom, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n<?php evil ?>\r\n--${boundary}--\r\n`)]) });
  assert.equal(bad.statusCode, 415);
  assert.equal((await call('t_mom', 'DELETE', `/api/photos/${pid}`)).statusCode, 200);
});
test('login: wrong password rejected, lockout after repeated failures', async () => {
  await mk('t_lock', 'child');
  for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_lock', password: 'nope' } })).statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_lock', password: PW } });
  assert.equal(r.statusCode, 429);
});
test('finance flow: transaction, installment payment moves due date', async () => {
  const d = JSON.parse((await call('t_mom', 'POST', '/api/debts', { title: 't-debt', type: 'installment', total_amount: 3000000, installment_amount: 1000000, next_due_date: '2026-12-01', remaining_installments: 3 })).body);
  const p = await call('t_mom', 'POST', `/api/debts/${d.id}/pay`, {});
  assert.equal(p.statusCode, 200);
  const after = (await sys(`SELECT * FROM debts WHERE id=$1`, [d.id]))[0];
  assert.equal(after.remaining_installments, 2); assert.equal(after.paid_amount, 1000000); assert.equal(after.next_due_date, '2026-12-31');   // 10 Azar 1405 -> 10 Dey 1405
  await sys(`DELETE FROM debts WHERE id=$1`, [d.id]); await sys(`DELETE FROM transactions WHERE note='پرداخت: t-debt'`);
});
test('AI: parses Persian requests and never writes before confirmation', async () => {
  const cnt = async () => (await sys(`SELECT count(*)::int n FROM events WHERE title='جلسه' AND starts_at > now()`))[0].n;
  const before = await cnt();
  const r = JSON.parse((await call('t_mom', 'POST', '/api/ai/message', { text: 'فردا ساعت ۱۰ جلسه دارم.' })).body);
  assert.equal(r.kind, 'proposal'); assert.match(r.summary, /ساعت ۱۰:۰۰/);
  assert.equal(await cnt(), before);             // nothing written before confirmation
  assert.equal((await call('t_mom', 'POST', `/api/ai/proposals/${r.proposal_id}/confirm`, { approve: true })).statusCode, 200);
  assert.equal(await cnt(), before + 1);
  await sys(`DELETE FROM events WHERE title='جلسه'`);
  const e = JSON.parse((await call('t_mom', 'POST', '/api/ai/message', { text: 'امروز ۸۰۰ هزار تومان خرید خانه داشتم.' })).body);
  assert.equal(e.kind, 'proposal');
  assert.equal((await sys(`SELECT params FROM ai_proposals WHERE id=$1`, [e.proposal_id]))[0].params.amount, 800000);
});
test('scheduler: creates reminders once (deduplicated) at offsets, respects quiet hours', async () => {
  const day = todayISO(); const wd = persianWeekday(day);
  await sys(`UPDATE child_settings SET quiet_start='00:00', quiet_end='00:00' WHERE child_id=$1`, [ids.t_sa]);   // quiet window empty (start=end)
  const [a] = await sys(`INSERT INTO activities (child_id,title,weekdays,start_time) VALUES ($1,'sched-x',ARRAY[$2::int],'17:00') RETURNING id`, [ids.t_sa, wd]);
  const now = tehranInstant(day, '17:02');
  await generate(now); await generate(now);
  const rows = await sys(`SELECT dedupe_key FROM notifications WHERE ref_id=$1`, [a.id]);
  assert.equal(rows.length, 1);                                  // -15 min is outside the 10-min grace window; 0 is due; no duplicates
  assert.ok(rows[0].dedupe_key.endsWith(':0'));
  await generate(tehranInstant(day, '17:12'));
  const later = await sys(`SELECT dedupe_key FROM notifications WHERE ref_id=$1`, [a.id]);
  assert.ok(later.some((r: any) => r.dedupe_key.endsWith(':10')));   // "not done yet" nudge
  await sys(`INSERT INTO completions (activity_id,child_id,day) VALUES ($1,$2,$3)`, [a.id, ids.t_sa, day]);
  await sys(`DELETE FROM notifications WHERE ref_id=$1 AND dedupe_key LIKE '%:10'`, [a.id]);
  await generate(tehranInstant(day, '17:12'));
  assert.equal((await sys(`SELECT 1 FROM notifications WHERE ref_id=$1 AND dedupe_key LIKE '%:10'`, [a.id])).length, 0);   // no nudge once reported
});

test('member (father): no access by default, Mana grants per module, enforced in API and DB', async () => {
  await sys(`INSERT INTO transactions (kind,amount,occurred_on,note) VALUES ('expense',7,current_date,'dad-test')`);
  for (const url of ['/api/tasks', '/api/transactions', '/api/finance/summary', '/api/goals', '/api/events', '/api/children', '/api/completions', '/api/members'])
    assert.equal((await call('t_dad', 'GET', url)).statusCode, 403, url);
  assert.equal((await call('t_dad', 'POST', '/api/ai/message', { text: 'x' })).statusCode, 403);
  const dad = { id: ids.t_dad, role: 'member' as const };
  assert.equal((await withActor(dad, (q) => q(`SELECT * FROM transactions`))).length, 0);          // RLS, not just API
  await assert.rejects(withActor(dad, (q) => q(`INSERT INTO tasks (title) VALUES ('x')`)));
  // the member cannot grant himself anything
  assert.equal((await call('t_dad', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { finance: 2 } })).statusCode, 403);
  assert.equal((await withActor(dad, (q) => q(`UPDATE users SET permissions='{"finance":2}' WHERE id=$1 RETURNING id`, [ids.t_dad]))).length, 0);
  // Mana grants read on tasks, write on events
  const g = await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { tasks: 1, events: 2 } });
  assert.equal(g.statusCode, 200, g.body);
  assert.equal((await call('t_dad', 'GET', '/api/tasks')).statusCode, 200);
  assert.equal((await call('t_dad', 'POST', '/api/tasks', { title: 'nope' })).statusCode, 403);
  await assert.rejects(withActor(dad, (q) => q(`INSERT INTO tasks (title) VALUES ('x')`)));        // DB blocks read-only writes
  assert.equal((await call('t_dad', 'POST', '/api/events', { title: 'dad-event', starts_at: '2030-01-01T10:00:00+03:30' })).statusCode, 201);
  assert.equal((await call('t_dad', 'GET', '/api/transactions')).statusCode, 403);                  // finance still closed
  assert.equal((await withActor(dad, (q) => q(`SELECT * FROM transactions`))).length, 0);
  assert.equal(JSON.parse((await call('t_dad', 'GET', '/api/me')).body).permissions.events, 2);
  // children module is separate; granting it exposes both kids but never the other private modules
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { children: 1 } });
  assert.equal(JSON.parse((await call('t_dad', 'GET', '/api/children')).body).length >= 2, true);
  assert.equal((await call('t_dad', 'POST', `/api/children/${ids.t_sa}/stars`, { delta: 5, reason: 'x' })).statusCode, 403);
  assert.equal((await call('t_dad', 'GET', '/api/finance/summary')).statusCode, 403);
  // deactivating closes the session
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { active: false });
  assert.equal((await call('t_dad', 'GET', '/api/me')).statusCode, 401);
  await sys(`DELETE FROM transactions WHERE note='dad-test'`); await sys(`DELETE FROM events WHERE title='dad-event'`);
});

test('routines/medicine: Mana configures, child sees only own and logs; reminders fire (medicine ignores quiet hours) and "done" logs', async () => {
  await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]);
  const mk1 = await call('t_mom', 'POST', '/api/routines', { child_id: ids.t_sa, kind: 'medicine', title: 'شربت تقویتی', dose: '۵ میلی‌لیتر', times: ['09:00'], icon: '💊' });
  assert.equal(mk1.statusCode, 201, mk1.body);
  const rt = JSON.parse(mk1.body);
  await call('t_mom', 'POST', '/api/routines', { child_id: ids.t_sm, title: 'secret-habit', times: ['08:00'] });
  const mine = JSON.parse((await call('t_sa', 'GET', '/api/child/routines')).body);
  assert.ok(mine.some((r: any) => r.title === 'شربت تقویتی') && !mine.some((r: any) => r.title === 'secret-habit'));
  assert.equal((await call('t_sa', 'POST', '/api/routines', { child_id: ids.t_sa, title: 'x' })).statusCode, 403);       // children cannot define routines
  assert.equal((await call('t_sa', 'POST', `/api/child/routines/${(await sys(`SELECT id FROM routines WHERE title='secret-habit'`))[0].id}/log`, {})).statusCode, 404);
  await sys(`UPDATE child_settings SET quiet_start='00:00', quiet_end='23:59' WHERE child_id=$1`, [ids.t_sa]);          // quiet all day
  const day = todayISO();
  await generate(tehranInstant(day, '09:01'));
  const n = await sys(`SELECT id, ref_slot FROM notifications WHERE ref_id=$1`, [rt.id]);
  assert.equal(n.length, 1); assert.equal(n[0].ref_slot, '09:00');
  assert.equal((await call('t_sa', 'POST', `/api/notifications/${n[0].id}/done`, {})).statusCode, 200);
  assert.equal((await sys(`SELECT 1 FROM routine_logs WHERE routine_id=$1 AND slot='09:00'`, [rt.id])).length, 1);
  const after = JSON.parse((await call('t_sa', 'GET', '/api/child/routines')).body).find((r: any) => r.id === rt.id);
  assert.equal(after.slots[0].done, true);
});
test('purchase requests, suggestions: child can only create own; Mana decides; sibling cannot see', async () => {
  const r = await call('t_sa', 'POST', '/api/child/requests', { category: 'school', title: 'دفتر نقاشی' }); assert.equal(r.statusCode, 201);
  const id = JSON.parse(r.body).id;
  await assert.rejects(withActor({ id: ids.t_sa, role: 'child' }, (q) => q(`INSERT INTO purchase_requests (child_id,title,status) VALUES ($1,'x','approved')`, [ids.t_sa])));   // cannot self-approve
  await assert.rejects(withActor({ id: ids.t_sa, role: 'child' }, (q) => q(`INSERT INTO purchase_requests (child_id,title) VALUES ($1,'x')`, [ids.t_sm])));     // not for sibling
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/child/requests')).body).length, 0);
  assert.equal((await call('t_sa', 'POST', `/api/purchase-requests/${id}/decide`, { status: 'approved' })).statusCode, 403);
  assert.equal((await call('t_mom', 'POST', `/api/purchase-requests/${id}/decide`, { status: 'approved', mom_note: 'فردا' })).statusCode, 200);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/requests')).body)[0].status, 'approved');
  assert.equal((await call('t_sm', 'POST', '/api/child/suggestions', { kind: 'food', text: 'پیتزا' })).statusCode, 201);
  assert.equal(JSON.parse((await call('t_mom', 'GET', '/api/suggestions')).body).some((s: any) => s.text === 'پیتزا'), true);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/suggestions')).body).length, 0);
});
test('occasions: Mana adds birthdays; children see only all/kids; upcoming computes Jalali dates and age; quote of the day by age group', async () => {
  const { jy, jm, jd } = toJalali(todayISO());
  const b = await call('t_mom', 'POST', '/api/occasions', { title: 'تولد-تست', kind: 'birthday', jm, jd, birth_jy: jy - 7, audience: 'all' }); assert.equal(b.statusCode, 201, b.body);
  await call('t_mom', 'POST', '/api/occasions', { title: 'فقط-بزرگ‌ترها', jm, jd, audience: 'adults' });
  const up = JSON.parse((await call('t_sa', 'GET', '/api/occasions/upcoming?days=5')).body);
  const bd = up.find((o: any) => o.title === 'تولد-تست'); assert.ok(bd); assert.equal(bd.days_left, 0); assert.equal(bd.age, 7);
  assert.ok(!up.some((o: any) => o.title === 'فقط-بزرگ‌ترها'));
  assert.equal((await call('t_sa', 'POST', '/api/occasions', { title: 'x', jm: 1, jd: 1 })).statusCode, 403);
  const q1 = JSON.parse((await call('t_sa', 'GET', '/api/quote/today')).body); assert.ok(q1.text);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/quote/today')).body).text, q1.text);   // stable within a day
  await sys(`DELETE FROM occasions WHERE title IN ('تولد-تست','فقط-بزرگ‌ترها')`);
});
test('member: finance and debts are separate permissions', async () => {
  await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]); await signIn('t_dad');
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { finance: 0, debts: 0 } });
  assert.equal((await call('t_dad', 'GET', '/api/debts')).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { debts: 1 } });
  assert.equal((await call('t_dad', 'GET', '/api/debts')).statusCode, 200);
  assert.equal((await call('t_dad', 'GET', '/api/transactions')).statusCode, 403);
});

test('facts, lessons (answer never leaked; stars once), wallet & savings jar (child cannot mint money)', async () => {
  await sys(`UPDATE users SET age_group='teen' WHERE id=$1`, [ids.t_sa]);
  const f = JSON.parse((await call('t_sa', 'GET', '/api/facts/today')).body); assert.ok(f.today?.body); assert.equal(f.recent.length, 6);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/facts/today')).body).today.id, f.today.id);          // stable all day
  const list = JSON.parse((await call('t_sa', 'GET', '/api/child/lessons')).body); assert.ok(list.length >= 8);
  const les = JSON.parse((await call('t_sa', 'GET', `/api/child/lessons/${list[0].id}`)).body);
  assert.equal('correct' in les, false); assert.ok(les.options.length >= 2);
  const real = (await sys(`SELECT correct FROM lessons WHERE id=$1`, [list[0].id]))[0].correct;
  const wrong = les.options.find((o: any) => o.i !== real).i;
  assert.equal(JSON.parse((await call('t_sa', 'POST', `/api/child/lessons/${list[0].id}/answer`, { i: wrong })).body).correct, false);
  const ok1 = JSON.parse((await call('t_sa', 'POST', `/api/child/lessons/${list[0].id}/answer`, { i: real })).body); assert.equal(ok1.correct, true); assert.ok(ok1.stars_awarded > 0);
  assert.equal(JSON.parse((await call('t_sa', 'POST', `/api/child/lessons/${list[0].id}/answer`, { i: real })).body).stars_awarded, 0);   // no double stars
  // wallet
  assert.equal((await call('t_sa', 'POST', `/api/children/${ids.t_sa}/wallet`, { delta: 1000, reason: 'cheat' })).statusCode, 403);
  await assert.rejects(withActor({ id: ids.t_sa, role: 'child' }, (q) => q(`INSERT INTO wallet_ledger (child_id,delta,reason) VALUES ($1,99999,'x')`, [ids.t_sa])));
  assert.equal((await call('t_mom', 'POST', `/api/children/${ids.t_sa}/wallet`, { delta: 50000, reason: 'عیدی' })).statusCode, 200);
  const g = JSON.parse((await call('t_mom', 'POST', `/api/children/${ids.t_sa}/goals`, { title: 'دوچرخه', target_amount: 200000 })).body);
  assert.equal((await call('t_sa', 'POST', '/api/child/wallet/save', { goal_id: g.id, amount: 60000 })).statusCode, 409);            // more than balance
  assert.equal((await call('t_sa', 'POST', '/api/child/wallet/save', { goal_id: g.id, amount: 20000 })).statusCode, 200);
  assert.equal((await call('t_sm', 'POST', '/api/child/wallet/save', { goal_id: g.id, amount: 1 })).statusCode, 404);               // sibling's jar
  assert.equal((await call('t_sa', 'POST', '/api/child/wallet/spend', { amount: 5000, note: 'بستنی' })).statusCode, 200);
  const w = JSON.parse((await call('t_sa', 'GET', '/api/child/wallet')).body); assert.equal(w.balance, 25000); assert.equal(Number(w.goals[0].saved), 20000);
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/child/wallet')).body).goals.length, 0);
  await call('t_mom', 'DELETE', `/api/savings-goals/${g.id}`);                                                                      // refund jar
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/wallet')).body).balance, 45000);
  // weekly allowance is idempotent
  await call('t_mom', 'PATCH', `/api/children/${ids.t_sa}/settings`, { allowance_amount: 10000, allowance_weekday: persianWeekday(todayISO()) });
  await generate(tehranInstant(todayISO(), '09:00')); await generate(tehranInstant(todayISO(), '09:05'));
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/wallet')).body).balance, 55000);
});

function multipart(fields: Record<string, string>, filename: string, content: Buffer) {
  const b = 'xLIBx'; const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`));
  return { payload: Buffer.concat(parts), 'content-type': `multipart/form-data; boundary=${b}` };
}
const upload = (u: string, url: string, fields: Record<string, string>, filename: string, content: Buffer) => { const m = multipart(fields, filename, content); return app.inject({ method: 'POST', url, headers: { ...H, cookie: jar[u], 'content-type': m['content-type'] }, payload: m.payload }); };

test('library: PDF/audio upload by magic bytes, audience filter, Range streaming, permissions', async () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 65)]); const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 1)]);
  assert.equal((await upload('t_sa', '/api/library', { title: 'x' }, 'a.pdf', pdf)).statusCode, 403);                      // child cannot upload
  assert.equal((await upload('t_mom', '/api/library', { title: 'evil' }, 'a.pdf', Buffer.from('MZ\x90\x00 not a pdf'))).statusCode, 415);   // disguised file
  const a = await upload('t_mom', '/api/library', { title: 'قصه‌ی شب', category: 'story', audience: 'young' }, 'x.mp3', mp3); assert.equal(a.statusCode, 201, a.body);
  const b = await upload('t_mom', '/api/library', { title: 'کتاب نوجوان', category: 'book', audience: 'teen' }, 'y.pdf', pdf); assert.equal(b.statusCode, 201);
  const c = await upload('t_mom', '/api/library', { title: 'فقط بزرگ‌ترها', audience: 'adults' }, 'z.pdf', pdf); assert.equal(c.statusCode, 201);
  const [idA, idB, idC] = [a, b, c].map((r) => JSON.parse(r.body).id);
  await sys(`UPDATE users SET age_group='young' WHERE id=$1`, [ids.t_sm]); await sys(`UPDATE users SET age_group='teen' WHERE id=$1`, [ids.t_sa]);
  const kidSm = JSON.parse((await call('t_sm', 'GET', '/api/library')).body).map((x: any) => x.title);
  assert.ok(kidSm.includes('قصه‌ی شب') && !kidSm.includes('کتاب نوجوان') && !kidSm.includes('فقط بزرگ‌ترها'));
  assert.equal((await call('t_sm', 'GET', `/api/library/${idB}/file`)).statusCode, 404);                                   // other age group's file
  assert.equal((await call('t_sa', 'GET', `/api/library/${idC}/file`)).statusCode, 404);
  const full = await call('t_sm', 'GET', `/api/library/${idA}/file`); assert.equal(full.statusCode, 200); assert.equal(full.headers['content-type'], 'audio/mpeg');
  const part = await app.inject({ method: 'GET', url: `/api/library/${idA}/file`, headers: { ...H, cookie: jar.t_sm, range: 'bytes=10-19' } });
  assert.equal(part.statusCode, 206); assert.equal(part.headers['content-range'], 'bytes 10-19/4003'); assert.equal(part.rawPayload.length, 10);
  assert.equal((await call('t_dad', 'GET', '/api/library')).statusCode === 200 ? JSON.parse((await call('t_dad', 'GET', '/api/library')).body).length : 0, 0);   // member without "library" sees nothing
  await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]); await signIn('t_dad');
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { library: 1 } });
  assert.equal(JSON.parse((await call('t_dad', 'GET', '/api/library')).body).length, 3);
  assert.equal((await call('t_dad', 'DELETE', `/api/library/${idA}`)).statusCode, 403);
  for (const id of [idA, idB, idC]) assert.equal((await call('t_mom', 'DELETE', `/api/library/${id}`)).statusCode, 200);
});
test('recipes: categories, photo + video upload, family read, member needs permission', async () => {
  const cats = JSON.parse((await call('t_mom', 'GET', '/api/recipe-categories')).body); assert.ok(cats.length >= 8 && cats.some((c: any) => c.name === 'دسر'));
  const r = await call('t_mom', 'POST', '/api/recipes', { category_id: cats[0].id, title: 'قورمه‌سبزی-تست', ingredients: 'سبزی\nلوبیا', steps: '۱. سرخ کنید', minutes: 90, servings: 4, video_url: 'https://example.com/v' }); assert.equal(r.statusCode, 201, r.body);
  const id = JSON.parse(r.body).id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(3000, 2)]);
  assert.equal((await upload('t_mom', `/api/recipes/${id}/media`, {}, 'a.png', png)).statusCode, 201);
  const v = await upload('t_mom', `/api/recipes/${id}/media`, {}, 'a.mp4', mp4); assert.equal(v.statusCode, 201); const vid = JSON.parse(v.body).id;
  assert.equal((await upload('t_mom', `/api/recipes/${id}/media`, {}, 'a.exe', Buffer.from('MZ....'))).statusCode, 415);
  const det = JSON.parse((await call('t_sm', 'GET', `/api/recipes/${id}`)).body); assert.equal(det.media.length, 2); assert.equal(det.title, 'قورمه‌سبزی-تست');   // children can read
  assert.equal((await call('t_sm', 'GET', `/api/recipe-media/${vid}/file`)).headers['content-type'], 'video/mp4');
  assert.equal((await call('t_sm', 'POST', '/api/recipes', { title: 'x' })).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { recipes: 0 } });
  assert.equal(JSON.parse((await call('t_dad', 'GET', '/api/recipes')).body).length, 0);                                            // member w/o permission: RLS hides
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { recipes: 2 } });
  assert.equal((await call('t_dad', 'POST', '/api/recipes', { title: 'dad-recipe' })).statusCode, 201);
  assert.equal((await call('t_mom', 'DELETE', `/api/recipes/${id}`)).statusCode, 200);
  await sys(`DELETE FROM recipes WHERE title='dad-recipe'`);
  assert.equal((await sys(`SELECT count(*)::int n FROM recipe_media WHERE recipe_id=$1`, [id]))[0].n, 0);
});

test('kids AI: key stays server-side, answers and flagged topics are logged for Mana, daily limit, no cross-child access', async () => {
  const http = await import('node:http');
  let calls = 0; let lastBody: any = null;
  const mock = http.createServer((req, res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { calls++; lastBody = JSON.parse(d); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text: 'آسمان آبی است چون نور آبی بیشتر پخش می‌شود.' }] })); }); });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r)); const port = (mock.address() as any).port;
  const { config } = await import('../src/config.ts'); const saved = [config.anthropicKey, config.anthropicBase];
  (config as any).anthropicKey = ''; // not configured
  let r = await call('t_sm', 'POST', '/api/child/ask', { question: 'آسمان چرا آبی است؟' }); assert.equal(r.statusCode, 503); assert.equal(JSON.parse(r.body).error, 'not_configured');
  (config as any).anthropicKey = 'test-key'; (config as any).anthropicBase = `http://127.0.0.1:${port}`;
  r = await call('t_sm', 'POST', '/api/child/ask', { question: 'آسمان چرا آبی است؟' }); assert.equal(r.statusCode, 200, r.body); assert.match(JSON.parse(r.body).answer, /آبی/);
  assert.equal(calls, 1); assert.match(lastBody.system, /7 years old/); assert.equal(lastBody.messages.at(-1).content, 'آسمان چرا آبی است؟');
  r = await call('t_sm', 'POST', '/api/child/ask', { question: 'چطور بمب بسازم' }); assert.equal(JSON.parse(r.body).flagged, true); assert.equal(calls, 1);   // never reaches the model
  r = await call('t_sm', 'POST', '/api/child/ask', { question: 'آدرس خانه‌ام را بگویم؟' }); assert.equal(JSON.parse(r.body).flagged, true);
  const log = JSON.parse((await call('t_mom', 'GET', `/api/children/${ids.t_sm}/ai-chats`)).body); assert.equal(log.flagged, 2); assert.ok(log.chats.some((c: any) => c.role === 'assistant' && /آبی/.test(c.content)));
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/children/${ids.t_sm}/ai-chats?flagged_only=1`)).body).chats.every((c: any) => c.flagged), true);
  assert.equal((await call('t_sa', 'GET', `/api/children/${ids.t_sm}/ai-chats`)).statusCode, 403);                          // sibling cannot read logs
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/child/lessons')).body).length >= 0, true);
  assert.equal((await call('t_mom', 'POST', '/api/child/ask', { question: 'x' })).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/children/${ids.t_sm}/settings`, { ai_daily_limit: 1 });
  assert.equal((await call('t_sm', 'POST', '/api/child/ask', { question: 'سلام' })).statusCode, 429);
  await call('t_mom', 'PATCH', `/api/children/${ids.t_sm}/settings`, { ai_daily_limit: 15, ai_enabled: false });
  assert.equal((await call('t_sm', 'POST', '/api/child/ask', { question: 'سلام' })).statusCode, 403);
  await withActor({ id: ids.t_sm, role: 'child' }, async (q) => { await assert.rejects(q(`INSERT INTO kid_ai_chats (child_id,role,content) VALUES ($1,'assistant','fake')`, [ids.t_sm])); });   // child cannot forge log entries
  (config as any).anthropicKey = saved[0]; (config as any).anthropicBase = saved[1]; mock.close();
});

test('account management and TOTP two-factor (Mana only)', async () => {
  const { code } = await import('../src/totp.ts');
  assert.equal((await call('t_dad', 'POST', '/api/users', { username: 't_new', display_name: 'x', role: 'member', password: 'longpassword1' })).statusCode, 403);
  assert.equal((await call('t_sa', 'GET', '/api/users')).statusCode, 403);
  const c = await call('t_mom', 'POST', '/api/users', { username: 't_kid3', display_name: 'بچه', role: 'child', age_group: 'young', password: 'longpassword1' }); assert.equal(c.statusCode, 201, c.body);
  assert.equal((await sys(`SELECT count(*)::int n FROM child_settings WHERE child_id=$1`, [JSON.parse(c.body).id]))[0].n, 1);
  assert.equal((await call('t_mom', 'POST', '/api/users', { username: 'T BAD', display_name: 'x', role: 'member', password: 'longpassword1' })).statusCode, 400);
  assert.equal((await call('t_mom', 'PATCH', `/api/users/${ids.t_mom}`, { active: false })).statusCode, 409);                          // cannot lock yourself out
  // 2FA
  const su = JSON.parse((await call('t_mom', 'POST', '/api/auth/2fa/setup', {})).body); assert.match(su.uri, /^otpauth:\/\/totp\//); assert.match(su.secret, /^[A-Z2-7]{32}$/);
  assert.equal((await call('t_mom', 'POST', '/api/auth/2fa/enable', { code: '000000' })).statusCode, 400);
  assert.equal((await call('t_mom', 'POST', '/api/auth/2fa/enable', { code: code(su.secret) })).statusCode, 200);
  const login = (extra: any = {}) => app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_mom', password: PW, ...extra } });
  assert.equal((await login()).statusCode, 401); assert.equal(JSON.parse((await login()).body).error, 'totp_required');
  assert.equal((await login({ totp: '123456' })).statusCode, 401);
  const good = await login({ totp: code(su.secret) }); assert.equal(good.statusCode, 200);
  assert.equal((await call('t_mom', 'POST', '/api/auth/2fa/disable', { password: PW, code: code(su.secret) })).statusCode, 200);
  assert.equal((await login()).statusCode, 200);
  await sys(`DELETE FROM users WHERE username='t_kid3'`);
});
test('backups: no duplicates when nothing changed; only changed parts are backed up; permissions', async () => {
  assert.equal((await call('t_sa', 'POST', '/api/backups/run', {})).statusCode, 403);
  assert.equal((await call('t_dad', 'GET', '/api/backups')).statusCode, 403);
  await new Promise((r) => setTimeout(r, 1600));                                                    // let pg statistics settle
  const r1 = JSON.parse((await call('t_mom', 'POST', '/api/backups/run?force=1', {})).body); assert.ok(r1.db && r1.files);
  const r2 = JSON.parse((await call('t_mom', 'POST', '/api/backups/run', {})).body); assert.deepEqual(r2.skipped.sort(), ['db', 'files']); assert.equal(r2.db, null);   // identical data => no new backup
  await sys(`INSERT INTO settings (key,value) VALUES ('zz_probe','1') ON CONFLICT DO NOTHING`); await sys(`DELETE FROM settings WHERE key='zz_probe'`);
  await new Promise((r) => setTimeout(r, 1600));
  const r3 = JSON.parse((await call('t_mom', 'POST', '/api/backups/run', {})).body); assert.ok(r3.db); assert.deepEqual(r3.skipped, ['files']);                          // data changed, files did not
  const st = JSON.parse((await call('t_mom', 'GET', '/api/backups')).body); assert.ok(st.items.some((b: any) => b.name === r1.db && b.bytes > 1000)); assert.equal(st.intervalHours, 24);
  assert.equal((await call('t_mom', 'PUT', '/api/backups/settings', { interval_hours: 12, keep: 5 })).statusCode, 200);
  assert.equal(JSON.parse((await call('t_mom', 'GET', '/api/backups')).body).intervalHours, 12);
  await sys(`DELETE FROM settings WHERE key IN ('backup_interval_hours','backup_keep')`);
  const dl = await call('t_mom', 'GET', `/api/backups/${r1.db}`); assert.equal(dl.statusCode, 200); assert.equal(dl.rawPayload.subarray(0, 5).toString(), 'PGDMP');
  assert.equal((await call('t_mom', 'GET', '/api/backups/..%2F..%2Fetc%2Fpasswd')).statusCode, 400);
});
test('progressive lockout doubles the lock time (protects short PINs)', async () => {
  await mk('t_pin', 'child'); await sys(`UPDATE users SET password_hash=$1 WHERE username='t_pin'`, [await hashPassword('1399')]);
  const [{ id }] = await sys(`SELECT id FROM users WHERE username='t_pin'`);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_pin', password: '1399' } })).statusCode, 200);   // short PIN works when correct
  await sys(`UPDATE users SET failed_logins=9, locked_until=NULL WHERE id=$1`, [id]);
  await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_pin', password: 'wrong' } });
  const [u] = await sys(`SELECT extract(epoch FROM (locked_until - now()))/60 AS mins FROM users WHERE id=$1`, [id]); assert.ok(u.mins > 18 && u.mins <= 20.1, String(u.mins));   // 10th failure => 20 min
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_pin', password: '1399' } })).statusCode, 429);          // even the right PIN is refused while locked
});
test('messenger: Bale by default, Telegram switchable; link by one-time code; notifications delivered; commands respect permissions', async () => {
  const http = await import('node:http'); const sent: { path: string; body: any }[] = [];
  const mock = http.createServer((req, res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { sent.push({ path: req.url!, body: JSON.parse(d || '{}') }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: {} })); }); });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${(mock.address() as any).port}`;
  const { config } = await import('../src/config.ts'); const { handleMessage } = await import('../src/messenger.ts'); const { deliver } = await import('../src/scheduler.ts');
  const saved = { p: config.messengerProviders, bt: config.baleToken, bb: config.baleBase, tt: config.telegramToken, tb: config.telegramBase };
  Object.assign(config, { messengerProviders: ['bale'], baleToken: 'BT', baleBase: base, telegramToken: '', telegramBase: base });
  const st = JSON.parse((await call('t_mom', 'GET', '/api/messenger/status')).body); assert.equal(st.providers.find((p: any) => p.provider === 'bale').active, true); assert.equal(st.providers.find((p: any) => p.provider === 'telegram').active, false);
  assert.equal((await call('t_mom', 'POST', '/api/messenger/link-code', { provider: 'telegram' })).statusCode, 409);               // Telegram not enabled yet
  assert.equal((await call('t_sa', 'POST', '/api/messenger/link-code', { provider: 'bale' })).statusCode, 403);                  // children never get a bot link
  assert.match((await handleMessage('bale', 'chatX', '/today'))!, /به هیچ حسابی متصل نیست/);                                       // unlinked chat gets nothing private
  assert.match((await handleMessage('bale', 'chatX', '/start BADCODE1'))!, /معتبر نیست/);
  const { code } = JSON.parse((await call('t_mom', 'POST', '/api/messenger/link-code', { provider: 'bale' })).body);
  assert.match((await handleMessage('bale', 'chat-mom', `/start ${code}`))!, /اتصال انجام شد/);
  assert.match((await handleMessage('bale', 'chat-other', `/start ${code}`))!, /معتبر نیست/);                                       // code is one-time
  assert.match((await handleMessage('bale', 'chat-mom', '/today'))!, /📅/);
  await handleMessage('bale', 'chat-mom', '/add شیر'); assert.match((await handleMessage('bale', 'chat-mom', '/list'))!, /شیر/);
  // delivery through the messenger channel
  await sys(`INSERT INTO notifications (user_id,kind,title,body,icon,due_at,dedupe_key) VALUES ($1,'test','عنوان-تست','متن-تست','🔔', now() - interval '1 minute','msgtest:'||gen_random_uuid())`, [ids.t_mom]);
  await deliver(); const m = sent.find((x) => x.path.endsWith('/sendMessage') && /عنوان-تست/.test(x.body.text)); assert.ok(m); assert.equal(m!.body.chat_id, 'chat-mom'); assert.ok(m!.path.startsWith('/botBT/'));
  assert.equal((await sys(`SELECT msg_status FROM notifications WHERE title='عنوان-تست'`))[0].msg_status, 'bale:ok');
  // switch to Telegram only: Bale link stays stored but is not used; Telegram can be linked
  Object.assign(config, { messengerProviders: ['telegram'], telegramToken: 'TT' });
  const c2 = JSON.parse((await call('t_mom', 'POST', '/api/messenger/link-code', { provider: 'telegram' })).body); assert.match((await handleMessage('telegram', 'tg-1', `/start ${c2.code}`))!, /تلگرام/);
  sent.length = 0; await sys(`INSERT INTO notifications (user_id,kind,title,body,icon,due_at,dedupe_key) VALUES ($1,'test','عنوان-۲','x','🔔', now() - interval '1 minute','msgtest:'||gen_random_uuid())`, [ids.t_mom]); await deliver();
  assert.ok(sent.every((x) => x.path.startsWith('/botTT/')) && sent.some((x) => x.body.chat_id === 'tg-1'));
  // a member without the shopping permission cannot use the shopping commands
  await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]); await signIn('t_dad');
  const dc = JSON.parse((await call('t_dad', 'POST', '/api/messenger/link-code', { provider: 'telegram' })).body); await handleMessage('telegram', 'tg-dad', `/start ${dc.code}`);
  assert.match((await handleMessage('telegram', 'tg-dad', '/list'))!, /دسترسی ندارید/); assert.match((await handleMessage('telegram', 'tg-dad', '/add چیزی'))!, /اجازه/);
  assert.match((await handleMessage('telegram', 'tg-dad', '/unlink'))!, /قطع شد/);
  await sys(`DELETE FROM shopping_items WHERE title='شیر'`); await sys(`DELETE FROM notifications WHERE kind='test'`);
  Object.assign(config, { messengerProviders: saved.p, baleToken: saved.bt, baleBase: saved.bb, telegramToken: saved.tt, telegramBase: saved.tb }); mock.close();
});
test('shopping list, health reminders and task attachments obey permissions', async () => {
  await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]); await signIn('t_dad'); await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { shopping: 0, health: 0, tasks: 0 } });
  for (const u of ['/api/shopping', '/api/health-records']) assert.equal((await call('t_dad', 'GET', u)).statusCode, 403);
  // shopping
  const it = JSON.parse((await call('t_mom', 'POST', '/api/shopping', { title: 'نان-تست', qty: '۲ عدد', category: 'food' })).body);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { shopping: 1 } });
  assert.equal(JSON.parse((await call('t_dad', 'GET', '/api/shopping')).body).some((x: any) => x.title === 'نان-تست'), true);
  assert.equal((await call('t_dad', 'POST', '/api/shopping', { title: 'x' })).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { shopping: 2 } });
  assert.equal(JSON.parse((await call('t_dad', 'POST', `/api/shopping/${it.id}/status`, { status: 'bought' })).body).status, 'bought');
  assert.equal(JSON.parse((await call('t_mom', 'POST', '/api/shopping/clear-bought', {})).body).removed >= 1, true);
  const rq = JSON.parse((await call('t_sa', 'POST', '/api/child/requests', { category: 'school', title: 'مداد-تست' })).body);
  assert.equal((await call('t_mom', 'POST', `/api/purchase-requests/${rq.id}/to-shopping`, {})).statusCode, 200);
  assert.equal(JSON.parse((await call('t_mom', 'GET', '/api/shopping')).body).some((x: any) => x.title === 'مداد-تست' && x.category === 'school'), true);
  await sys(`DELETE FROM shopping_items WHERE title='مداد-تست'`);
  // health + reminder timing
  const tomorrow = (await import('../src/jalali.ts')).addDays(todayISO(), 1);
  const h = JSON.parse((await call('t_mom', 'POST', '/api/health-records', { title: 'واکسن-تست', kind: 'vaccine', person_id: ids.t_sa, person_label: 'سارینا', due_date: tomorrow })).body);
  await generate(tehranInstant(todayISO(), '18:05')); await generate(tehranInstant(todayISO(), '18:10'));
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE dedupe_key=$1`, [`health:${h.id}:eve`]))[0].n, 1);       // once, the evening before
  const h2 = JSON.parse((await call('t_mom', 'POST', '/api/health-records', { title: 'دندان‌پزشک-تست', kind: 'dental', due_date: todayISO() })).body);
  await generate(tehranInstant(todayISO(), '08:05')); await generate(tehranInstant(todayISO(), '08:07'));
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE dedupe_key=$1`, [`health:${h2.id}:day`]))[0].n, 1);          // once, on the day
  await sys(`DELETE FROM health_records WHERE id=$1`, [h2.id]);
  assert.equal((await call('t_dad', 'GET', '/api/health-records')).statusCode, 403);
  assert.equal(JSON.parse((await call('t_mom', 'POST', `/api/health-records/${h.id}/done`, { done: true })).body).done, true);
  await sys(`DELETE FROM health_records WHERE id=$1`, [h.id]);
  // task attachments
  const t = JSON.parse((await call('t_mom', 'POST', '/api/tasks', { title: 'کار-پیوست' })).body);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 65)]); const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(500, 1)]);
  const up = async (u: string, name: string, buf: Buffer) => { const m = multipart({}, name, buf); return app.inject({ method: 'POST', url: `/api/tasks/${t.id}/files`, headers: { ...H, cookie: jar[u], 'content-type': m['content-type'] }, payload: m.payload }); };
  const a = await up('t_mom', 'قرارداد.pdf', pdf); assert.equal(a.statusCode, 201, a.body); const b = await up('t_mom', 'گزارش.docx', zip); assert.equal(b.statusCode, 201); assert.match(JSON.parse(b.body).mime, /wordprocessingml/);
  assert.equal((await up('t_mom', 'x.zip', zip)).statusCode, 415); assert.equal((await up('t_mom', 'x.pdf', Buffer.from('MZ not pdf'))).statusCode, 415);
  assert.equal((await up('t_sa', 'x.pdf', pdf)).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { tasks: 1 } });
  const list = JSON.parse((await call('t_dad', 'GET', `/api/tasks/${t.id}/files`)).body); assert.equal(list.length, 2);
  assert.equal((await call('t_dad', 'GET', `/api/task-files/${JSON.parse(a.body).id}/file`)).statusCode, 200);
  assert.equal((await call('t_dad', 'DELETE', `/api/task-files/${JSON.parse(a.body).id}`)).statusCode, 403);
  const dl = await call('t_mom', 'GET', `/api/task-files/${JSON.parse(b.body).id}/file`); assert.match(String(dl.headers['content-disposition']), /attachment/);
  assert.equal((await call('t_mom', 'DELETE', `/api/tasks/${t.id}`)).statusCode, 200); assert.equal((await sys(`SELECT count(*)::int n FROM task_files WHERE task_id=$1`, [t.id]))[0].n, 0);
});

test('first-run setup is refused when users exist; creation works on an empty DB (rolled back); admin manages accounts and passwords', async () => {
  assert.equal(JSON.parse((await app.inject({ url: '/api/setup/status' })).body).needs_setup, false);
  const r = await app.inject({ method: 'POST', url: '/api/setup', headers: H, payload: { username: 'hacker', display_name: 'x', password: 'longpassword1' } }); assert.equal(r.statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'hacker', display_name: 'x', password: 'longpassword1' } })).statusCode, 403);   // CSRF header required
  // creation path: run inside a transaction on an emptied users table, then roll back
  const { createFirstAdmin } = await import('../src/routes/setup.ts'); const c = await sysPool.connect();
  try { await c.query('BEGIN'); await c.query('TRUNCATE users CASCADE'); const id = await createFirstAdmin(c, { username: 'first_admin', display_name: 'مدیر', password: 'longpassword1' }); assert.ok(id);
    assert.equal(await createFirstAdmin(c, { username: 'second', display_name: 'x', password: 'longpassword1' }), null);   // a second call is refused
    assert.equal(Number((await c.query(`SELECT count(*) n FROM users WHERE role='parent'`)).rows[0].n), 1); } finally { await c.query('ROLLBACK'); c.release(); }
  // admin account management
  const mkU = JSON.parse((await call('t_mom', 'POST', '/api/users', { username: 't_adm2', display_name: 'مدیر دوم', role: 'parent', password: 'longpassword1' })).body); assert.equal(mkU.role, 'parent');
  assert.equal((await call('t_mom', 'POST', '/api/users', { username: 't_adm3', display_name: 'x', role: 'parent', password: '1234' })).statusCode, 400);   // admins need 8+
  assert.equal((await call('t_mom', 'PATCH', `/api/users/${ids.t_sa}`, { username: 't_sa_renamed' })).statusCode, 200);
  assert.equal((await call('t_mom', 'PATCH', `/api/users/${ids.t_sa}`, { username: 't_sm' })).statusCode, 400);                                  // duplicate username
  assert.equal((await call('t_dad', 'POST', `/api/users/${ids.t_sa}/password`, { password: '9999' })).statusCode, 403);
  assert.equal((await call('t_mom', 'POST', `/api/users/${ids.t_sa}/password`, { password: '2468' })).statusCode, 200);
  assert.equal((await call('t_sa', 'GET', '/api/me')).statusCode, 401);                                                                           // old session closed
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 't_sa_renamed', password: '2468' } })).statusCode, 200);   // new username + new PIN work
  assert.equal((await call('t_mom', 'POST', `/api/users/${mkU.id}/password`, { password: '1234' })).statusCode, 400);                              // admin password too short
  assert.equal((await call('t_mom', 'POST', `/api/users/${ids.t_mom}/password`, { password: 'longpassword2' })).statusCode, 400);                 // own password: use change-password
  await sys(`UPDATE users SET username='t_sa' WHERE id=$1`, [ids.t_sa]); await sys(`DELETE FROM users WHERE username='t_adm2'`);
  // never deactivate the last active admin
  const parents = await sys(`SELECT id FROM users WHERE role='parent' AND active AND username NOT LIKE 't\\_%'`);
  const others = parents.map((p: any) => p.id); await sys(`UPDATE users SET active=false WHERE id = ANY($1)`, [others]);
  const tgt = await mk('t_adm4', 'parent').then(() => ids.t_adm4); assert.equal((await call('t_mom', 'PATCH', `/api/users/${tgt}`, { active: false })).statusCode, 200);   // t_mom is still active
  await sys(`UPDATE users SET active=true WHERE id = ANY($1)`, [others]); await sys(`DELETE FROM users WHERE username='t_adm4'`);
});

test('diary: author only; Mana reads CHILDREN\'s diaries read-only; adults\' diaries and siblings stay private', async () => {
  await sys(`UPDATE users SET active=true, password_hash=$2 WHERE id=$1`, [ids.t_sa, await hashPassword(PW)]); await sys(`UPDATE users SET active=true WHERE id=$1`, [ids.t_dad]);
  for (const u of ['t_mom', 't_sa', 't_sm', 't_dad']) await signIn(u);
  const mine = await call('t_sa', 'POST', '/api/diary', { title: 'امروز', body: 'متن خصوصی سارینا', mood: '😊' }); assert.equal(mine.statusCode, 201, mine.body);
  const id = JSON.parse(mine.body).id;
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/diary')).body).length, 1);
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/diary')).body).length, 0);                                            // sibling sees none
  assert.equal(JSON.parse((await call('t_sm', 'GET', `/api/diary?user_id=${ids.t_sa}`)).body).length, 0);                       // ...even when asking for it
  assert.equal(JSON.parse((await call('t_dad', 'GET', `/api/diary?user_id=${ids.t_sa}`)).body).length, 0);                      // father cannot read children's diary
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/diary?user_id=${ids.t_sa}`)).body).length, 1);                      // Mana can (read-only)
  assert.equal((await call('t_mom', 'PATCH', `/api/diary/${id}`, { body: 'changed' })).statusCode, 404);                         // not Mana's entry: cannot edit
  assert.equal((await call('t_sa', 'PATCH', `/api/diary/${id}`, { body: 'ویرایش' })).statusCode, 200);
  await call('t_dad', 'POST', '/api/diary', { body: 'راز وحید' });
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/diary?user_id=${ids.t_dad}`)).body).length, 0);                      // adults' diaries are private even from Mana
  // Mana switches the feature off for one child
  assert.equal((await call('t_mom', 'PATCH', `/api/members/${ids.t_sm}`, { permissions: { diary: 0 } })).statusCode, 200);
  assert.equal((await call('t_sm', 'POST', '/api/diary', { body: 'x' })).statusCode, 403);
  assert.equal((await call('t_mom', 'PATCH', `/api/members/${ids.t_sm}`, { permissions: { finance: 2 } })).statusCode, 400);       // children never get work modules
  await call('t_mom', 'PATCH', `/api/members/${ids.t_sm}`, { permissions: { diary: 2 } });
  assert.equal((await call('t_sa', 'DELETE', `/api/diary/${id}`)).statusCode, 200);
});
test('Mom\'s messages: Mana writes, only the recipient reads and can only mark as read', async () => {
  const r = await call('t_mom', 'POST', '/api/mom-messages', { to: [ids.t_sa], title: 'موفق باشی', body: 'فردا امتحان داری، به تو افتخار می‌کنم 💜' }); assert.equal(r.statusCode, 201, r.body);
  const mine = JSON.parse((await call('t_sa', 'GET', '/api/mom-messages')).body); assert.equal(mine.length, 1); assert.equal(mine[0].read_at, null);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/mom-messages/unread')).body).count, 1);
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/mom-messages')).body).length, 0);
  assert.equal((await call('t_sa', 'POST', '/api/mom-messages', { to: 'all', body: 'جعلی' })).statusCode, 403);
  await assert.rejects(withActor({ id: ids.t_sa, role: 'child' }, (q) => q(`UPDATE mom_messages SET body='hack' WHERE to_user=$1`, [ids.t_sa])));        // recipient may change read_at only
  assert.equal((await call('t_sa', 'POST', `/api/mom-messages/${mine[0].id}/read`, {})).statusCode, 200);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/mom-messages/unread')).body).count, 0);
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE ref_type='mom_message' AND user_id=$1`, [ids.t_sa]))[0].n, 1);                     // child was notified
  await sys(`DELETE FROM mom_messages WHERE to_user=$1`, [ids.t_sa]);
});
test('family chat: group for everyone with the feature; DMs readable only by the two people (not even Mana)', async () => {
  assert.equal((await call('t_sa', 'POST', '/api/chat', { body: 'سلام به همه' })).statusCode, 201);
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/chat')).body).messages.some((m: any) => m.body === 'سلام به همه'), true);
  assert.equal((await call('t_sa', 'POST', '/api/chat', { body: 'راز بین ما', peer_id: ids.t_sm })).statusCode, 201);
  assert.equal(JSON.parse((await call('t_sm', 'GET', `/api/chat?peer=${ids.t_sa}`)).body).messages.length, 1);
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/chat?peer=${ids.t_sa}`)).body).messages.length, 0);                                                // Mana cannot read the DM
  assert.equal(JSON.parse((await call('t_dad', 'GET', `/api/chat?peer=${ids.t_sa}`)).body).messages.length, 0);
  assert.equal((await call('t_sa', 'POST', '/api/chat', { body: 'x', peer_id: ids.t_sa })).statusCode >= 400, true);                                             // no self-DM
  await call('t_mom', 'PATCH', `/api/members/${ids.t_sm}`, { permissions: { chat: 0 } });
  assert.equal((await call('t_sm', 'GET', '/api/chat')).statusCode, 403);
  await call('t_mom', 'PATCH', `/api/members/${ids.t_sm}`, { permissions: { chat: 2 } });
  await sys(`DELETE FROM chat_messages`); await sys(`DELETE FROM notifications WHERE kind='chat'`);
});
test('nightly reflection: editable questions, one entry per day, stars only once, Mana reads children\'s answers', async () => {
  const t = JSON.parse((await call('t_sa', 'GET', '/api/reflection/today')).body); assert.ok(t.questions.length >= 5); assert.equal(t.entry, null);
  await call('t_mom', 'PATCH', `/api/children/${ids.t_sa}/settings`, { reflection_stars: 2 });
  const answers = t.questions.map((q: any) => ({ q: q.text, kind: q.kind, a: 'جواب ' + q.text.slice(0, 4) }));
  const r1 = JSON.parse((await call('t_sa', 'PUT', '/api/reflection/today', { answers })).body); assert.equal(r1.stars, 2);
  assert.equal(JSON.parse((await call('t_sa', 'PUT', '/api/reflection/today', { answers })).body).stars, 0);                                                     // no second reward
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/reflection?user_id=${ids.t_sa}`)).body).length, 1);
  assert.equal(JSON.parse((await call('t_sm', 'GET', `/api/reflection?user_id=${ids.t_sa}`)).body).length, 0);
  assert.equal((await call('t_sa', 'POST', '/api/reflection-questions', { text: 'x' })).statusCode, 403);
  assert.equal((await call('t_mom', 'POST', '/api/reflection-questions', { child_id: ids.t_sa, text: 'امروز چه چیزی دوست داشتی؟' })).statusCode, 201);
  assert.ok(JSON.parse((await call('t_sa', 'GET', '/api/reflection/today')).body).questions.some((q: any) => /دوست داشتی/.test(q.text)));
  assert.equal(JSON.parse((await call('t_sm', 'GET', '/api/reflection/today')).body).questions.some((q: any) => /دوست داشتی/.test(q.text)), false);           // question was for Sarina only
  await sys(`DELETE FROM reflection_questions WHERE child_id IS NOT NULL`); await call('t_mom', 'PATCH', `/api/children/${ids.t_sa}/settings`, { reflection_stars: 0 });
  // reminder at the configured time, once
  await call('t_mom', 'PATCH', `/api/children/${ids.t_sm}/settings`, { reflection_time: '20:30', notifications_enabled: true }); await sys(`UPDATE child_settings SET quiet_start='00:00', quiet_end='00:00' WHERE child_id=$1`, [ids.t_sm]);
  await generate(tehranInstant(todayISO(), '20:35')); await generate(tehranInstant(todayISO(), '20:40'));
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='reflection'`, [ids.t_sm]))[0].n, 1);
});
test('wish board: own board, Mana reads children\'s, achieve notifies Mana, renew archives and carries over', async () => {
  const b0 = JSON.parse((await call('t_sa', 'GET', '/api/wishes/board')).body); assert.ok(b0.board);
  const w = JSON.parse((await call('t_sa', 'POST', '/api/wishes', { title: 'دوچرخه', kind: 'dream', note: 'قرمز' })).body);
  const w2 = JSON.parse((await call('t_sa', 'POST', '/api/wishes', { title: 'سفر به شمال', kind: 'place' })).body);
  assert.equal(JSON.parse((await call('t_mom', 'GET', `/api/wishes/board?user_id=${ids.t_sa}`)).body).wishes.length, 2);
  assert.equal(JSON.parse((await call('t_sm', 'GET', `/api/wishes/board?user_id=${ids.t_sa}`)).body).wishes.length, 0);            // asking for a sibling's board returns his/her own
  assert.equal((await call('t_sm', 'PATCH', `/api/wishes/${w.id}`, { title: 'hack' })).statusCode, 404);
  assert.equal((await call('t_sa', 'POST', `/api/wishes/${w.id}/achieve`, { achieved: true })).statusCode, 200);
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE kind='wish_done' AND user_id=$1`, [ids.t_mom]))[0].n >= 1, true);
  const nb = JSON.parse((await call('t_sa', 'POST', '/api/wishes/board/renew', { carry_over: true })).body);
  const after = JSON.parse((await call('t_sa', 'GET', '/api/wishes/board')).body); assert.equal(after.board.id, nb.id); assert.equal(after.wishes.length, 1); assert.equal(after.wishes[0].title, 'سفر به شمال'); assert.equal(after.archived.length, 1);
  void w2; assert.equal((await call('t_sa', 'POST', '/api/wishes/photo', {})).statusCode >= 400, true);
});
test('weekly report (Mana only), meal plan, profile photo, annual dates with notifications', async () => {
  const rep = await call('t_mom', 'GET', '/api/reports/weekly'); assert.equal(rep.statusCode, 200, rep.body); const j = JSON.parse(rep.body); assert.ok(Array.isArray(j.kids) && Array.isArray(j.highlights) && j.week_fa);
  assert.equal((await call('t_sa', 'GET', '/api/reports/weekly')).statusCode, 403); assert.equal((await call('t_dad', 'GET', '/api/reports/weekly')).statusCode, 403);
  const day = todayISO();
  await call('t_mom', 'PATCH', `/api/members/${ids.t_dad}`, { permissions: { shopping: 2 } });
  assert.equal((await call('t_dad', 'PUT', '/api/meals', { day, slot: 'dinner', title: 'قورمه‌سبزی' })).statusCode, 200);
  assert.equal(JSON.parse((await call('t_sa', 'GET', `/api/meals?from=${day}&to=${day}`)).body)[0].title, 'قورمه‌سبزی');          // children can see the plan
  assert.equal((await call('t_sa', 'PUT', '/api/meals', { day, slot: 'lunch', title: 'x' })).statusCode, 403);
  await call('t_mom', 'PUT', '/api/meals', { day, slot: 'dinner', title: '' });
  // avatar: each person can set their own profile photo; others can see it
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'); const m = multipart({}, 'a.png', png);
  const av = await app.inject({ method: 'POST', url: '/api/me/avatar', headers: { ...H, cookie: jar.t_sa, 'content-type': m['content-type'] }, payload: m.payload }); assert.equal(av.statusCode, 201, av.body);
  const pid = JSON.parse(av.body).avatar_photo_id; assert.equal((await call('t_sm', 'GET', `/api/photos/${pid}/file`)).statusCode, 200);
  assert.equal(JSON.parse((await call('t_sa', 'GET', '/api/photos')).body).some((p: any) => p.id === pid), false);                    // avatars stay out of the gallery
  // annual dates (occasions) with notification: today's birthday reaches everyone it is meant for
  const { jm, jd } = toJalali(day);
  const oc = JSON.parse((await call('t_mom', 'POST', '/api/occasions', { title: 'تولد-اعلان', kind: 'birthday', jm, jd, notify: true, audience: 'all', person_id: ids.t_sa })).body);
  await generate(tehranInstant(day, '09:10')); await generate(tehranInstant(day, '09:20'));
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE dedupe_key LIKE $1`, [`fd:${oc.id}:%`]))[0].n >= 3, true);
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE dedupe_key = $1`, [`fd:${oc.id}:${day}:${ids.t_sa}`]))[0].n, 1);       // exactly once per person
  await sys(`DELETE FROM occasions WHERE id=$1`, [oc.id]);
});

test('sample data: optional, idempotent, age-appropriate', async () => {
  await sys(`DELETE FROM activities WHERE child_id=ANY($1)`, [[ids.t_sa, ids.t_sm]]); await sys(`DELETE FROM routines WHERE child_id=ANY($1)`, [[ids.t_sa, ids.t_sm]]);
  assert.equal((await call('t_sa', 'POST', `/api/children/${ids.t_sa}/sample-data`, {})).statusCode, 403);
  const r1 = JSON.parse((await call('t_mom', 'POST', `/api/children/${ids.t_sa}/sample-data`, {})).body); assert.equal(r1.added.activities, 7); assert.ok(r1.added.routines >= 4);
  const r2 = JSON.parse((await call('t_mom', 'POST', `/api/children/${ids.t_sa}/sample-data`, {})).body); assert.deepEqual(r2.added, { activities: 0, routines: 0, rewards: 0, goals: 0 });          // second click adds nothing
  const sm = JSON.parse((await call('t_mom', 'POST', `/api/children/${ids.t_sm}/sample-data`, {})).body); assert.equal(sm.added.activities, 5);                              // 7-year-old gets the young template
  assert.equal((await sys(`SELECT count(*)::int n FROM activities WHERE child_id=$1 AND title='کلاس رقص'`, [ids.t_sm]))[0].n, 0);
  assert.equal((await sys(`SELECT start_time::text t FROM activities WHERE child_id=$1 AND title='شاهنامه‌خوانی'`, [ids.t_sa]))[0].t, null);                                        // class without a time gets no reminder
  await sys(`DELETE FROM activities WHERE child_id=ANY($1)`, [[ids.t_sa, ids.t_sm]]); await sys(`DELETE FROM routines WHERE child_id=ANY($1)`, [[ids.t_sa, ids.t_sm]]);
});
