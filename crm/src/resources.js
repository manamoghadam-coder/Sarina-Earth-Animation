'use strict';
/**
 * تعریف اعلامی منابع (Entities) + موتور CRUD عمومی با اعتبارسنجی، دسترسی مبتنی بر نقش،
 * جست‌وجو، فیلتر، مرتب‌سازی، صفحه‌بندی و خروجی CSV.
 */
const { tx } = require('./db');

const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_PROB = { new: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 };
const nowIso = () => new Date().toISOString();

const str = (max = 500, req = false) => ({ t: 'str', max, req });
const RELATED_LABEL = `(CASE t.related_type
  WHEN 'contact' THEN (SELECT first_name||' '||last_name FROM contacts WHERE id=t.related_id)
  WHEN 'company' THEN (SELECT name FROM companies WHERE id=t.related_id)
  WHEN 'deal' THEN (SELECT title FROM deals WHERE id=t.related_id)
  WHEN 'lead' THEN (SELECT first_name||' '||last_name FROM leads WHERE id=t.related_id) END)`;

const RESOURCES = {
  companies: {
    table: 'companies', alias: 'c', ownerCol: 'owner_id', activityType: 'company',
    select: `c.*, u.name AS owner_name, (SELECT COUNT(*) FROM contacts k WHERE k.company_id=c.id) AS contacts_count`,
    from: `companies c LEFT JOIN users u ON u.id=c.owner_id`,
    search: ['c.name', 'c.industry', 'c.city', 'c.phone', 'c.email'],
    filters: ['owner_id', 'industry', 'city'],
    sortable: ['name', 'industry', 'city', 'created_at', 'size'],
    fields: { name: str(200, true), industry: str(100), website: str(200), phone: str(50), email: { t: 'email' },
      address: str(500), city: str(100), size: { t: 'int', min: 0 }, owner_id: { t: 'ref', table: 'users' }, notes: str(5000) },
  },
  contacts: {
    table: 'contacts', alias: 'c', ownerCol: 'owner_id', activityType: 'contact',
    select: `c.*, c.first_name||' '||c.last_name AS full_name, co.name AS company_name, u.name AS owner_name`,
    from: `contacts c LEFT JOIN companies co ON co.id=c.company_id LEFT JOIN users u ON u.id=c.owner_id`,
    search: ['c.first_name', 'c.last_name', 'c.email', 'c.phone', 'c.mobile', 'co.name', 'c.tags'],
    filters: ['owner_id', 'company_id', 'source'],
    sortable: ['first_name', 'last_name', 'created_at', 'company_id'],
    fields: { first_name: str(100, true), last_name: str(100), email: { t: 'email' }, phone: str(50), mobile: str(50),
      position: str(100), company_id: { t: 'ref', table: 'companies' }, owner_id: { t: 'ref', table: 'users' },
      source: str(100), tags: str(300), notes: str(5000) },
  },
  leads: {
    table: 'leads', alias: 'l', ownerCol: 'owner_id', activityType: 'lead',
    select: `l.*, l.first_name||' '||l.last_name AS full_name, u.name AS owner_name`,
    from: `leads l LEFT JOIN users u ON u.id=l.owner_id`,
    search: ['l.first_name', 'l.last_name', 'l.company_name', 'l.email', 'l.phone'],
    filters: ['owner_id', 'status', 'source'],
    sortable: ['first_name', 'status', 'score', 'created_at'],
    fields: { first_name: str(100, true), last_name: str(100), company_name: str(200), email: { t: 'email' }, phone: str(50),
      source: str(100), status: { t: 'enum', values: ['new', 'contacted', 'qualified', 'lost', 'converted'] },
      score: { t: 'int', min: 0, max: 100 }, owner_id: { t: 'ref', table: 'users' }, notes: str(5000) },
  },
  deals: {
    table: 'deals', alias: 'd', ownerCol: 'owner_id', activityType: 'deal',
    select: `d.*, ct.first_name||' '||ct.last_name AS contact_name, co.name AS company_name, u.name AS owner_name`,
    from: `deals d LEFT JOIN contacts ct ON ct.id=d.contact_id LEFT JOIN companies co ON co.id=d.company_id LEFT JOIN users u ON u.id=d.owner_id`,
    search: ['d.title', 'co.name', 'ct.first_name', 'ct.last_name'],
    filters: ['owner_id', 'stage', 'company_id', 'contact_id'],
    sortable: ['title', 'value', 'stage', 'expected_close', 'created_at'],
    fields: { title: str(200, true), value: { t: 'num', min: 0 }, stage: { t: 'enum', values: STAGES },
      probability: { t: 'int', min: 0, max: 100 }, expected_close: { t: 'date' }, lost_reason: str(500),
      contact_id: { t: 'ref', table: 'contacts' }, company_id: { t: 'ref', table: 'companies' },
      owner_id: { t: 'ref', table: 'users' }, notes: str(5000) },
  },
  tasks: {
    table: 'tasks', alias: 't', ownerCol: 'assignee_id', activityType: null,
    select: `t.*, u.name AS assignee_name, ${RELATED_LABEL} AS related_label`,
    from: `tasks t LEFT JOIN users u ON u.id=t.assignee_id`,
    search: ['t.title', 't.notes'],
    filters: ['assignee_id', 'status', 'priority', 'type', 'related_type', 'related_id'],
    sortable: ['title', 'due_date', 'priority', 'status', 'created_at'],
    defaultSort: ['due_date', 'asc'],
    fields: { title: str(300, true), type: { t: 'enum', values: ['todo', 'call', 'meeting', 'email'] },
      priority: { t: 'enum', values: ['low', 'normal', 'high'] }, status: { t: 'enum', values: ['open', 'done'] },
      due_date: { t: 'date' }, related_type: { t: 'enum', nullable: true, values: ['contact', 'company', 'deal', 'lead'] },
      related_id: { t: 'int', min: 1 }, assignee_id: { t: 'ref', table: 'users' }, notes: str(5000) },
  },
  products: {
    table: 'products', alias: 'p', ownerCol: null, writeRole: 'manager', activityType: null,
    select: 'p.*', from: 'products p',
    search: ['p.name', 'p.sku', 'p.description'],
    filters: ['active'], sortable: ['name', 'price', 'sku', 'created_at'],
    fields: { name: str(200, true), sku: str(100), price: { t: 'num', min: 0 }, description: str(2000), active: { t: 'bool' } },
  },
};

class HttpError extends Error { constructor(status, msg, details) { super(msg); this.status = status; this.details = details; } }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().startsWith(s);
}

/** اعتبارسنجی و پاک‌سازی بدنه. partial=true برای به‌روزرسانی (فقط فیلدهای ارسال‌شده) */
function clean(db, def, body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'بدنه درخواست نامعتبر است');
  const out = {}, errors = {};
  for (const [k, f] of Object.entries(def.fields)) {
    if (!(k in body)) { if (!partial && f.req) errors[k] = 'الزامی است'; continue; }
    let v = body[k];
    if (typeof v === 'string') v = v.trim();
    const empty = v === '' || v === null || v === undefined;
    if (empty) {
      if (f.req) errors[k] = 'الزامی است';
      else if (f.t === 'enum' && !f.nullable) continue; // مقدار پیش‌فرض دیتابیس
      else if (f.t === 'bool') continue;
      else out[k] = ['value', 'price', 'score', 'probability'].includes(k) ? 0 : null;
      continue;
    }
    switch (f.t) {
      case 'str': if (typeof v !== 'string') errors[k] = 'باید متن باشد'; else if (v.length > f.max) errors[k] = `حداکثر ${f.max} نویسه`; else out[k] = v; break;
      case 'email': if (typeof v !== 'string' || !EMAIL_RE.test(v)) errors[k] = 'ایمیل نامعتبر است'; else out[k] = v.toLowerCase(); break;
      case 'int': case 'num': case 'ref': {
        const n = Number(v);
        const bad = !Number.isFinite(n) || (f.t !== 'num' && !Number.isInteger(n));
        if (bad) errors[k] = 'عدد نامعتبر است';
        else if (f.min !== undefined && n < f.min) errors[k] = `حداقل ${f.min}`;
        else if (f.max !== undefined && n > f.max) errors[k] = `حداکثر ${f.max}`;
        else if (f.t === 'ref' && !db.prepare(`SELECT 1 FROM ${f.table} WHERE id=?`).get(n)) errors[k] = 'مورد انتخاب‌شده وجود ندارد';
        else out[k] = n;
        break;
      }
      case 'enum': if (!f.values.includes(v)) errors[k] = 'مقدار مجاز نیست'; else out[k] = v; break;
      case 'date': if (typeof v !== 'string' || !validDate(v)) errors[k] = 'تاریخ نامعتبر است'; else out[k] = v; break;
      case 'bool': out[k] = (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0; break;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'خطای اعتبارسنجی', errors);
  return out;
}

const canSeeAll = (u) => u.role !== 'sales';

function scopeSql(def, user, params) {
  if (def.ownerCol && !canSeeAll(user)) { params.push(user.id); return ` AND ${def.alias}.${def.ownerCol}=?`; }
  return '';
}

function logActivity(db, type, id, kind, body, userId) {
  db.prepare('INSERT INTO activities(entity_type,entity_id,type,body,user_id) VALUES (?,?,?,?,?)').run(type, id, kind, body, userId);
}
function audit(db, user, action, entity, id, detail) {
  db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,detail) VALUES (?,?,?,?,?)')
    .run(user?.id ?? null, action, entity ?? null, id ?? null, detail ? JSON.stringify(detail).slice(0, 2000) : null);
}

function getOne(db, def, id, user) {
  const params = [id];
  const sc = scopeSql(def, user, params);
  const row = db.prepare(`SELECT ${def.select} FROM ${def.from} WHERE ${def.alias}.id=?${sc}`).get(...params);
  if (!row) throw new HttpError(404, 'رکورد یافت نشد');
  return row;
}

function list(db, def, user, q) {
  const params = []; let where = ' WHERE 1=1';
  where += scopeSql(def, user, params);
  const s = (q.q || '').trim();
  if (s) {
    where += ' AND (' + def.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')';
    const like = '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
    def.search.forEach(() => params.push(like));
  }
  for (const f of def.filters) {
    if (q[f] !== undefined && q[f] !== '') { where += ` AND ${def.alias}.${f}=?`; params.push(q[f]); }
  }
  const total = db.prepare(`SELECT COUNT(*) n FROM ${def.from}${where}`).get(...params).n;
  const [dcol, ddir] = def.defaultSort || ['created_at', 'desc'];
  const sort = def.sortable.includes(q.sort) ? q.sort : dcol;
  const dir = q.dir === 'asc' ? 'ASC' : q.dir === 'desc' ? 'DESC' : ddir.toUpperCase();
  const limit = Math.min(Math.max(parseInt(q.limit) || 25, 1), q.all === '1' ? 5000 : 200);
  const page = Math.max(parseInt(q.page) || 1, 1);
  const nulls = sort === 'due_date' || sort === 'expected_close' ? `${def.alias}.${sort} IS NULL, ` : '';
  const data = db.prepare(`SELECT ${def.select} FROM ${def.from}${where} ORDER BY ${nulls}${def.alias}.${sort} ${dir}, ${def.alias}.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  return { data, total, page, limit };
}

function create(db, name, def, user, body) {
  const v = clean(db, def, body, false);
  if (def.ownerCol) v[def.ownerCol] = canSeeAll(user) ? (v[def.ownerCol] ?? user.id) : user.id;
  if (name === 'tasks') v.created_by = user.id;
  if (name === 'tasks' && v.related_type && !v.related_id) throw new HttpError(422, 'خطای اعتبارسنجی', { related_id: 'شناسه مورد مرتبط لازم است' });
  if (name === 'deals') {
    v.stage ||= 'new';
    v.probability ??= STAGE_PROB[v.stage];
    if (v.stage === 'won' || v.stage === 'lost') v.closed_at = nowIso();
  }
  const keys = Object.keys(v);
  return tx(db, () => {
    let id;
    try {
      id = db.prepare(`INSERT INTO ${def.table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => v[k])).lastInsertRowid;
    } catch (e) { throw mapDbError(e); }
    id = Number(id);
    if (def.activityType) logActivity(db, def.activityType, id, 'system', 'رکورد ایجاد شد', user.id);
    audit(db, user, 'create', name, id);
    return getOne(db, def, id, user);
  });
}

function update(db, name, def, user, id, body) {
  const cur = getOne(db, def, id, user);
  const v = clean(db, def, body, true);
  if (def.ownerCol && !canSeeAll(user)) delete v[def.ownerCol]; // کاربر فروش نمی‌تواند مالکیت را منتقل کند
  if (name === 'deals' && v.stage && v.stage !== cur.stage) {
    if (!('probability' in v)) v.probability = STAGE_PROB[v.stage];
    v.closed_at = (v.stage === 'won' || v.stage === 'lost') ? nowIso() : null;
    if (v.stage !== 'lost' && !('lost_reason' in v)) v.lost_reason = null;
  }
  if (name === 'tasks' && v.status && v.status !== cur.status) v.completed_at = v.status === 'done' ? nowIso() : null;
  if (name === 'leads' && cur.status === 'converted' && v.status && v.status !== 'converted')
    throw new HttpError(409, 'سرنخ تبدیل‌شده را نمی‌توان به وضعیت دیگر بازگرداند');
  const keys = Object.keys(v);
  if (!keys.length) return cur;
  return tx(db, () => {
    try {
      db.prepare(`UPDATE ${def.table} SET ${keys.map((k) => k + '=?').join(',')}, updated_at=? WHERE id=?`).run(...keys.map((k) => v[k]), nowIso(), id);
    } catch (e) { throw mapDbError(e); }
    if (name === 'deals' && v.stage && v.stage !== cur.stage)
      logActivity(db, 'deal', id, 'system', `مرحله از «${STAGE_FA[cur.stage]}» به «${STAGE_FA[v.stage]}» تغییر کرد`, user.id);
    if (name === 'leads' && v.status && v.status !== cur.status)
      logActivity(db, 'lead', id, 'system', `وضعیت از «${LEAD_FA[cur.status]}» به «${LEAD_FA[v.status]}» تغییر کرد`, user.id);
    audit(db, user, 'update', name, id, v);
    return getOne(db, def, id, user);
  });
}

const STAGE_FA = { new: 'جدید', qualified: 'ارزیابی‌شده', proposal: 'پیشنهاد', negotiation: 'مذاکره', won: 'برنده', lost: 'ازدست‌رفته' };
const LEAD_FA = { new: 'جدید', contacted: 'تماس گرفته شد', qualified: 'واجد شرایط', lost: 'ازدست‌رفته', converted: 'تبدیل‌شده' };

function remove(db, name, def, user, id) {
  getOne(db, def, id, user);
  tx(db, () => {
    db.prepare(`DELETE FROM ${def.table} WHERE id=?`).run(id);
    if (def.activityType) db.prepare('DELETE FROM activities WHERE entity_type=? AND entity_id=?').run(def.activityType, id);
    if (def.activityType) db.prepare('DELETE FROM tasks WHERE related_type=? AND related_id=?').run(def.activityType, id);
    audit(db, user, 'delete', name, id);
  });
}

function mapDbError(e) {
  if (/UNIQUE/.test(e.message)) return new HttpError(409, 'مقدار تکراری است (مثلاً کد کالا یا نام کاربری)');
  return e;
}

/** تبدیل سرنخ به مخاطب (+ شرکت + معامله اختیاری) در یک تراکنش */
function convertLead(db, user, id, body = {}) {
  const lead = getOne(db, RESOURCES.leads, id, user);
  if (lead.status === 'converted') throw new HttpError(409, 'این سرنخ قبلاً تبدیل شده است');
  return tx(db, () => {
    let companyId = null;
    if (lead.company_name) {
      const ex = db.prepare('SELECT id FROM companies WHERE name=? COLLATE NOCASE').get(lead.company_name);
      companyId = ex ? ex.id : Number(db.prepare('INSERT INTO companies(name,owner_id) VALUES (?,?)').run(lead.company_name, lead.owner_id ?? user.id).lastInsertRowid);
    }
    const contactId = Number(db.prepare(`INSERT INTO contacts(first_name,last_name,email,phone,company_id,owner_id,source,notes)
      VALUES (?,?,?,?,?,?,?,?)`).run(lead.first_name, lead.last_name, lead.email, lead.phone, companyId, lead.owner_id ?? user.id, lead.source, lead.notes).lastInsertRowid);
    let dealId = null;
    if (body.create_deal) {
      const title = String(body.deal_title || '').trim() || `معامله ${lead.first_name} ${lead.last_name}`.trim();
      const value = Number(body.deal_value) >= 0 ? Number(body.deal_value) : 0;
      dealId = Number(db.prepare(`INSERT INTO deals(title,value,stage,probability,contact_id,company_id,owner_id) VALUES (?,?,?,?,?,?,?)`)
        .run(title, value, 'new', STAGE_PROB.new, contactId, companyId, lead.owner_id ?? user.id).lastInsertRowid);
      logActivity(db, 'deal', dealId, 'system', `از سرنخ #${id} ایجاد شد`, user.id);
    }
    db.prepare(`UPDATE leads SET status='converted', contact_id=?, deal_id=?, updated_at=? WHERE id=?`).run(contactId, dealId, nowIso(), id);
    logActivity(db, 'lead', id, 'system', 'به مخاطب تبدیل شد', user.id);
    logActivity(db, 'contact', contactId, 'system', `از سرنخ #${id} ایجاد شد`, user.id);
    audit(db, user, 'convert', 'leads', id, { contactId, companyId, dealId });
    return { contact_id: contactId, company_id: companyId, deal_id: dealId };
  });
}

function csvEscape(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // جلوگیری از CSV injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, cols) {
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\r\n');
}

module.exports = { RESOURCES, HttpError, list, getOne, create, update, remove, convertLead, clean, toCsv, logActivity, audit, canSeeAll, STAGES, STAGE_PROB };
