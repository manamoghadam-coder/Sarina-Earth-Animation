import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, schemaVersion, setSchemaVersion, allModuleKeys } from './db.js';
import { ENTITIES, MODULES, publicMeta, customerBalance } from './entities.js';
import { initSecret, signToken, readToken, verifyPassword, hashPassword, can, ROLES } from './auth.js';
import * as engine from './engine.js';
import { HttpError, bad, isoDate } from './util.js';
import { setFilesDir, saveFile, filePath, deleteFile, ALLOWED } from './files.js';
import * as ACC from './accounting.js';
import { mrp, capacity, pmRows, pmDue } from './industry.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dir, '..', 'public');
const COOKIE = 'erp_session';

export async function createApp({ dataDir, quiet, databaseUrl } = {}) {
  dataDir = dataDir || process.env.ERP_DATA_DIR || path.join(__dir, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  initSecret(dataDir);
  setFilesDir(process.env.ERP_FILES_DIR || path.join(dataDir, 'files'));
  const MAX_UPLOAD = (Number(process.env.ERP_MAX_UPLOAD_MB) || 10) * 1024 * 1024;
  const db = await openDb({ file: path.join(dataDir, 'erp.db'), url: databaseUrl ?? process.env.DATABASE_URL });
  await migrate(db);
  await upgrade(db);
  await bootstrapSuperadmin(db, quiet);

  const fails = new Map(); // محدودسازی تلاش ورود
  const throttleKey = (req, u) => `${req.socket.remoteAddress}|${String(u).toLowerCase()}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      secHeaders(res);
      if (url.pathname.startsWith('/api/')) {
        const mutating = req.method !== 'GET' && req.method !== 'HEAD';
        if (mutating && req.headers['x-erp'] !== '1') throw new HttpError(403, 'درخواست نامعتبر');
        const isUpload = req.method === 'POST' && url.pathname === '/api/attachments';
        const body = isUpload ? await readRaw(req, MAX_UPLOAD) : mutating ? await readJson(req) : {};  // بدنه قبل از ورود به صف خوانده می‌شود
        await db.serialize(() => handleApi(req, res, url, body)); // SQLite: اجرای ترتیبی؛ PostgreSQL: موازی
      } else serveStatic(req, res, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? 'خطای داخلی سرور' : e.message });
    }
  });

  // تراکنش با قفل شرکت؛ تابع روی ctx متصل به تراکنش اجرا می‌شود
  const tx = (ctx, fn) => db.tx(async (t) => { if (ctx.companyId) await t.lock(ctx.companyId); return fn({ ...ctx, db: t }); });

  async function handleApi(req, res, url, body) {
    const route = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const method = req.method;

    if (route[0] === 'login' && method === 'POST') {
      const k = throttleKey(req, body.username);
      const f = fails.get(k);
      if (f && f.n >= 8 && Date.now() - f.t < 5 * 60000) throw new HttpError(429, 'تلاش‌های ناموفق زیاد؛ چند دقیقه بعد دوباره امتحان کنید');
      const u = (await db.get('SELECT * FROM e_users WHERE username=?', String(body.username || '')));
      const co = u?.company_id ? (await db.get('SELECT active FROM companies WHERE id=?', u.company_id)) : null;
      const ok = u && verifyPassword(String(body.password || ''), u.password) && u.active && (!u.company_id || co?.active);
      if (!ok) {
        fails.set(k, { n: (f?.n || 0) + 1, t: Date.now() });
        if (!u) verifyPassword('x', 's1$00$00'); // یکسان‌سازی زمان پاسخ
        throw new HttpError(401, 'نام کاربری یا گذرواژه نادرست است');
      }
      fails.delete(k);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${signToken(u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
      await engine.audit({ db, companyId: u.company_id, user: { id: u.id, username: u.username } }, 'auth', u.id, 'login');
      return json(res, 200, { ok: true });
    }
    if (route[0] === 'logout' && method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, 200, { ok: true });
    }

    const ctx = await authenticate(req);
    const user = ctx.user;

    if (route[0] === 'me' && method === 'GET') return json(res, 200, meInfo(ctx));
    if (route[0] === 'password' && method === 'POST') {
      const row = (await db.get('SELECT password FROM e_users WHERE id=?', user.id));
      if (!verifyPassword(String(body.current || ''), row.password)) throw new HttpError(400, 'گذرواژه فعلی نادرست است');
      if (typeof body.next !== 'string' || body.next.length < 8) throw bad('گذرواژه جدید حداقل ۸ نویسه باشد');
      (await db.run('UPDATE e_users SET password=? WHERE id=?', hashPassword(body.next), user.id));
      return json(res, 200, { ok: true });
    }

    // ── مدیریت شرکت‌ها (فقط مدیر کل) ──
    if (route[0] === 'companies') {
      if (user.role !== 'superadmin') throw new HttpError(403, 'دسترسی ندارید');
      if (method === 'GET') {
        const out = [];
        for (const c of await db.all('SELECT * FROM companies ORDER BY id DESC')) out.push({ ...c, modules: JSON.parse(c.modules), users: (await db.get('SELECT COUNT(*) n FROM e_users WHERE company_id=?', c.id)).n });
        return json(res, 200, out);
      }
      if (method === 'POST') {
        const name = String(body.name || '').trim();
        if (!name) throw bad('نام شرکت الزامی است');
        const mods = validModules(body.modules);
        const r = await db.tx(async (t) => {
          const id = await t.insert('INSERT INTO companies (name,currency,modules) VALUES (?,?,?)', name, String(body.currency || 'ریال').slice(0, 20), JSON.stringify(mods));
          await ACC.seedChart(t, id);
          const c2 = { db: t, companyId: id, user };
          await engine.create(c2, ENTITIES.users, { username: body.admin_username, name: body.admin_name || 'مدیر شرکت', role: 'admin', password: body.admin_password, active: 1 });
          return id;
        });
        return json(res, 201, { id: r });
      }
      if (method === 'PUT' && route[1]) {
        const c = (await db.get('SELECT * FROM companies WHERE id=?', Number(route[1])));
        if (!c) throw new HttpError(404, 'شرکت یافت نشد');
        (await db.run('UPDATE companies SET name=?, currency=?, modules=?, active=? WHERE id=?', String(body.name ?? c.name).trim() || c.name, String(body.currency ?? c.currency).slice(0, 20),
          body.modules ? JSON.stringify(validModules(body.modules)) : c.modules, body.active === undefined ? c.active : (body.active ? 1 : 0), c.id));
        return json(res, 200, { ok: true });
      }
    }
    if (route[0] === 'company' && method === 'PUT') {
      if (!can(user.role, 'admin', 'e') || !ctx.companyId) throw new HttpError(403, 'دسترسی ندارید');
      let lock = ctx.company.lock_date;
      if (body.lock_date !== undefined) { if (body.lock_date && !isoDate(body.lock_date)) throw bad('تاریخ بستن دوره نامعتبر است'); lock = body.lock_date || null; }
      (await db.run('UPDATE companies SET name=?, currency=?, lock_date=? WHERE id=?', String(body.name || '').trim() || ctx.company.name, String(body.currency || ctx.company.currency).slice(0, 20), lock, ctx.companyId));
      return json(res, 200, { ok: true });
    }

    // از اینجا به بعد باید شرکت فعال مشخص باشد
    if (!ctx.companyId) throw new HttpError(400, 'ابتدا یک شرکت را انتخاب کنید');

    if (route[0] === 'entities' && route[1]) {
      const def = ENTITIES[route[1]];
      if (!def) throw new HttpError(404, 'یافت نشد');
      requireModule(ctx, def);
      const id = route[2]; const sub = route[3];
      if (!id && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, await engine.list(ctx, def, Object.fromEntries(url.searchParams))); }
      if (!id && method === 'POST') { need(ctx, def, 'c'); if (def.noCreate) throw new HttpError(405, 'این مورد به‌صورت دستی ساخته نمی‌شود'); return json(res, 201, await tx(ctx, (c) => engine.create(c, def, body))); }
      if (id === 'lookup' && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, await engine.lookup(ctx, def)); }
      if (id && !sub && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, await engine.getOne(ctx, def, id)); }
      if (id && !sub && method === 'PUT') { need(ctx, def, 'e'); return json(res, 200, await tx(ctx, (c) => engine.update(c, def, id, body))); }
      if (id && !sub && method === 'DELETE') { need(ctx, def, 'd'); return json(res, 200, await tx(ctx, (c) => engine.remove(c, def, id))); }
      if (id && sub === 'actions' && route[4] && method === 'POST') { need(ctx, def, 'e'); return json(res, 200, await tx(ctx, (c) => engine.runAction(c, def, id, route[4]))); }
    }
    if (route[0] === 'accounting' && route[1] === 'close-year' && method === 'POST') {
      if (!moduleOn(ctx, 'accounting') || !can(user.role, 'accounting', 'c') || !can(user.role, 'accounting', 'e')) throw new HttpError(403, 'دسترسی ندارید');
      return json(res, 200, await tx(ctx, async (c) => { const r = await ACC.closeYear(c, body.date); await engine.audit(c, 'accounting', null, 'close-year', body.date); return r; }));
    }
    if (route[0] === 'maintenance' && route[1] === 'generate' && method === 'POST') {
      if (!moduleOn(ctx, 'production') || !can(user.role, 'production', 'c')) throw new HttpError(403, 'دسترسی ندارید');
      const made = await tx(ctx, async (c) => { const out = []; for (const m of await pmDue(c)) out.push(await engine.create(c, ENTITIES.maintenance_orders, { machine_id: m.id, kind: 'preventive', description: `سرویس دوره‌ای ${m.name}`, planned_date: m.next_pm_date })); return out; });
      return json(res, 200, { created: made.length });
    }
    if (route[0] === 'export' && route[1] && method === 'GET') {
      const def = ENTITIES[route[1]];
      if (!def || def.key === 'users') throw new HttpError(404, 'یافت نشد');
      requireModule(ctx, def); need(ctx, def, 'v');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${def.key}.csv"` });
      return res.end(await engine.toCsv(ctx, def));
    }
    if (route[0] === 'attachments') return attachments(ctx, route, method, url, body, res);
    if (route[0] === 'dashboard' && method === 'GET') return json(res, 200, await dashboard(ctx));
    if (route[0] === 'reports' && method === 'GET') return json(res, 200, await report(ctx, route[1], false, Object.fromEntries(url.searchParams)));
    if (route[0] === 'audit' && method === 'GET') {
      if (!can(user.role, 'admin', 'v')) throw new HttpError(403, 'دسترسی ندارید');
      return json(res, 200, (await db.all('SELECT * FROM audit_log WHERE company_id=? ORDER BY id DESC LIMIT 300', ctx.companyId)));
    }
    throw new HttpError(404, 'مسیر یافت نشد');
  }

  // ─── پیوست فایل ───
  async function attachments(ctx, route, method, url, body, res) {
    const user = ctx.user, q = url.searchParams;
    const target = async (entity, id, acts) => {
      const def = ENTITIES[entity];
      if (!def || def.key === 'users') throw new HttpError(404, 'یافت نشد');
      requireModule(ctx, def);
      if (!acts.some((a) => can(user.role, def.module, a))) throw new HttpError(403, 'دسترسی لازم را ندارید');
      const rec = await engine.getRow(ctx, def, id);
      if (!rec) throw new HttpError(404, 'رکورد یافت نشد');
      return def;
    };
    if (!route[1] && method === 'GET') {
      await target(q.get('entity'), q.get('id'), ['v']);
      return json(res, 200, await ctx.db.all('SELECT id,name,mime,size,created_by_name,created_at FROM attachments WHERE company_id=? AND entity=? AND rec_id=? ORDER BY id', ctx.companyId, q.get('entity'), Number(q.get('id'))));
    }
    if (!route[1] && method === 'POST') {
      const def = await target(q.get('entity'), q.get('id'), ['c', 'e']);
      let name = String(q.get('name') || '').replace(/[\/\\\u0000-\u001f]/g, '_').trim().slice(-150);
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!name || !ALLOWED[ext] || !name.includes('.')) throw bad(`نوع فایل مجاز نیست (مجاز: ${Object.keys(ALLOWED).join('، ')})`);
      if (!Buffer.isBuffer(body) || !body.length) throw bad('فایل خالی است');
      const count = (await ctx.db.get('SELECT COUNT(*) n FROM attachments WHERE company_id=? AND entity=? AND rec_id=?', ctx.companyId, def.key, Number(q.get('id')))).n;
      if (count >= 25) throw new HttpError(409, 'حداکثر ۲۵ پیوست برای هر رکورد مجاز است');
      const stored = saveFile(ctx.companyId, body);
      try {
        const id = await tx(ctx, async (c) => {
          const id = await c.db.insert('INSERT INTO attachments (company_id,entity,rec_id,name,mime,size,sha256,stored,created_by,created_by_name) VALUES (?,?,?,?,?,?,?,?,?,?)',
            ctx.companyId, def.key, Number(q.get('id')), name, ALLOWED[ext], body.length, crypto.createHash('sha256').update(body).digest('hex'), stored, user.id, user.name);
          await engine.audit(c, def.key, Number(q.get('id')), 'attach', name);
          return id;
        });
        return json(res, 201, { id, name, size: body.length });
      } catch (e) { deleteFile(stored); throw e; }
    }
    const att = route[1] && await ctx.db.get('SELECT * FROM attachments WHERE id=? AND company_id=?', Number(route[1]), ctx.companyId);
    if (!att) throw new HttpError(404, 'پیوست یافت نشد');
    if (method === 'GET') {
      await target(att.entity, att.rec_id, ['v']);
      const data = fs.readFileSync(filePath(att.stored));
      res.writeHead(200, { 'Content-Type': att.mime || 'application/octet-stream', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`, 'Cache-Control': 'private, no-store' });
      return res.end(data);
    }
    if (method === 'DELETE') {
      await target(att.entity, att.rec_id, ['e']);
      await tx(ctx, async (c) => { await c.db.run('DELETE FROM attachments WHERE id=? AND company_id=?', att.id, ctx.companyId); await engine.audit(c, att.entity, att.rec_id, 'detach', att.name); });
      deleteFile(att.stored);
      return json(res, 200, { ok: true });
    }
    throw new HttpError(405, 'روش نامعتبر');
  }

  async function authenticate(req) {
    const cookie = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
    const tok = readToken(cookie[COOKIE]);
    const u = tok && (await db.get('SELECT id,company_id,username,name,role,active FROM e_users WHERE id=?', tok.uid));
    if (!u || !u.active) throw new HttpError(401, 'نشست منقضی شده است');
    let companyId = u.company_id;
    if (u.role === 'superadmin') {
      const h = parseInt(req.headers['x-company']);
      companyId = h && (await db.get('SELECT 1 FROM companies WHERE id=?', h)) ? h : null;
    }
    const company = companyId ? (await db.get('SELECT * FROM companies WHERE id=?', companyId)) : null;
    if (u.role !== 'superadmin' && (!company || !company.active)) throw new HttpError(401, 'شرکت غیرفعال است');
    return { db, user: u, companyId, company: company && { ...company, modules: JSON.parse(company.modules) } };
  }

  function moduleOn(ctx, m) { return m === 'admin' || ctx.company?.modules.includes(m); }
  function requireModule(ctx, def) { if (!moduleOn(ctx, def.module)) throw new HttpError(403, 'این ماژول برای شرکت شما فعال نیست'); }
  function need(ctx, def, act) { if (!can(ctx.user.role, def.module, act)) throw new HttpError(403, 'دسترسی لازم را ندارید'); }

  function meInfo(ctx) {
    const u = ctx.user;
    const modules = Object.entries(MODULES).filter(([m]) => ctx.companyId ? moduleOn(ctx, m) && can(u.role, m, 'v') : false)
      .map(([key, v]) => ({ key, ...v, entities: Object.values(ENTITIES).filter((d) => d.module === key).map((d) => d.key) }));
    const perms = {};
    for (const m of Object.keys(MODULES)) perms[m] = ['v', 'c', 'e', 'd'].filter((a) => can(u.role, m, a)).join('');
    return {
      user: { id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLES[u.role]?.label },
      company: ctx.company ? { id: ctx.company.id, name: ctx.company.name, currency: ctx.company.currency, lock_date: ctx.company.lock_date } : null,
      modules, perms, isSuper: u.role === 'superadmin',
      allModules: Object.entries(MODULES).filter(([k]) => k !== 'admin').map(([key, v]) => ({ key, title: v.title })),
      meta: Object.fromEntries(Object.values(ENTITIES).map((d) => [d.key, publicMeta(d)])),
    };
  }

  async function dashboard(ctx) {
    const c = ctx.companyId, u = ctx.user, d = { cards: [], charts: {} };
    const one = (sql, ...a) => ctx.db.get(sql, c, ...a);
    const has = (m) => moduleOn(ctx, m) && can(u.role, m, 'v');
    const add = (key, label, value, extra = {}) => d.cards.push({ key, label, value, ...extra });
    if (has('hr')) add('emp', 'کارکنان شاغل', (await one(`SELECT COUNT(*) n FROM e_employees WHERE company_id=? AND status='active'`)).n, { link: 'employees' });
    if (has('hr')) add('leave', 'مرخصی در انتظار تأیید', (await one(`SELECT COUNT(*) n FROM e_leaves WHERE company_id=? AND status='pending'`)).n, { link: 'leaves', warn: true });
    if (has('inventory')) {
      const low = (await db.get(`SELECT COUNT(*) n FROM (SELECT i.id, i.min_stock, COALESCE((SELECT SUM(CASE kind WHEN 'in' THEN qty ELSE -qty END) FROM e_stock_moves m WHERE m.item_id=i.id AND m.company_id=i.company_id),0) s
        FROM e_items i WHERE i.company_id=? AND i.status='active') WHERE s <= min_stock AND min_stock > 0`, c)).n;
      add('low', 'کالاهای زیر حداقل موجودی', low, { link: 'report:stock', warn: low > 0 });
    }
    if (has('purchasing')) add('po', 'سفارش خرید باز', (await one(`SELECT COUNT(*) n FROM e_purchase_orders WHERE company_id=? AND status IN ('draft','approved')`)).n, { link: 'purchase_orders' });
    if (has('sales')) {
      const month = new Date().toISOString().slice(0, 7);
      add('sales', 'فروش ماه جاری', (await one(`SELECT COALESCE(SUM(total),0) n FROM e_sales_orders WHERE company_id=? AND status='shipped' AND substr(date,1,7)=?`, month)).n, { money: true, link: 'sales_orders' });
      add('so', 'سفارش فروش باز', (await one(`SELECT COUNT(*) n FROM e_sales_orders WHERE company_id=? AND status IN ('draft','confirmed')`)).n, { link: 'sales_orders' });
      const rows = (await db.all(`SELECT substr(date,1,7) m, SUM(total) v FROM e_sales_orders WHERE company_id=? AND status='shipped' GROUP BY m ORDER BY m DESC LIMIT 6`, c)).reverse();
      d.charts.sales = rows;
    }
    if (has('finance')) {
      const rec = await report(ctx, 'balances', true);
      add('ar', 'مطالبات از مشتریان', rec.customers.reduce((s, x) => s + Math.max(x.balance, 0), 0), { money: true, link: 'report:balances' });
      add('ap', 'بدهی به تأمین‌کنندگان', rec.suppliers.reduce((s, x) => s + Math.max(x.balance, 0), 0), { money: true, link: 'report:balances' });
    }
    if (has('accounting')) {
      const cash = (await one(`SELECT COALESCE(SUM(g.debit-g.credit),0) n FROM gl_lines g JOIN e_accounts a ON a.id=g.account_id WHERE g.company_id=? AND a.sys_key IN ('cash','bank')`)).n;
      add('cash', 'موجودی نقد و بانک (دفتر کل)', cash, { money: true, link: 'report:trial' });
      const y = new Date().getFullYear() + '-01-01';
      add('net', 'سود (زیان) خالص از ابتدای سال میلادی', (await ACC.incomeStatement(ctx, { from: y })).netIncome, { money: true, link: 'report:income' });
    }
    if (has('production')) { const pm = (await pmRows(ctx)).filter((r) => r.pm_state === 'overdue' || r.pm_state === 'soon').length; add('pm', 'ماشین‌های نیازمند PM (≤۷ روز)', pm, { link: 'report:pm', warn: pm > 0 }); }
    if (has('production')) add('wo', 'دستورهای تولید باز', (await one(`SELECT COUNT(*) n FROM e_work_orders WHERE company_id=? AND status IN ('draft','released')`)).n, { link: 'work_orders' });
    if (has('projects')) {
      add('prj', 'پروژه‌های در حال اجرا', (await one(`SELECT COUNT(*) n FROM e_projects WHERE company_id=? AND status='active'`)).n, { link: 'projects' });
      const od = (await one(`SELECT COUNT(*) n FROM e_tasks WHERE company_id=? AND status!='done' AND due_date < date('now')`)).n;
      add('od', 'وظایف دارای تأخیر', od, { link: 'tasks', warn: od > 0 });
      d.charts.tasks = (await db.all(`SELECT status k, COUNT(*) v FROM e_tasks WHERE company_id=? GROUP BY status`, c));
    }
    if (has('quality')) {
      add('ncr', 'NCR باز', (await one(`SELECT COUNT(*) n FROM e_ncr WHERE company_id=? AND status!='closed'`)).n, { link: 'ncr', warn: true });
      d.charts.ncr = (await db.all(`SELECT severity k, COUNT(*) v FROM e_ncr WHERE company_id=? AND status!='closed' GROUP BY severity`, c));
    }
    return d;
  }

  async function report(ctx, name, internal, params = {}) {
    const c = ctx.companyId, u = ctx.user;
    const acctRep = { trial: ACC.trialBalance, ledger: ACC.ledger, income: ACC.incomeStatement, balance: ACC.balanceSheet, party: ACC.partyReport };
    if (acctRep[name]) {
      if (!(moduleOn(ctx, 'accounting') && can(u.role, 'accounting', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      return acctRep[name](ctx, params);
    }
    if (['mrp', 'capacity', 'pm'].includes(name)) {
      if (!(moduleOn(ctx, 'production') && can(u.role, 'production', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      return name === 'mrp' ? await mrp(ctx) : name === 'capacity' ? await capacity(ctx) : { rows: await pmRows(ctx) };
    }
    if (name === 'stock') {
      if (!internal && !(moduleOn(ctx, 'inventory') && can(u.role, 'inventory', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      const rows = (await db.all(`SELECT i.id, i.code, i.name, i.unit, i.min_stock, i.cost, w.id wid, w.name warehouse,
          SUM(CASE m.kind WHEN 'in' THEN m.qty ELSE -m.qty END) qty
        FROM e_items i LEFT JOIN e_stock_moves m ON m.item_id=i.id AND m.company_id=i.company_id
        LEFT JOIN e_warehouses w ON w.id=m.warehouse_id WHERE i.company_id=? GROUP BY i.id, w.id ORDER BY i.code, w.name`, c));
      const items = new Map();
      for (const r of rows) {
        const it = items.get(r.id) || { id: r.id, code: r.code, name: r.name, unit: r.unit, min_stock: r.min_stock, cost: r.cost || 0, total: 0, by: [] };
        if (r.wid) { it.by.push({ warehouse: r.warehouse, qty: r.qty }); it.total += r.qty; }
        items.set(r.id, it);
      }
      return { items: [...items.values()].map((i) => ({ ...i, value: Math.round(i.total * i.cost), low: i.min_stock > 0 && i.total <= i.min_stock })) };
    }
    if (name === 'balances') {
      if (!internal && !(moduleOn(ctx, 'finance') && can(u.role, 'finance', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      const customers = [], suppliers = [];
      for (const x of await db.all('SELECT id,name FROM e_customers WHERE company_id=?', c)) { const balance = await customerBalance(db, c, x.id); if (balance !== 0) customers.push({ ...x, balance }); }
      for (const x of await db.all('SELECT id,name FROM e_suppliers WHERE company_id=?', c)) {
        const bought = (await db.get(`SELECT COALESCE(SUM(total),0) s FROM e_purchase_orders WHERE company_id=? AND supplier_id=? AND status IN ('approved','received')`, c, x.id)).s;
        const paid = (await db.get(`SELECT COALESCE(SUM(amount),0) s FROM e_payments WHERE company_id=? AND supplier_id=? AND kind='payment'`, c, x.id)).s;
        if (bought - paid !== 0) suppliers.push({ ...x, balance: bought - paid });
      }
      return { customers, suppliers };
    }
    throw new HttpError(404, 'گزارش یافت نشد');
  }

  return { server, db };
}

async function upgrade(db) {
  const v = await schemaVersion(db);
  const addModules = async (...keys) => {
    for (const c of await db.all('SELECT id,modules FROM companies')) {
      const m = new Set(JSON.parse(c.modules)); keys.forEach((k) => m.add(k));
      await db.run('UPDATE companies SET modules=? WHERE id=?', JSON.stringify([...m]), c.id);
    }
  };
  if (v < 2) await addModules('accounting', 'production'); // نسخه‌ی ۲: حسابداری و تولید
  if (v < 3) await addModules('payroll');                  // نسخه‌ی ۳: حقوق‌ودستمزد
  await setSchemaVersion(db, 3);
  for (const c of await db.all('SELECT id FROM companies')) await ACC.seedChart(db, c.id);
}

function validModules(m) {
  const all = allModuleKeys();
  if (!Array.isArray(m)) return all;
  return m.filter((x) => all.includes(x));
}

async function bootstrapSuperadmin(db, quiet) {
  if ((await db.get('SELECT 1 FROM e_users LIMIT 1'))) return;
  const pw = process.env.ERP_SUPERADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  (await db.run(`INSERT INTO e_users (company_id,username,name,role,password,active) VALUES (NULL,'superadmin','مدیر کل سامانه','superadmin',?,1)`, hashPassword(pw)));
  if (!quiet) console.log(`\n  حساب مدیر کل ایجاد شد:\n    نام کاربری: superadmin\n    گذرواژه:    ${pw}\n  (آن را یادداشت و پس از ورود تغییر دهید)\n`);
}

function secHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let tooBig = false;
    req.on('data', (c) => { size += c.length; if (size > max) { tooBig = true; if (size > max * 4) req.destroy(); } else chunks.push(c); });
    req.on('end', () => (tooBig ? reject(new HttpError(413, `حجم فایل بیش از ${Math.round(max / 1048576)} مگابایت است`)) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1_000_000) { reject(new HttpError(413, 'حجم درخواست زیاد است')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString()); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(bad('JSON نامعتبر')); }
    });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('یافت نشد');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`  ERP در حال اجرا: http://localhost:${port}`));
}
