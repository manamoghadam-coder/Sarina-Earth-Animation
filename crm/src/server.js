'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, tx } = require('./db');
const A = require('./auth');
const R = require('./resources');
const { HttpError } = R;

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
};
const ROLES = ['admin', 'manager', 'sales'];
const vErr = (o) => new HttpError(422, 'خطای اعتبارسنجی', o);

function createApp(db) {
  ensureAdmin(db);

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 1e6) throw new HttpError(413, 'حجم درخواست زیاد است'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON نامعتبر است'); }
  }

  const routes = [];
  const route = (method, pattern, opts, fn) => {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, opts, fn });
  };
  const idOf = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'یافت نشد'); return n; };
  const need = (u, role) => { if (!A.hasRole(u, role)) throw new HttpError(403, 'دسترسی کافی ندارید'); };
  const actDef = (type) => {
    const def = Object.values(R.RESOURCES).find((d) => d.activityType === type);
    if (!def) throw new HttpError(400, 'نوع موجودیت نامعتبر است');
    return def;
  };

  // ---------- Auth ----------
  route('POST', '/api/auth/login', { public: true }, (ctx) => {
    const { username = '', password = '' } = ctx.body;
    const key = ctx.ip + '|' + String(username).toLowerCase();
    if (A.loginThrottle(key)) throw new HttpError(429, 'تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید');
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(username));
    const ok = A.verifyPassword(String(password), u ? u.password_hash : 'scrypt$00$00') && u;
    if (!ok) { A.loginFail(key); throw new HttpError(401, 'نام کاربری یا گذرواژه نادرست است'); }
    A.loginOk(key);
    ctx.setCookie(A.createSession(db, u.id), A.SESSION_TTL / 1000);
    R.audit(db, u, 'login');
    return { id: u.id, username: u.username, name: u.name, role: u.role };
  });
  route('POST', '/api/auth/logout', (ctx) => { A.destroySession(db, ctx.token); ctx.setCookie('', 0); return { ok: true }; });
  route('GET', '/api/auth/me', (ctx) => ctx.user);
  route('POST', '/api/auth/password', (ctx) => {
    const { current = '', password = '' } = ctx.body;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
    if (!A.verifyPassword(String(current), u.password_hash)) throw new HttpError(403, 'گذرواژه فعلی نادرست است');
    checkPassword(password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(password), u.id);
    A.destroyUserSessions(db, u.id);
    ctx.setCookie(A.createSession(db, u.id), A.SESSION_TTL / 1000);
    return { ok: true };
  });

  // ---------- Users (admin) ----------
  route('GET', '/api/users', (ctx) => {
    need(ctx.user, 'admin');
    return db.prepare('SELECT id,username,name,role,active,created_at FROM users ORDER BY id').all();
  });
  route('POST', '/api/users', (ctx) => {
    need(ctx.user, 'admin');
    const { username, name, role = 'sales', password } = ctx.body;
    const errors = {};
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username || '')) errors.username = '۳ تا ۳۲ نویسه لاتین/عدد';
    if (!name || !String(name).trim()) errors.name = 'الزامی است';
    if (!ROLES.includes(role)) errors.role = 'نقش نامعتبر';
    try { checkPassword(password); } catch (e) { errors.password = e.message; }
    if (Object.keys(errors).length) throw vErr(errors);
    try {
      const id = Number(db.prepare('INSERT INTO users(username,name,role,password_hash) VALUES (?,?,?,?)')
        .run(username, String(name).trim(), role, A.hashPassword(password)).lastInsertRowid);
      R.audit(db, ctx.user, 'create', 'users', id);
      return db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(id);
    } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'این نام کاربری قبلاً ثبت شده'); throw e; }
  });
  route('PUT', '/api/users/:id', (ctx) => {
    need(ctx.user, 'admin');
    const id = idOf(ctx.params.id);
    const cur = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!cur) throw new HttpError(404, 'کاربر یافت نشد');
    const b = ctx.body;
    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    const role = b.role ?? cur.role;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : cur.active;
    if (!name) throw vErr({ name: 'الزامی است' });
    if (!ROLES.includes(role)) throw vErr({ role: 'نقش نامعتبر' });
    if (id === ctx.user.id && (role !== 'admin' || !active)) throw new HttpError(409, 'نمی‌توانید نقش یا وضعیت خودتان را تضعیف کنید');
    if (b.password) { checkPassword(b.password); db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(A.hashPassword(b.password), id); }
    db.prepare('UPDATE users SET name=?,role=?,active=? WHERE id=?').run(name, role, active, id);
    if (!active || b.password || role !== cur.role) A.destroyUserSessions(db, id);
    R.audit(db, ctx.user, 'update', 'users', id, { role, active, passwordChanged: !!b.password });
    return db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(id);
  });
  route('GET', '/api/lookups', (ctx) => {
    const own = R.canSeeAll(ctx.user) ? '' : `WHERE owner_id=${ctx.user.id}`;
    return {
      users: db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all(),
      companies: db.prepare(`SELECT id,name FROM companies ${own} ORDER BY name LIMIT 2000`).all(),
      contacts: db.prepare(`SELECT id,first_name||' '||last_name AS name FROM contacts ${own} ORDER BY first_name LIMIT 5000`).all(),
      products: db.prepare('SELECT id,name,price FROM products WHERE active=1 ORDER BY name').all(),
    };
  });

  // ---------- Activities / notes ----------
  route('GET', '/api/activities', (ctx) => {
    const { entity_type, entity_id } = ctx.query;
    R.getOne(db, actDef(entity_type), idOf(entity_id), ctx.user); // کنترل دسترسی
    return db.prepare(`SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id=a.user_id
      WHERE entity_type=? AND entity_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 200`).all(entity_type, Number(entity_id));
  });
  route('POST', '/api/activities', (ctx) => {
    const { entity_type, entity_id, type = 'note', body } = ctx.body;
    const def = actDef(entity_type);
    if (!['note', 'call', 'meeting', 'email'].includes(type)) throw vErr({ type: 'نامعتبر' });
    if (!body || !String(body).trim()) throw vErr({ body: 'متن الزامی است' });
    if (String(body).length > 5000) throw vErr({ body: 'حداکثر ۵۰۰۰ نویسه' });
    R.getOne(db, def, idOf(entity_id), ctx.user);
    R.logActivity(db, entity_type, Number(entity_id), type, String(body).trim(), ctx.user.id);
    return { ok: true };
  });

  // ---------- Deal items ----------
  route('GET', '/api/deals/:id/items', (ctx) => {
    const id = idOf(ctx.params.id);
    R.getOne(db, R.RESOURCES.deals, id, ctx.user);
    return db.prepare('SELECT * FROM deal_items WHERE deal_id=? ORDER BY id').all(id);
  });
  route('PUT', '/api/deals/:id/items', (ctx) => {
    const id = idOf(ctx.params.id);
    R.getOne(db, R.RESOURCES.deals, id, ctx.user);
    const items = ctx.body.items;
    if (!Array.isArray(items) || items.length > 200) throw new HttpError(400, 'فهرست اقلام نامعتبر است');
    const rows = items.map((it, i) => {
      const name = String(it.name || '').trim(), qty = Number(it.qty), price = Number(it.price);
      if (!name || !(qty > 0) || !(price >= 0) || !Number.isFinite(qty + price)) throw vErr({ [`items.${i}`]: 'نام، تعداد (>۰) و قیمت (≥۰) لازم است' });
      const pid = it.product_id ? Number(it.product_id) : null;
      if (pid && !db.prepare('SELECT 1 FROM products WHERE id=?').get(pid)) throw vErr({ [`items.${i}`]: 'کالا یافت نشد' });
      return { pid, name, qty, price };
    });
    tx(db, () => {
      db.prepare('DELETE FROM deal_items WHERE deal_id=?').run(id);
      const ins = db.prepare('INSERT INTO deal_items(deal_id,product_id,name,qty,price) VALUES (?,?,?,?,?)');
      for (const c of rows) ins.run(id, c.pid, c.name, c.qty, c.price);
      // ارزش معامله = جمع اقلام (در صورت وجود قلم)
      if (rows.length) db.prepare('UPDATE deals SET value=?, updated_at=? WHERE id=?')
        .run(rows.reduce((s, c) => s + c.qty * c.price, 0), new Date().toISOString(), id);
    });
    return db.prepare('SELECT * FROM deal_items WHERE deal_id=? ORDER BY id').all(id);
  });

  route('POST', '/api/leads/:id/convert', (ctx) => R.convertLead(db, ctx.user, idOf(ctx.params.id), ctx.body));

  // ---------- Dashboard & reports ----------
  route('GET', '/api/dashboard', (ctx) => dashboard(db, ctx.user));
  route('GET', '/api/reports/team', (ctx) => {
    need(ctx.user, 'manager');
    return db.prepare(`SELECT u.id, u.name,
      (SELECT COUNT(*) FROM deals d WHERE d.owner_id=u.id AND d.stage NOT IN ('won','lost')) AS open_deals,
      (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.owner_id=u.id AND d.stage NOT IN ('won','lost')) AS pipeline_value,
      (SELECT COUNT(*) FROM deals d WHERE d.owner_id=u.id AND d.stage='won') AS won_count,
      (SELECT COALESCE(SUM(value),0) FROM deals d WHERE d.owner_id=u.id AND d.stage='won') AS won_value,
      (SELECT COUNT(*) FROM deals d WHERE d.owner_id=u.id AND d.stage='lost') AS lost_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='open' AND t.due_date < date('now')) AS overdue_tasks
      FROM users u WHERE u.active=1 ORDER BY won_value DESC`).all();
  });
  route('GET', '/api/audit', (ctx) => {
    need(ctx.user, 'admin');
    return db.prepare('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300').all();
  });

  // ---------- CRUD عمومی ----------
  for (const [name, def] of Object.entries(R.RESOURCES)) {
    const writeRole = def.writeRole || 'sales';
    route('GET', `/api/${name}`, (ctx) => R.list(db, def, ctx.user, ctx.query));
    route('GET', `/api/${name}/export.csv`, (ctx) => {
      need(ctx.user, 'manager');
      const { data } = R.list(db, def, ctx.user, { ...ctx.query, all: '1', limit: '5000', page: '1' });
      return { csv: R.toCsv(data, data.length ? Object.keys(data[0]) : ['id']), filename: `${name}.csv` };
    });
    route('GET', `/api/${name}/:id`, (ctx) => R.getOne(db, def, idOf(ctx.params.id), ctx.user));
    route('POST', `/api/${name}`, (ctx) => { need(ctx.user, writeRole); return R.create(db, name, def, ctx.user, ctx.body); });
    route('PUT', `/api/${name}/:id`, (ctx) => { need(ctx.user, writeRole); return R.update(db, name, def, ctx.user, idOf(ctx.params.id), ctx.body); });
    route('DELETE', `/api/${name}/:id`, (ctx) => {
      need(ctx.user, name === 'tasks' ? 'sales' : 'manager'); // وظیفه را مسئولش هم می‌تواند حذف کند
      R.remove(db, name, def, ctx.user, idOf(ctx.params.id));
      return { ok: true };
    });
  }

  // ---------- Dispatcher ----------
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, body, headers = {}) => {
      const isStr = typeof body === 'string';
      res.writeHead(status, { ...SEC_HEADERS, 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      res.end(isStr ? body : JSON.stringify(body));
    };
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, req, res);
      const cookies = A.parseCookies(req.headers.cookie);
      const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.CRM_SECURE_COOKIE;
      const ctx = {
        query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress, token: cookies.crm_session,
        user: A.userFromToken(db, cookies.crm_session), params: {}, body: {},
        setCookie: (v, maxAge) => res.setHeader('Set-Cookie',
          `crm_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(maxAge)}${secure ? '; Secure' : ''}`),
      };
      let matched = null, pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        matched = r; break;
      }
      if (!matched) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'متد مجاز نیست' : 'مسیر یافت نشد');
      if (req.method !== 'GET') {
        // دفاع CSRF: هدر سفارشی که صفحات بین‌دامنه‌ای بدون preflight نمی‌توانند بفرستند
        if (req.headers['x-requested-with'] !== 'crm') throw new HttpError(403, 'درخواست نامعتبر');
        ctx.body = await readBody(req);
      }
      if (!matched.opts.public && !ctx.user) throw new HttpError(401, 'ابتدا وارد شوید');
      const out = await matched.fn(ctx);
      if (out && out.csv !== undefined) return send(200, out.csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.filename}"` });
      return send(200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message, details: e.details });
      console.error(e);
      return send(500, { error: 'خطای داخلی سرور' });
    }
  };
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw vErr({ password: 'گذرواژه باید حداقل ۸ نویسه باشد' });
  if (p.length > 200) throw vErr({ password: 'گذرواژه بسیار طولانی است' });
}

function serveStatic(pathname, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SEC_HEADERS); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname); } catch { res.writeHead(400, SEC_HEADERS); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403, SEC_HEADERS); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, SEC_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function dashboard(db, user) {
  const all = R.canSeeAll(user);
  const p = all ? {} : { uid: user.id };
  const od = all ? '' : ' AND d.owner_id=@uid';
  const lo = all ? '' : ' AND l.owner_id=@uid';
  const to = all ? '' : ' AND t.assignee_id=@uid';
  const q = (sql) => db.prepare(sql);
  const stages = q(`SELECT d.stage, COUNT(*) AS count, COALESCE(SUM(d.value),0) AS value FROM deals d WHERE 1=1${od} GROUP BY d.stage`).all(p);
  const won = q(`SELECT COUNT(*) c, COALESCE(SUM(value),0) v FROM deals d WHERE stage='won' AND strftime('%Y-%m',closed_at)=strftime('%Y-%m','now')${od}`).get(p);
  const wonN = stages.find((s) => s.stage === 'won')?.count || 0, lostN = stages.find((s) => s.stage === 'lost')?.count || 0;
  const open = stages.filter((s) => !['won', 'lost'].includes(s.stage));
  return {
    counts: {
      contacts: q(`SELECT COUNT(*) n FROM contacts c WHERE 1=1${all ? '' : ' AND c.owner_id=@uid'}`).get(p).n,
      companies: q(`SELECT COUNT(*) n FROM companies c WHERE 1=1${all ? '' : ' AND c.owner_id=@uid'}`).get(p).n,
      leads_open: q(`SELECT COUNT(*) n FROM leads l WHERE status IN ('new','contacted','qualified')${lo}`).get(p).n,
    },
    pipeline: {
      stages, open_count: open.reduce((s, x) => s + x.count, 0), open_value: open.reduce((s, x) => s + x.value, 0),
      weighted_value: q(`SELECT COALESCE(SUM(value*probability/100.0),0) v FROM deals d WHERE stage NOT IN ('won','lost')${od}`).get(p).v,
    },
    won_month: { count: won.c, value: won.v },
    win_rate: wonN + lostN ? Math.round((wonN / (wonN + lostN)) * 100) : null,
    leads_by_status: q(`SELECT status, COUNT(*) AS count FROM leads l WHERE 1=1${lo} GROUP BY status`).all(p),
    revenue_by_month: q(`SELECT strftime('%Y-%m-01',closed_at) AS month, COALESCE(SUM(value),0) AS value, COUNT(*) AS count FROM deals d
      WHERE stage='won' AND closed_at >= date('now','start of month','-5 months')${od} GROUP BY month ORDER BY month`).all(p),
    tasks_overdue: q(`SELECT COUNT(*) n FROM tasks t WHERE status='open' AND due_date < date('now')${to}`).get(p).n,
    tasks_due: q(`SELECT t.id,t.title,t.type,t.priority,t.due_date FROM tasks t WHERE status='open' AND due_date <= date('now')${to} ORDER BY due_date LIMIT 10`).all(p),
    closing_soon: q(`SELECT d.id,d.title,d.value,d.stage,d.expected_close FROM deals d WHERE stage NOT IN ('won','lost') AND expected_close IS NOT NULL
      AND expected_close <= date('now','+14 days')${od} ORDER BY expected_close LIMIT 8`).all(p),
    // کاربر فروش فقط فعالیت‌های خودش را می‌بیند (جلوگیری از نشت اطلاعات رکوردهای دیگران)
    recent: q(`SELECT a.id,a.entity_type,a.entity_id,a.type,a.body,a.created_at,u.name AS user_name FROM activities a LEFT JOIN users u ON u.id=a.user_id
      ${all ? '' : 'WHERE a.user_id=@uid'} ORDER BY a.id DESC LIMIT 12`).all(p),
  };
}

function ensureAdmin(db) {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n) return;
  const pw = process.env.CRM_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users(username,name,role,password_hash) VALUES (?,?,?,?)').run('admin', 'مدیر سیستم', 'admin', A.hashPassword(pw));
  if (!process.env.CRM_ADMIN_PASSWORD) console.log(`\n>>> کاربر مدیر ساخته شد  username: admin  password: ${pw}\n>>> (فقط یک‌بار نمایش داده می‌شود؛ پس از ورود تغییرش دهید)\n`);
}

if (require.main === module) {
  const db = openDb();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  http.createServer(createApp(db)).listen(port, host, () => console.log(`CRM  →  http://${host}:${port}`));
}

module.exports = { createApp };
