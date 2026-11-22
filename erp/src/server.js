import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, tx, allModuleKeys } from './db.js';
import { ENTITIES, MODULES, publicMeta, customerBalance } from './entities.js';
import { initSecret, signToken, readToken, verifyPassword, hashPassword, can, ROLES } from './auth.js';
import * as engine from './engine.js';
import { HttpError, bad, isoDate } from './util.js';
import * as ACC from './accounting.js';
import { mrp, capacity, pmRows, pmDue } from './industry.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dir, '..', 'public');
const COOKIE = 'erp_session';

export function createApp({ dataDir, quiet } = {}) {
  dataDir = dataDir || process.env.ERP_DATA_DIR || path.join(__dir, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  initSecret(dataDir);
  const db = openDb(path.join(dataDir, 'erp.db'));
  migrate(db);
  upgrade(db);
  bootstrapSuperadmin(db, quiet);

  const fails = new Map(); // محدودسازی تلاش ورود
  const throttleKey = (req, u) => `${req.socket.remoteAddress}|${String(u).toLowerCase()}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      secHeaders(res);
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? 'خطای داخلی سرور' : e.message });
    }
  });

  async function handleApi(req, res, url) {
    const route = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
    const method = req.method;
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating && req.headers['x-erp'] !== '1') throw new HttpError(403, 'درخواست نامعتبر');
    const body = mutating ? await readJson(req) : {};

    if (route[0] === 'login' && method === 'POST') {
      const k = throttleKey(req, body.username);
      const f = fails.get(k);
      if (f && f.n >= 8 && Date.now() - f.t < 5 * 60000) throw new HttpError(429, 'تلاش‌های ناموفق زیاد؛ چند دقیقه بعد دوباره امتحان کنید');
      const u = db.prepare('SELECT * FROM e_users WHERE username=?').get(String(body.username || ''));
      const co = u?.company_id ? db.prepare('SELECT active FROM companies WHERE id=?').get(u.company_id) : null;
      const ok = u && verifyPassword(String(body.password || ''), u.password) && u.active && (!u.company_id || co?.active);
      if (!ok) {
        fails.set(k, { n: (f?.n || 0) + 1, t: Date.now() });
        if (!u) verifyPassword('x', 's1$00$00'); // یکسان‌سازی زمان پاسخ
        throw new HttpError(401, 'نام کاربری یا گذرواژه نادرست است');
      }
      fails.delete(k);
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${signToken(u.id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
      engine.audit({ db, companyId: u.company_id, user: { id: u.id, username: u.username } }, 'auth', u.id, 'login');
      return json(res, 200, { ok: true });
    }
    if (route[0] === 'logout' && method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return json(res, 200, { ok: true });
    }

    const ctx = authenticate(req);
    const user = ctx.user;

    if (route[0] === 'me' && method === 'GET') return json(res, 200, meInfo(ctx));
    if (route[0] === 'password' && method === 'POST') {
      const row = db.prepare('SELECT password FROM e_users WHERE id=?').get(user.id);
      if (!verifyPassword(String(body.current || ''), row.password)) throw new HttpError(400, 'گذرواژه فعلی نادرست است');
      if (typeof body.next !== 'string' || body.next.length < 8) throw bad('گذرواژه جدید حداقل ۸ نویسه باشد');
      db.prepare('UPDATE e_users SET password=? WHERE id=?').run(hashPassword(body.next), user.id);
      return json(res, 200, { ok: true });
    }

    // ── مدیریت شرکت‌ها (فقط مدیر کل) ──
    if (route[0] === 'companies') {
      if (user.role !== 'superadmin') throw new HttpError(403, 'دسترسی ندارید');
      if (method === 'GET') return json(res, 200, db.prepare('SELECT * FROM companies ORDER BY id DESC').all().map((c) => ({
        ...c, modules: JSON.parse(c.modules), users: db.prepare('SELECT COUNT(*) n FROM e_users WHERE company_id=?').get(c.id).n })));
      if (method === 'POST') {
        const name = String(body.name || '').trim();
        if (!name) throw bad('نام شرکت الزامی است');
        const mods = validModules(body.modules);
        const r = tx(db, () => {
          const id = Number(db.prepare('INSERT INTO companies (name,currency,modules) VALUES (?,?,?)').run(name, String(body.currency || 'ریال').slice(0, 20), JSON.stringify(mods)).lastInsertRowid);
          ACC.seedChart(db, id);
          const c2 = { db, companyId: id, user };
          engine.create(c2, ENTITIES.users, { username: body.admin_username, name: body.admin_name || 'مدیر شرکت', role: 'admin', password: body.admin_password, active: 1 });
          return id;
        });
        return json(res, 201, { id: r });
      }
      if (method === 'PUT' && route[1]) {
        const c = db.prepare('SELECT * FROM companies WHERE id=?').get(Number(route[1]));
        if (!c) throw new HttpError(404, 'شرکت یافت نشد');
        db.prepare('UPDATE companies SET name=?, currency=?, modules=?, active=? WHERE id=?').run(
          String(body.name ?? c.name).trim() || c.name, String(body.currency ?? c.currency).slice(0, 20),
          body.modules ? JSON.stringify(validModules(body.modules)) : c.modules, body.active === undefined ? c.active : (body.active ? 1 : 0), c.id);
        return json(res, 200, { ok: true });
      }
    }
    if (route[0] === 'company' && method === 'PUT') {
      if (!can(user.role, 'admin', 'e') || !ctx.companyId) throw new HttpError(403, 'دسترسی ندارید');
      let lock = ctx.company.lock_date;
      if (body.lock_date !== undefined) { if (body.lock_date && !isoDate(body.lock_date)) throw bad('تاریخ بستن دوره نامعتبر است'); lock = body.lock_date || null; }
      db.prepare('UPDATE companies SET name=?, currency=?, lock_date=? WHERE id=?').run(String(body.name || '').trim() || ctx.company.name, String(body.currency || ctx.company.currency).slice(0, 20), lock, ctx.companyId);
      return json(res, 200, { ok: true });
    }

    // از اینجا به بعد باید شرکت فعال مشخص باشد
    if (!ctx.companyId) throw new HttpError(400, 'ابتدا یک شرکت را انتخاب کنید');

    if (route[0] === 'entities' && route[1]) {
      const def = ENTITIES[route[1]];
      if (!def) throw new HttpError(404, 'یافت نشد');
      requireModule(ctx, def);
      const id = route[2]; const sub = route[3];
      if (!id && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, engine.list(ctx, def, Object.fromEntries(url.searchParams))); }
      if (!id && method === 'POST') { need(ctx, def, 'c'); return json(res, 201, tx(db, () => engine.create(ctx, def, body))); }
      if (id === 'lookup' && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, engine.lookup(ctx, def)); }
      if (id && !sub && method === 'GET') { need(ctx, def, 'v'); return json(res, 200, engine.getOne(ctx, def, id)); }
      if (id && !sub && method === 'PUT') { need(ctx, def, 'e'); return json(res, 200, tx(db, () => engine.update(ctx, def, id, body))); }
      if (id && !sub && method === 'DELETE') { need(ctx, def, 'd'); return json(res, 200, tx(db, () => engine.remove(ctx, def, id))); }
      if (id && sub === 'actions' && route[4] && method === 'POST') { need(ctx, def, 'e'); return json(res, 200, tx(db, () => engine.runAction(ctx, def, id, route[4]))); }
    }
    if (route[0] === 'accounting' && route[1] === 'close-year' && method === 'POST') {
      if (!moduleOn(ctx, 'accounting') || !can(user.role, 'accounting', 'c') || !can(user.role, 'accounting', 'e')) throw new HttpError(403, 'دسترسی ندارید');
      return json(res, 200, tx(db, () => { const r = ACC.closeYear(ctx, body.date); engine.audit(ctx, 'accounting', null, 'close-year', body.date); return r; }));
    }
    if (route[0] === 'maintenance' && route[1] === 'generate' && method === 'POST') {
      if (!moduleOn(ctx, 'production') || !can(user.role, 'production', 'c')) throw new HttpError(403, 'دسترسی ندارید');
      const made = tx(db, () => pmDue(ctx).map((m) => engine.create(ctx, ENTITIES.maintenance_orders, { machine_id: m.id, kind: 'preventive', description: `سرویس دوره‌ای ${m.name}`, planned_date: m.next_pm_date })));
      return json(res, 200, { created: made.length });
    }
    if (route[0] === 'export' && route[1] && method === 'GET') {
      const def = ENTITIES[route[1]];
      if (!def || def.key === 'users') throw new HttpError(404, 'یافت نشد');
      requireModule(ctx, def); need(ctx, def, 'v');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${def.key}.csv"` });
      return res.end(engine.toCsv(ctx, def));
    }
    if (route[0] === 'dashboard' && method === 'GET') return json(res, 200, dashboard(ctx));
    if (route[0] === 'reports' && method === 'GET') return json(res, 200, report(ctx, route[1], false, Object.fromEntries(url.searchParams)));
    if (route[0] === 'audit' && method === 'GET') {
      if (!can(user.role, 'admin', 'v')) throw new HttpError(403, 'دسترسی ندارید');
      return json(res, 200, db.prepare('SELECT * FROM audit_log WHERE company_id=? ORDER BY id DESC LIMIT 300').all(ctx.companyId));
    }
    throw new HttpError(404, 'مسیر یافت نشد');
  }

  function authenticate(req) {
    const cookie = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
    const tok = readToken(cookie[COOKIE]);
    const u = tok && db.prepare('SELECT id,company_id,username,name,role,active FROM e_users WHERE id=?').get(tok.uid);
    if (!u || !u.active) throw new HttpError(401, 'نشست منقضی شده است');
    let companyId = u.company_id;
    if (u.role === 'superadmin') {
      const h = parseInt(req.headers['x-company']);
      companyId = h && db.prepare('SELECT 1 FROM companies WHERE id=?').get(h) ? h : null;
    }
    const company = companyId ? db.prepare('SELECT * FROM companies WHERE id=?').get(companyId) : null;
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

  function dashboard(ctx) {
    const c = ctx.companyId, u = ctx.user, d = { cards: [], charts: {} };
    const one = (sql, ...a) => db.prepare(sql).get(c, ...a);
    const has = (m) => moduleOn(ctx, m) && can(u.role, m, 'v');
    const add = (key, label, value, extra = {}) => d.cards.push({ key, label, value, ...extra });
    if (has('hr')) add('emp', 'کارکنان شاغل', one(`SELECT COUNT(*) n FROM e_employees WHERE company_id=? AND status='active'`).n, { link: 'employees' });
    if (has('hr')) add('leave', 'مرخصی در انتظار تأیید', one(`SELECT COUNT(*) n FROM e_leaves WHERE company_id=? AND status='pending'`).n, { link: 'leaves', warn: true });
    if (has('inventory')) {
      const low = db.prepare(`SELECT COUNT(*) n FROM (SELECT i.id, i.min_stock, COALESCE((SELECT SUM(CASE kind WHEN 'in' THEN qty ELSE -qty END) FROM e_stock_moves m WHERE m.item_id=i.id AND m.company_id=i.company_id),0) s
        FROM e_items i WHERE i.company_id=? AND i.status='active') WHERE s <= min_stock AND min_stock > 0`).get(c).n;
      add('low', 'کالاهای زیر حداقل موجودی', low, { link: 'report:stock', warn: low > 0 });
    }
    if (has('purchasing')) add('po', 'سفارش خرید باز', one(`SELECT COUNT(*) n FROM e_purchase_orders WHERE company_id=? AND status IN ('draft','approved')`).n, { link: 'purchase_orders' });
    if (has('sales')) {
      const month = new Date().toISOString().slice(0, 7);
      add('sales', 'فروش ماه جاری', one(`SELECT COALESCE(SUM(total),0) n FROM e_sales_orders WHERE company_id=? AND status='shipped' AND substr(date,1,7)=?`, month).n, { money: true, link: 'sales_orders' });
      add('so', 'سفارش فروش باز', one(`SELECT COUNT(*) n FROM e_sales_orders WHERE company_id=? AND status IN ('draft','confirmed')`).n, { link: 'sales_orders' });
      const rows = db.prepare(`SELECT substr(date,1,7) m, SUM(total) v FROM e_sales_orders WHERE company_id=? AND status='shipped' GROUP BY m ORDER BY m DESC LIMIT 6`).all(c).reverse();
      d.charts.sales = rows;
    }
    if (has('finance')) {
      const rec = report(ctx, 'balances', true);
      add('ar', 'مطالبات از مشتریان', rec.customers.reduce((s, x) => s + Math.max(x.balance, 0), 0), { money: true, link: 'report:balances' });
      add('ap', 'بدهی به تأمین‌کنندگان', rec.suppliers.reduce((s, x) => s + Math.max(x.balance, 0), 0), { money: true, link: 'report:balances' });
    }
    if (has('accounting')) {
      const cash = one(`SELECT COALESCE(SUM(g.debit-g.credit),0) n FROM gl_lines g JOIN e_accounts a ON a.id=g.account_id WHERE g.company_id=? AND a.sys_key IN ('cash','bank')`).n;
      add('cash', 'موجودی نقد و بانک (دفتر کل)', cash, { money: true, link: 'report:trial' });
      const y = new Date().getFullYear() + '-01-01';
      add('net', 'سود (زیان) خالص از ابتدای سال میلادی', ACC.incomeStatement(ctx, { from: y }).netIncome, { money: true, link: 'report:income' });
    }
    if (has('production')) { const pm = pmRows(ctx).filter((r) => r.pm_state === 'overdue' || r.pm_state === 'soon').length; add('pm', 'ماشین‌های نیازمند PM (≤۷ روز)', pm, { link: 'report:pm', warn: pm > 0 }); }
    if (has('production')) add('wo', 'دستورهای تولید باز', one(`SELECT COUNT(*) n FROM e_work_orders WHERE company_id=? AND status IN ('draft','released')`).n, { link: 'work_orders' });
    if (has('projects')) {
      add('prj', 'پروژه‌های در حال اجرا', one(`SELECT COUNT(*) n FROM e_projects WHERE company_id=? AND status='active'`).n, { link: 'projects' });
      const od = one(`SELECT COUNT(*) n FROM e_tasks WHERE company_id=? AND status!='done' AND due_date < date('now')`).n;
      add('od', 'وظایف دارای تأخیر', od, { link: 'tasks', warn: od > 0 });
      d.charts.tasks = db.prepare(`SELECT status k, COUNT(*) v FROM e_tasks WHERE company_id=? GROUP BY status`).all(c);
    }
    if (has('quality')) {
      add('ncr', 'NCR باز', one(`SELECT COUNT(*) n FROM e_ncr WHERE company_id=? AND status!='closed'`).n, { link: 'ncr', warn: true });
      d.charts.ncr = db.prepare(`SELECT severity k, COUNT(*) v FROM e_ncr WHERE company_id=? AND status!='closed' GROUP BY severity`).all(c);
    }
    return d;
  }

  function report(ctx, name, internal, params = {}) {
    const c = ctx.companyId, u = ctx.user;
    const acctRep = { trial: ACC.trialBalance, ledger: ACC.ledger, income: ACC.incomeStatement, balance: ACC.balanceSheet, party: ACC.partyReport };
    if (acctRep[name]) {
      if (!(moduleOn(ctx, 'accounting') && can(u.role, 'accounting', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      return acctRep[name](ctx, params);
    }
    if (['mrp', 'capacity', 'pm'].includes(name)) {
      if (!(moduleOn(ctx, 'production') && can(u.role, 'production', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      return name === 'mrp' ? mrp(ctx) : name === 'capacity' ? capacity(ctx) : { rows: pmRows(ctx) };
    }
    if (name === 'stock') {
      if (!internal && !(moduleOn(ctx, 'inventory') && can(u.role, 'inventory', 'v'))) throw new HttpError(403, 'دسترسی ندارید');
      const rows = db.prepare(`SELECT i.id, i.code, i.name, i.unit, i.min_stock, i.cost, w.id wid, w.name warehouse,
          SUM(CASE m.kind WHEN 'in' THEN m.qty ELSE -m.qty END) qty
        FROM e_items i LEFT JOIN e_stock_moves m ON m.item_id=i.id AND m.company_id=i.company_id
        LEFT JOIN e_warehouses w ON w.id=m.warehouse_id WHERE i.company_id=? GROUP BY i.id, w.id ORDER BY i.code, w.name`).all(c);
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
      const customers = db.prepare('SELECT id,name FROM e_customers WHERE company_id=?').all(c).map((x) => ({ ...x, balance: customerBalance(db, c, x.id) })).filter((x) => x.balance !== 0);
      const suppliers = db.prepare('SELECT id,name FROM e_suppliers WHERE company_id=?').all(c).map((x) => {
        const bought = db.prepare(`SELECT COALESCE(SUM(total),0) s FROM e_purchase_orders WHERE company_id=? AND supplier_id=? AND status IN ('approved','received')`).get(c, x.id).s;
        const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM e_payments WHERE company_id=? AND supplier_id=? AND kind='payment'`).get(c, x.id).s;
        return { ...x, balance: bought - paid };
      }).filter((x) => x.balance !== 0);
      return { customers, suppliers };
    }
    throw new HttpError(404, 'گزارش یافت نشد');
  }

  return { server, db };
}

function upgrade(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v < 2) { // نسخه‌ی ۲: ماژول‌های حسابداری و تولید به شرکت‌های موجود افزوده می‌شود
    for (const c of db.prepare('SELECT id,modules FROM companies').all()) {
      const m = new Set(JSON.parse(c.modules)); m.add('accounting'); m.add('production');
      db.prepare('UPDATE companies SET modules=? WHERE id=?').run(JSON.stringify([...m]), c.id);
    }
    db.exec('PRAGMA user_version=2');
  }
  for (const c of db.prepare('SELECT id FROM companies').all()) ACC.seedChart(db, c.id);
}

function validModules(m) {
  const all = allModuleKeys();
  if (!Array.isArray(m)) return all;
  return m.filter((x) => all.includes(x));
}

function bootstrapSuperadmin(db, quiet) {
  if (db.prepare('SELECT 1 FROM e_users LIMIT 1').get()) return;
  const pw = process.env.ERP_SUPERADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare(`INSERT INTO e_users (company_id,username,name,role,password,active) VALUES (NULL,'superadmin','مدیر کل سامانه','superadmin',?,1)`).run(hashPassword(pw));
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
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`  ERP در حال اجرا: http://localhost:${port}`));
}
