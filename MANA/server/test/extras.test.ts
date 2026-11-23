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
const upload = (u: string, url: string, file: Buffer, name = 'a.png', type = 'image/png') => {
  const b = 'xxB'; const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`)]);
  return app.inject({ method: 'POST', url, headers: { ...H, cookie: jar[u], 'content-type': `multipart/form-data; boundary=${b}` }, payload: body });
};

/** tests share the DB with the real accounts: remove side effects that reach real users (notifications to the real parent, shopping items, meals) */
async function cleanup() {
  await sys(`DELETE FROM notifications WHERE (kind IN ('wish_done','chat') AND (title LIKE '%x\\_%' OR title LIKE '%s\\_%')) OR (kind='mom_message' AND body IN ('دوستت دارم','برای همه'))`);
  await sys(`DELETE FROM shopping_items WHERE title IN ('شیر','نان')`); await sys(`DELETE FROM meals WHERE day='2026-11-25'`);
}
before(async () => {
  app = await buildApp();
  await sys(`DELETE FROM users WHERE username LIKE 'x\\_%'`);
  await mk('x_mom', 'parent'); await mk('x_kid', 'child'); await mk('x_kid2', 'child'); await mk('x_dad', 'member');
});
after(async () => { await sys(`DELETE FROM users WHERE username LIKE 'x\\_%'`);
  await cleanup(); await app.close(); await sysPool.end(); await appPool.end(); });

test('wish board: own board, photo, achieve ticks + notifies Mana, privacy, renew carries unachieved wishes, gallery stays clean', async () => {
  const ph = await upload('x_kid', '/api/wishes/photo', PNG); assert.equal(ph.statusCode, 201, ph.body);
  const w1 = await call('x_kid', 'POST', '/api/wishes', { title: 'سفر به شمال', kind: 'place', photo_id: ph.json().photo_id }); assert.equal(w1.statusCode, 201, w1.body);
  const w2 = await call('x_kid', 'POST', '/api/wishes', { title: 'دوچرخه‌ی جدید', kind: 'dream' }); assert.equal(w2.statusCode, 201);
  const b = (await call('x_kid', 'GET', '/api/wishes/board')).json(); assert.equal(b.wishes.length, 2);
  assert.equal((await call('x_kid', 'GET', `/api/photos?owner_id=${ids.x_kid}`)).json().length, 0);            // wish photo is not in the gallery
  assert.equal((await call('x_kid2', 'GET', `/api/photos/${ph.json().photo_id}/file`)).statusCode, 404);        // sibling can't see it
  assert.equal((await call('x_mom', 'GET', `/api/photos/${ph.json().photo_id}/file`)).statusCode, 200);        // Mana can
  assert.equal((await call('x_kid2', 'GET', `/api/wishes/board?user_id=${ids.x_kid}`)).json().wishes.length, 0);  // ?user_id ignored for non-parents
  assert.equal((await call('x_mom', 'GET', `/api/wishes/board?user_id=${ids.x_kid}`)).json().wishes.length, 2);
  assert.equal((await call('x_mom', 'POST', `/api/wishes/${w1.json().id}/achieve`, { achieved: true })).statusCode, 404);   // only the owner ticks
  const a = await call('x_kid', 'POST', `/api/wishes/${w1.json().id}/achieve`, { achieved: true }); assert.equal(a.statusCode, 200); assert.ok(a.json().achieved_at);
  assert.equal((await sys(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='wish_done'`, [ids.x_mom]))[0].n, 1);
  const nb = (await call('x_kid', 'POST', '/api/wishes/board/renew', { title: 'تابلوی بهار' })).json();
  const board = (await call('x_kid', 'GET', '/api/wishes/board')).json();
  assert.equal(board.board.id, nb.id); assert.equal(board.wishes.length, 1); assert.equal(board.wishes[0].title, 'دوچرخه‌ی جدید');   // only the unachieved one carried
  assert.equal(board.archived.length, 1); assert.equal(board.archived[0].achieved, 1);
  await call('x_mom', 'PATCH', `/api/members/${ids.x_kid2}`, { permissions: { wishes: 1 } });
  assert.equal((await call('x_kid2', 'POST', '/api/wishes', { title: 'x' })).statusCode, 403);                 // view-only
  assert.equal((await call('x_dad', 'GET', `/api/wishes/board?user_id=${ids.x_kid}`)).json().wishes.length, 0);   // Vahid cannot read kids' boards
});

test('private 1-to-1 chat: only the two people read it; group unaffected; notifications are throttled', async () => {
  await sys(`UPDATE users SET permissions='{}' WHERE id = ANY($1)`, [[ids.x_kid, ids.x_kid2, ids.x_dad]]);
  const dm = await call('x_kid', 'POST', '/api/chat', { body: 'فقط برای تو', peer_id: ids.x_kid2 }); assert.equal(dm.statusCode, 201, dm.body);
  assert.equal((await call('x_kid2', 'GET', `/api/chat?peer=${ids.x_kid}`)).json().messages.length, 1);
  assert.equal((await call('x_dad', 'GET', `/api/chat?peer=${ids.x_kid}`)).json().messages.length, 0);
  assert.equal((await call('x_mom', 'GET', `/api/chat?peer=${ids.x_kid}`)).json().messages.length, 0);          // not even Mana
  assert.equal((await call('x_kid', 'POST', '/api/chat', { body: 'x', peer_id: ids.x_kid })).statusCode, 403);   // no DM to self
  assert.equal((await call('x_kid2', 'GET', '/api/chat')).json().messages.length, 0);                          // DM not in group
  await call('x_kid', 'POST', '/api/chat', { body: 'سلام گروه' });
  const sum = (await call('x_kid2', 'GET', '/api/chat/summary')).json(); assert.ok(sum.find((c: any) => c.conv === 'group') && sum.find((c: any) => c.conv === ids.x_kid));
  await new Promise((r) => setTimeout(r, 300));
  const n = await sys(`SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND kind='chat'`, [ids.x_kid2]); assert.equal(n[0].n, 1);   // DM + group within 5 min => one notification
});

test('Mana creates accounts from the app; per-child theme/homework replace hard-coded names; reflection stars', async () => {
  const r = await call('x_mom', 'POST', '/api/members', { username: 'x_new', display_name: 'تازه', role: 'child', password: 'Longer-pass-1', theme: 'saman', show_homework: true });
  assert.equal(r.statusCode, 201, r.body); ids.x_new = r.json().id;
  assert.equal((await call('x_kid', 'POST', '/api/members', { username: 'x_bad', display_name: 'a', role: 'member', password: 'Longer-pass-1' })).statusCode, 403);
  assert.equal((await call('x_mom', 'POST', '/api/members', { username: 'x_new', display_name: 'تکراری', role: 'child', password: 'Longer-pass-1' })).statusCode, 400);
  const l = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { username: 'x_new', password: 'Longer-pass-1' } }); assert.equal(l.statusCode, 200);
  jar.x_new = `mana_session=${l.cookies[0].value}`;
  const me = (await call('x_new', 'GET', '/api/me')).json(); assert.equal(me.settings.theme, 'saman'); assert.equal(me.settings.show_homework, true);
  await call('x_mom', 'PATCH', `/api/children/${ids.x_new}/settings`, { reflection_stars: 2 });
  const t = (await call('x_new', 'GET', '/api/reflection/today')).json();
  const put = await call('x_new', 'PUT', '/api/reflection/today', { answers: t.questions.map((q: any, i: number) => ({ q: q.text, kind: q.kind, a: i === 0 ? 'خوب بود' : '' })) });
  assert.equal(put.json().stars, 2);
  const again = await call('x_new', 'PUT', '/api/reflection/today', { answers: t.questions.map((q: any, i: number) => ({ q: q.text, kind: q.kind, a: i === 0 ? 'ویرایش' : '' })) });
  assert.equal(again.json().stars, 0);                                                                          // once per day
  assert.equal((await sys(`SELECT COALESCE(SUM(delta),0)::int b FROM star_ledger WHERE child_id=$1`, [ids.x_new]))[0].b, 2);
});

test('home module: shopping list and meal plan need the "home" permission; task attachments; annual dates', async () => {
  assert.equal((await call('x_dad', 'GET', '/api/shopping')).statusCode, 403);
  const it = await call('x_mom', 'POST', '/api/shopping', { title: 'شیر', qty: '۲ بسته' }); assert.equal(it.statusCode, 201, it.body);
  assert.equal((await call('x_mom', 'PATCH', `/api/shopping/${it.json().id}`, { done: true })).statusCode, 200);
  assert.equal((await call('x_mom', 'PUT', '/api/meals', { day: '2026-11-25', slot: 'dinner', title: 'قورمه‌سبزی' })).statusCode, 200);
  assert.equal((await call('x_mom', 'GET', '/api/meals?from=2026-11-21&to=2026-11-27')).json().length, 1);
  await call('x_mom', 'PATCH', `/api/members/${ids.x_dad}`, { permissions: { home: 1, tasks: 2 } });
  assert.equal((await call('x_dad', 'GET', '/api/shopping')).statusCode, 200);
  assert.equal((await call('x_dad', 'POST', '/api/shopping', { title: 'نان' })).statusCode, 403);
  assert.equal((await call('x_kid', 'GET', '/api/shopping')).statusCode, 403);
  const task = (await call('x_mom', 'POST', '/api/tasks', { title: 'کار با فایل' })).json();
  const pdf = await upload('x_mom', `/api/tasks/${task.id}/files`, Buffer.from('%PDF-1.4\n%test\n'), 'قرارداد.pdf', 'application/pdf'); assert.equal(pdf.statusCode, 201, pdf.body);
  assert.equal((await upload('x_mom', `/api/tasks/${task.id}/files`, Buffer.from('MZ not allowed'), 'x.exe', 'application/octet-stream')).statusCode, 415);
  assert.equal((await call('x_dad', 'GET', `/api/task-files/${pdf.json().id}`)).statusCode, 200);
  assert.equal((await call('x_kid', 'GET', `/api/task-files/${pdf.json().id}`)).statusCode, 403);
  assert.equal((await call('x_mom', 'DELETE', `/api/task-files/${pdf.json().id}`)).statusCode, 200);
  const fd = (await call('x_kid', 'GET', '/api/family-dates')).json(); assert.ok(fd.filter((d: any) => d.official).length >= 10);
  assert.equal((await call('x_kid', 'POST', '/api/family-dates', { title: 'x', kind: 'birthday', jm: 1, jd: 1 })).statusCode, 403);
  const bd = await call('x_mom', 'POST', '/api/family-dates', { title: 'تولد سارینا', kind: 'birthday', jm: 7, jd: 20 }); assert.equal(bd.statusCode, 201);
  await call('x_mom', 'DELETE', `/api/family-dates/${bd.json().id}`);
});

test('weekly report: Mana only; counts, reflections and rule-based highlights', async () => {
  assert.equal((await call('x_kid', 'GET', '/api/reports/weekly')).statusCode, 403);
  assert.equal((await call('x_dad', 'GET', '/api/reports/weekly')).statusCode, 403);
  const r = (await call('x_mom', 'GET', '/api/reports/weekly')).json();
  assert.ok(r.week_fa && Array.isArray(r.kids) && r.highlights.length >= 1 && r.family.finance);
  const k = r.kids.find((x: any) => x.id === ids.x_new); assert.ok(k); assert.equal(k.reflection_days, 1); assert.equal(k.stars_earned, 2); assert.deepEqual(k.happy.map((h: any) => h.text), ['ویرایش']);
});
