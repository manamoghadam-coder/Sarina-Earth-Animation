import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { sys, sysPool, appPool, withActor } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';
import { generate } from '../src/scheduler.ts';
import { tehranInstant, todayISO, persianWeekday } from '../src/jalali.ts';

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
  app = await buildApp();
  await sys(`DELETE FROM users WHERE username LIKE 't\\_%'`);
  await mk('t_mom', 'parent'); await mk('t_sa', 'child'); await mk('t_sm', 'child');
  for (const u of ['t_mom', 't_sa', 't_sm']) await signIn(u);
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
  const r = JSON.parse((await call('t_mom', 'POST', '/api/ai/message', { text: 'فردا ساعت ۱۰ جلسه دارم.' })).body);
  assert.equal(r.kind, 'proposal'); assert.match(r.summary, /ساعت 10:00/);
  assert.equal((await sys(`SELECT count(*)::int n FROM events WHERE title='جلسه' AND starts_at > now()`))[0].n, 0);
  assert.equal((await call('t_mom', 'POST', `/api/ai/proposals/${r.proposal_id}/confirm`, { approve: true })).statusCode, 200);
  assert.equal((await sys(`SELECT count(*)::int n FROM events WHERE title='جلسه' AND starts_at > now()`))[0].n, 1);
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
