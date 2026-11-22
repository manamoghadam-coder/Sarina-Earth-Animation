import { ENTITIES } from './entities.js';
import { HttpError, bad, isoDate, today } from './util.js';
import { hashPassword } from './auth.js';

const q = (s) => `"${s}"`;
const table = (def) => 'e_' + def.key;

export function audit(ctx, entity, recId, action, detail) {
  ctx.db.prepare('INSERT INTO audit_log (company_id,user_id,username,entity,rec_id,action,detail) VALUES (?,?,?,?,?,?,?)')
    .run(ctx.companyId ?? null, ctx.user.id, ctx.user.username, entity, recId ?? null, action, detail ? String(detail).slice(0, 500) : null);
}

export function nextNumber(ctx, def) {
  ctx.db.prepare('INSERT INTO counters (company_id,key,n) VALUES (?,?,1) ON CONFLICT(company_id,key) DO UPDATE SET n=n+1').run(ctx.companyId, def.key);
  const n = ctx.db.prepare('SELECT n FROM counters WHERE company_id=? AND key=?').get(ctx.companyId, def.key).n;
  return `${def.numbering}-${String(n).padStart(4, '0')}`;
}

function coerce(ctx, def, f, v) {
  if (v === undefined || v === null || v === '') return null;
  switch (f.type) {
    case 'text': case 'textarea': {
      if (typeof v !== 'string') v = String(v);
      v = v.trim(); if (v.length > 4000) throw bad(`«${f.label}» بیش از حد طولانی است`);
      if (f.pattern && v && !new RegExp(f.pattern).test(v)) throw bad(f.patternMsg || `«${f.label}» نامعتبر است`);
      return v || null;
    }
    case 'number': case 'money': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw bad(`«${f.label}» باید عدد باشد`);
      if (f.min !== undefined && n < f.min) throw bad(`«${f.label}» نباید کمتر از ${f.min} باشد`);
      if (f.max !== undefined && n > f.max) throw bad(`«${f.label}» نباید بیشتر از ${f.max} باشد`);
      return n;
    }
    case 'date': if (!isoDate(v)) throw bad(`«${f.label}» تاریخ معتبر نیست`); return v;
    case 'select': if (!f.options.some((o) => o.v === v)) throw bad(`«${f.label}» مقدار نامعتبر دارد`); return v;
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    case 'ref': {
      const id = Number(v);
      if (!Number.isInteger(id)) throw bad(`«${f.label}» نامعتبر است`);
      // جلوگیری از ارجاع بین‌شرکتی (Tenant isolation)
      if (!ctx.db.prepare(`SELECT 1 FROM e_${f.ref} WHERE id=? AND company_id=?`).get(id, ctx.companyId)) throw bad(`«${f.label}» یافت نشد`);
      return id;
    }
    case 'password': if (typeof v !== 'string' || v.length < 6) throw bad('گذرواژه حداقل ۶ نویسه باشد'); return hashPassword(v);
    case 'lines': if (!Array.isArray(v)) throw bad('اقلام نامعتبر است'); return v;
    default: return null;
  }
}

function decode(def, row) {
  if (!row) return row;
  for (const f of def.fields) if (f.type === 'lines') { try { row[f.k] = JSON.parse(row[f.k] || '[]'); } catch { row[f.k] = []; } }
  delete row.password;
  return row;
}

export function getRow(ctx, def, id, { raw } = {}) {
  const row = ctx.db.prepare(`SELECT * FROM ${table(def)} WHERE id=? AND company_id=?`).get(Number(id), ctx.companyId);
  if (!row) return null;
  if (raw) { for (const f of def.fields) if (f.type === 'lines') { try { row[f.k] = JSON.parse(row[f.k] || '[]'); } catch { row[f.k] = []; } } return row; }
  return decode(def, row);
}

export function labelOf(def, row) {
  return def.label.map((k) => row[k]).filter((x) => x !== null && x !== undefined && x !== '').join(' · ') || `#${row.id}`;
}

// افزودن برچسب فیلدهای ارجاعی به ردیف‌ها (برای نمایش)
function withLabels(ctx, def, rows) {
  for (const f of def.fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.k]).filter(Boolean))];
    if (!ids.length) continue;
    const rdef = ENTITIES[f.ref];
    const found = ctx.db.prepare(`SELECT * FROM e_${f.ref} WHERE company_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(ctx.companyId, ...ids);
    const map = new Map(found.map((r) => [r.id, labelOf(rdef, r)]));
    for (const r of rows) { r._l = r._l || {}; if (r[f.k]) r._l[f.k] = map.get(r[f.k]) || '—'; }
  }
  return rows;
}

function filterClause(def, query) {
  const where = ['company_id=?']; const extra = [];
  const s = (query.q || '').trim();
  if (s) {
    const cols = def.search || def.fields.filter((f) => f.type === 'text').map((f) => f.k);
    if (cols.length) { where.push('(' + cols.map((c) => `${q(c)} LIKE ? ESCAPE '\\'`).join(' OR ') + ')'); for (const _ of cols) extra.push('%' + s.replace(/[\\%_]/g, '\\$&') + '%'); }
  }
  for (const f of def.fields) {
    const v = query['f_' + f.k];
    if (v !== undefined && v !== '' && (f.filter || f.type === 'ref')) { where.push(`${q(f.k)}=?`); extra.push(f.type === 'ref' ? Number(v) : v); }
  }
  return { sql: where.join(' AND '), extra };
}

export function list(ctx, def, query) {
  const { sql, extra } = filterClause(def, query);
  const size = Math.min(Math.max(parseInt(query.size) || 25, 1), 500);
  const page = Math.max(parseInt(query.page) || 1, 1);
  const sortable = new Set(['id', 'created_at', ...def.fields.map((f) => f.k)]);
  const sort = sortable.has(query.sort) ? query.sort : (def.sortDefault || 'id');
  const dir = query.dir === 'asc' ? 'ASC' : (query.dir === 'desc' ? 'DESC' : (sort === 'id' || def.sortDefault === sort ? 'DESC' : 'ASC'));
  const total = ctx.db.prepare(`SELECT COUNT(*) n FROM ${table(def)} WHERE ${sql}`).get(ctx.companyId, ...extra).n;
  const rows = ctx.db.prepare(`SELECT * FROM ${table(def)} WHERE ${sql} ORDER BY ${q(sort)} ${dir}, id DESC LIMIT ? OFFSET ?`)
    .all(ctx.companyId, ...extra, size, (page - 1) * size).map((r) => decode(def, r));
  return { rows: withLabels(ctx, def, rows), total, page, size };
}

export function getOne(ctx, def, id) {
  const r = getRow(ctx, def, id);
  if (!r) throw new HttpError(404, 'رکورد یافت نشد');
  withLabels(ctx, def, [r]);
  return r;
}

function build(ctx, def, input, old) {
  const rec = old ? { ...old } : {};
  for (const f of def.fields) {
    if (f.readonly) {
      if (!old && f.default !== undefined) rec[f.k] = f.default;
      continue;
    }
    if (input[f.k] !== undefined) {
      if (f.type === 'password' && (input[f.k] === '' || input[f.k] === null)) continue; // بدون تغییر
      rec[f.k] = coerce(ctx, def, f, input[f.k]);
    } else if (!old) {
      rec[f.k] = f.default === '$today' ? today() : (f.default ?? null);
    }
    if (rec[f.k] === undefined) rec[f.k] = null;
    if (f.required && (rec[f.k] === null || rec[f.k] === '')) throw bad(`«${f.label}» الزامی است`);
  }
  return rec;
}

function persistValue(f, v) {
  if (v === undefined) return null;
  if (f.type === 'lines') return JSON.stringify(v ?? []);
  return v;
}

function mapDbError(e, def) {
  if (String(e.message).includes('UNIQUE')) {
    const f = def.fields.find((x) => x.unique && String(e.message).includes(`.${x.k}`)) || def.fields.find((x) => x.unique);
    return new HttpError(409, `«${f?.label || 'مقدار'}» تکراری است`);
  }
  return e;
}

export function create(ctx, def, input) {
  const rec = build(ctx, def, input, null);
  def.validate?.(ctx, rec, null);
  if (def.numbering) rec.number = nextNumber(ctx, def);
  const fields = def.fields;
  try {
    const r = ctx.db.prepare(`INSERT INTO ${table(def)} (company_id,${fields.map((f) => q(f.k)).join(',')},created_by) VALUES (?,${fields.map(() => '?').join(',')},?)`)
      .run(ctx.companyId, ...fields.map((f) => persistValue(f, rec[f.k])), ctx.user.id);
    const id = Number(r.lastInsertRowid);
    const saved = getRow(ctx, def, id, { raw: true });
    def.afterSave?.(ctx, saved, null);
    audit(ctx, def.key, id, 'create', labelOf(def, saved));
    return getOne(ctx, def, id);
  } catch (e) { throw mapDbError(e, def); }
}

export function update(ctx, def, id, input) {
  if (def.noEdit) throw new HttpError(405, 'این مورد قابل ویرایش نیست');
  const old = getRow(ctx, def, id, { raw: true });
  if (!old) throw new HttpError(404, 'رکورد یافت نشد');
  const rec = build(ctx, def, input, old);
  def.validate?.(ctx, rec, old);
  const fields = def.fields;
  try {
    ctx.db.prepare(`UPDATE ${table(def)} SET ${fields.map((f) => `${q(f.k)}=?`).join(',')}, updated_at=datetime('now') WHERE id=? AND company_id=?`)
      .run(...fields.map((f) => persistValue(f, rec[f.k])), old.id, ctx.companyId);
    const saved = getRow(ctx, def, id, { raw: true });
    def.afterSave?.(ctx, saved, old);
    audit(ctx, def.key, old.id, 'update', labelOf(def, saved));
    return getOne(ctx, def, id);
  } catch (e) { throw mapDbError(e, def); }
}

export function remove(ctx, def, id) {
  const old = getRow(ctx, def, id, { raw: true });
  if (!old) throw new HttpError(404, 'رکورد یافت نشد');
  def.canDelete?.(old, ctx);
  try { ctx.db.prepare(`DELETE FROM ${table(def)} WHERE id=? AND company_id=?`).run(old.id, ctx.companyId); }
  catch (e) { throw mapDbError(e, def); }
  def.afterDelete?.(ctx, old);
  audit(ctx, def.key, old.id, 'delete', labelOf(def, old));
  return { ok: true };
}

export function runAction(ctx, def, id, key) {
  const act = (def.actions || []).find((a) => a.key === key);
  if (!act) throw new HttpError(404, 'عملیات نامعتبر است');
  const rec = getRow(ctx, def, id, { raw: true });
  if (!rec) throw new HttpError(404, 'رکورد یافت نشد');
  if (!act.from.includes(rec.status)) throw new HttpError(409, 'این عملیات در وضعیت فعلی مجاز نیست');
  act.run?.(ctx, rec);
  ctx.db.prepare(`UPDATE ${table(def)} SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?`).run(act.to, rec.id, ctx.companyId);
  audit(ctx, def.key, rec.id, 'action:' + key, labelOf(def, rec));
  return getOne(ctx, def, id);
}

// فهرست سبک برای انتخابگرها
export function lookup(ctx, def) {
  const rows = ctx.db.prepare(`SELECT * FROM ${table(def)} WHERE company_id=? ORDER BY id DESC LIMIT 2000`).all(ctx.companyId);
  return rows.map((r) => ({ id: r.id, label: labelOf(def, r), price: r.price ?? r.cost ?? null, cost: r.cost ?? null, unit: r.unit ?? null }));
}

export function toCsv(ctx, def) {
  const rows = ctx.db.prepare(`SELECT * FROM ${table(def)} WHERE company_id=? ORDER BY id`).all(ctx.companyId).map((r) => decode(def, r));
  withLabels(ctx, def, rows);
  const fields = def.fields.filter((f) => f.type !== 'lines' && f.type !== 'password');
  const esc = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // جلوگیری از CSV/Formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const val = (r, f) => f.type === 'ref' ? (r._l?.[f.k] ?? '') : f.type === 'select' ? (f.options.find((o) => o.v === r[f.k])?.l ?? r[f.k]) : r[f.k];
  const lines = [fields.map((f) => esc(f.label)).join(',')];
  for (const r of rows) lines.push(fields.map((f) => esc(val(r, f))).join(','));
  return '﻿' + lines.join('\r\n');
}
