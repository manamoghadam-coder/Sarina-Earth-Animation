import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { sys, sysPool, appPool } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';

const PW = 'Test-pass-12345';
let app: Awaited<ReturnType<typeof buildApp>>;
const ids: Record<string, string> = {}; const jar: Record<string, string> = {};
const H = { 'x-requested-with': 'mana' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function mk(u: string, role: string) {
  const [r] = await sys(`INSERT INTO users (username,display_name,role,password_hash) VALUES ($1,$1,$2,$3) RETURNING id`, [u, role, await hashPassword(PW)]);
  if (role === 'child') await sys(`INSERT INTO child_settings (child_id) VALUES ($1)`, [r.id]);
  ids[u] = r.id;
  const l = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: u, password: PW } });
  jar[u] = `mana_session=${l.cookies[0].value}`;
}
const call = (u: string, method: any, url: string, payload?: any) => app.inject({ method, url, headers: { ...H, cookie: jar[u] }, payload });

/** tests share the DB with the real accounts: remove side effects that reach real users (notifications to the real parent, shopping items, meals) */
async function cleanup() {
  await sys(`DELETE FROM notifications WHERE (kind IN ('wish_done','chat') AND (title LIKE '%x\\_%' OR title LIKE '%s\\_%')) OR (kind='mom_message' AND body IN ('دوستت دارم','برای همه'))`);
  await sys(`DELETE FROM shopping_items WHERE title IN ('شیر','نان')`); await sys(`DELETE FROM meals WHERE day='2026-11-25'`);
}
before(async () => {
  app = await buildApp();
  await sys(`DELETE FROM users WHERE username LIKE 's\\_%'`);
  await mk('s_mom', 'parent'); await mk('s_kid', 'child'); await mk('s_kid2', 'child'); await mk('s_dad', 'member');
});
after(async () => { await sys(`DELETE FROM users WHERE username LIKE 's\\_%'`);
  await cleanup(); await app.close(); await sysPool.end(); await appPool.end(); });

test('diary: Mana can READ (not edit) children diaries; siblings and other adults cannot; adult diaries stay private', async () => {
  const c = await call('s_kid', 'POST', '/api/diary', { title: 'امروز', body: 'راز من', mood: '😊' });
  assert.equal(c.statusCode, 201, c.body);
  assert.equal((await call('s_kid', 'GET', '/api/diary')).json().length, 1);
  assert.equal((await call('s_mom', 'GET', '/api/diary')).json().length, 0);          // her own diary is empty
  assert.equal((await call('s_mom', 'GET', `/api/diary?user_id=${ids.s_kid}`)).json().length, 1);   // but she may read the child's
  assert.equal((await call('s_kid2', 'GET', `/api/diary?user_id=${ids.s_kid}`)).json().length, 0);  // ?user_id is ignored for non-parents
  assert.equal((await call('s_dad', 'GET', `/api/diary?user_id=${ids.s_kid}`)).json().length, 0);
  await call('s_dad', 'POST', '/api/diary', { body: 'خاطره‌ی بابا' });
  assert.equal((await call('s_mom', 'GET', `/api/diary?user_id=${ids.s_dad}`)).json().length, 0);   // adults' diaries stay private
  assert.equal((await call('s_kid2', 'GET', '/api/diary')).json().length, 0);
  const id = c.json().id;
  assert.equal((await call('s_mom', 'PATCH', `/api/diary/${id}`, { body: 'x' })).statusCode, 404);
  assert.equal((await call('s_mom', 'DELETE', `/api/diary/${id}`)).statusCode, 404);
  assert.equal((await call('s_kid', 'PATCH', `/api/diary/${id}`, { body: 'ویرایش' })).statusCode, 200);
  assert.equal((await call('s_kid', 'DELETE', `/api/diary/${id}`)).statusCode, 200);
});

test('mom messages: Mana writes to chosen people, only recipient reads, recipient cannot edit text', async () => {
  const s = await call('s_mom', 'POST', '/api/mom-messages', { to: [ids.s_kid], title: 'صبح بخیر', body: 'دوستت دارم' });
  assert.equal(s.statusCode, 201, s.body);
  const mine = (await call('s_kid', 'GET', '/api/mom-messages')).json();
  assert.equal(mine.length, 1); assert.equal(mine[0].read_at, null);
  assert.equal((await call('s_kid2', 'GET', '/api/mom-messages')).json().length, 0);
  assert.equal((await call('s_kid', 'GET', '/api/mom-messages/unread')).json().count, 1);
  assert.equal((await call('s_kid', 'POST', '/api/mom-messages', { to: [ids.s_kid2], body: 'x' })).statusCode, 403);
  assert.equal((await call('s_kid', 'PATCH', `/api/mom-messages/${mine[0].id}`, { body: 'x' })).statusCode, 403);
  assert.equal((await call('s_kid', 'POST', `/api/mom-messages/${mine[0].id}/read`)).statusCode, 200);
  assert.equal((await call('s_kid', 'GET', '/api/mom-messages/unread')).json().count, 0);
  const r = await sys(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='mom_message'`, [ids.s_kid]); assert.equal(r[0].n, 1);
  // DB level: a recipient can't rewrite the text even via a direct UPDATE (trigger)
  await assert.rejects(async () => { const { withActor } = await import('../src/db.ts'); await withActor({ id: ids.s_kid, role: 'child' }, (q) => q(`UPDATE mom_messages SET body='hack' WHERE id=$1`, [mine[0].id])); });
  const all = await call('s_mom', 'POST', '/api/mom-messages', { to: [ids.s_kid, ids.s_kid2, ids.s_dad], body: 'برای همه' });   // (the real 'all' option is not used here: tests share the DB with real accounts)
  assert.equal(all.json().sent, 3);
});

test('chat: all four can talk, per-user permission is enforced, only sender/Mana delete', async () => {
  const m = await call('s_kid', 'POST', '/api/chat', { body: 'سلام!' });
  assert.equal(m.statusCode, 201, m.body);
  const dad = (await call('s_dad', 'GET', '/api/chat')).json();
  assert.equal(dad.messages.length >= 1, true); assert.equal(dad.people.length >= 4, true);
  assert.equal((await call('s_kid2', 'DELETE', `/api/chat/${m.json().id}`)).statusCode, 404);
  // Mana switches chat to view-only for kid2, then off
  assert.equal((await call('s_mom', 'PATCH', `/api/members/${ids.s_kid2}`, { permissions: { chat: 1 } })).statusCode, 200);
  assert.equal((await call('s_kid2', 'GET', '/api/chat')).statusCode, 200);
  assert.equal((await call('s_kid2', 'POST', '/api/chat', { body: 'x' })).statusCode, 403);
  assert.equal((await call('s_mom', 'PATCH', `/api/members/${ids.s_kid2}`, { permissions: { chat: 0 } })).statusCode, 200);
  assert.equal((await call('s_kid2', 'GET', '/api/chat')).statusCode, 403);
  assert.equal((await call('s_kid2', 'GET', '/api/me')).json().permissions.chat, 0);
  assert.equal((await call('s_mom', 'DELETE', `/api/chat/${m.json().id}`)).statusCode, 200);
});

test('permissions can be set for children too; adult modules are ignored for children; diary/inbox switches work', async () => {
  const r = await call('s_mom', 'PATCH', `/api/members/${ids.s_kid}`, { permissions: { diary: 0, inbox: 0, tasks: 2 } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().permissions.tasks, undefined);
  assert.equal((await call('s_kid', 'GET', '/api/diary')).statusCode, 403);
  assert.equal((await call('s_kid', 'GET', '/api/mom-messages')).statusCode, 403);
  assert.equal((await call('s_kid', 'GET', '/api/tasks')).statusCode, 403);
  assert.equal((await call('s_kid', 'PATCH', `/api/members/${ids.s_kid2}`, { permissions: { chat: 2 } })).statusCode, 403);
  assert.equal((await call('s_dad', 'PATCH', `/api/members/${ids.s_kid}`, { permissions: { chat: 2 } })).statusCode, 403);
});

test('each person changes their OWN profile photo; others cannot; role/permissions stay untouchable', async () => {
  const boundary = 'xxBOUNDARY';
  const form = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = await app.inject({ method: 'POST', url: '/api/me/avatar', headers: { ...H, cookie: jar.s_kid2, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: form });
  assert.equal(up.statusCode, 201, up.body);
  const me = (await call('s_kid2', 'GET', '/api/me')).json(); assert.equal(me.avatar_photo_id, up.json().avatar_photo_id);
  // everybody can see the avatar picture of the others (chat/header), but not their other photos
  assert.equal((await call('s_kid', 'GET', `/api/photos/${me.avatar_photo_id}/file`)).statusCode, 200);
  // picking someone else's photo as my avatar fails
  assert.equal((await call('s_kid', 'POST', '/api/me/avatar', { photo_id: me.avatar_photo_id })).statusCode, 404);
  // avatar switch off by Mana -> blocked
  await call('s_mom', 'PATCH', `/api/members/${ids.s_kid2}`, { permissions: { avatar: 0 } });
  const up2 = await app.inject({ method: 'POST', url: '/api/me/avatar', headers: { ...H, cookie: jar.s_kid2, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: form });
  assert.equal(up2.statusCode, 403);
  const role = await sys(`SELECT role FROM users WHERE id=$1`, [ids.s_kid2]); assert.equal(role[0].role, 'child');
});

test('nightly reflection: questions, one entry per day, Mana reads children answers, scheduler reminds once', async () => {
  await sys(`UPDATE users SET permissions='{}' WHERE id = ANY($1)`, [[ids.s_kid, ids.s_kid2, ids.s_dad]]);   // earlier tests changed switches
  const t = (await call('s_kid2', 'GET', '/api/reflection/today')).json();
  assert.equal(t.questions.length >= 5, true); assert.equal(t.questions.at(-1).kind, 'gratitude'); assert.equal(t.entry, null);
  const answers = t.questions.map((q: any, i: number) => ({ q: q.text, kind: q.kind, a: i === 0 ? 'بازی با سارینا' : '' }));
  assert.equal((await call('s_kid2', 'PUT', '/api/reflection/today', { answers })).statusCode, 200);
  assert.equal((await call('s_kid2', 'PUT', '/api/reflection/today', { answers: answers.map((x: any) => ({ ...x, a: '' })) })).statusCode, 400);
  assert.equal((await call('s_kid2', 'PUT', '/api/reflection/today', { answers: answers.map((x: any, i: number) => ({ ...x, a: i === 0 ? 'ویرایش' : '' })) })).statusCode, 200);   // same day = update
  assert.equal((await sys(`SELECT count(*)::int n FROM reflection_entries WHERE user_id=$1`, [ids.s_kid2]))[0].n, 1);
  assert.equal((await call('s_mom', 'GET', `/api/reflection?user_id=${ids.s_kid2}`)).json().length, 1);
  assert.equal((await call('s_kid', 'GET', `/api/reflection?user_id=${ids.s_kid2}`)).json().length, 0);
  assert.equal((await call('s_dad', 'GET', `/api/reflection?user_id=${ids.s_kid2}`)).json().length, 0);
  // Mana edits questions; kids cannot
  assert.equal((await call('s_kid', 'POST', '/api/reflection-questions', { text: 'x' })).statusCode, 403);
  const nq = await call('s_mom', 'POST', '/api/reflection-questions', { text: 'سؤال ویژه‌ی فقط یک نفر', child_id: ids.s_kid });
  assert.equal(nq.statusCode, 201, nq.body);
  assert.equal((await call('s_kid', 'GET', '/api/reflection/today')).json().questions.some((q: any) => q.id === nq.json().id), true);
  assert.equal((await call('s_kid2', 'GET', '/api/reflection/today')).json().questions.some((q: any) => q.id === nq.json().id), false);
  await call('s_mom', 'DELETE', `/api/reflection-questions/${nq.json().id}`);
  // scheduler: at the configured evening time a reminder is created once (and not for a child who already answered)
  const { generate } = await import('../src/scheduler.ts'); const { tehranInstant, todayISO } = await import('../src/jalali.ts');
  await sys(`UPDATE child_settings SET reflection_time='20:30', quiet_start='23:00', quiet_end='06:00' WHERE child_id = ANY($1)`, [[ids.s_kid, ids.s_kid2]]);
  const at = new Date(tehranInstant(todayISO(), '20:31'));
  await generate(at); await generate(at);
  const n = await sys(`SELECT user_id FROM notifications WHERE kind='reflection' AND user_id = ANY($1)`, [[ids.s_kid, ids.s_kid2]]);
  assert.deepEqual(n.map((x) => x.user_id), [ids.s_kid]);       // s_kid2 already answered; no duplicates
});
