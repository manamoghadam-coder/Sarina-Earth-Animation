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

before(async () => {
  app = await buildApp();
  await sys(`DELETE FROM users WHERE username LIKE 's\\_%'`);
  await mk('s_mom', 'parent'); await mk('s_kid', 'child'); await mk('s_kid2', 'child'); await mk('s_dad', 'member');
});
after(async () => { await sys(`DELETE FROM users WHERE username LIKE 's\\_%'`); await app.close(); await sysPool.end(); await appPool.end(); });

test('diary is private: not even Mana can read a child diary; owner CRUD works', async () => {
  const c = await call('s_kid', 'POST', '/api/diary', { title: 'امروز', body: 'راز من', mood: '😊' });
  assert.equal(c.statusCode, 201, c.body);
  assert.equal((await call('s_kid', 'GET', '/api/diary')).json().length, 1);
  assert.equal((await call('s_mom', 'GET', '/api/diary')).json().length, 0);          // Mana sees only her own diary
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
