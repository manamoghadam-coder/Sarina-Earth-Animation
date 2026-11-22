import { ENTITIES } from './entities.js';
import { HttpError, bad, isoDate, today } from './util.js';
import { hashPassword } from './auth.js';

const q = (s) => `"${s}"`;
const table = (def) => 'e_' + def.key;

export async function audit(ctx, entity, recId, action, detail) {
  (await ctx.db.run('INSERT INTO audit_log (company_id,user_id,username,entity,rec_id,action,detail) VALUES (?,?,?,?,?,?,?)', ctx.companyId ?? null, ctx.user.id, ctx.user.username, entity, recId ?? null, action, detail ? String(detail).slice(0, 500) : null));
}

export async function nextNumber(ctx, def) {
  (await ctx.db.run('INSERT INTO counters (company_id,key,n) VALUES (?,?,1) ON CONFLICT(company_id,key) DO UPDATE SET n=counters.n+1', ctx.companyId, def.key));
  const n = (await ctx.db.get('SELECT n FROM counters WHERE company_id=? AND key=?', ctx.companyId, def.key)).n;
  return `${def.numbering}-${String(n).padStart(4, '0')}`;
}

async function coerce(ctx, def, f, v) {
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
      if (!(await ctx.db.get(`SELECT 1 FROM e_${f.ref} WHERE id=? AND company_id=?`, id, ctx.companyId))) throw bad(`«${f.label}» یافت نشد`);
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

export async function getRow(ctx, def, id, { raw } = {}) {
  const row = (await ctx.db.get(`SELECT * FROM ${table(def)} WHERE id=? AND company_id=?`, Number(id), ctx.companyId));
  if (!row) return null;
  if (raw) { for (const f of def.fields) if (f.type === 'lines') { try { row[f.k] = JSON.parse(row[f.k] || '[]'); } catch { row[f.k] = []; } } return row; }
  return decode(def, row);
}

export function labelOf(def, row) {
  return def.label.map((k) => row[k]).filter((x) => x !== null && x !== undefined && x !== '').join(' · ') || `#${row.id}`;
}

// افزودن برچسب فیلدهای ارجاعی به ردیف‌ها (برای نمایش)
async function withLabels(ctx, def, rows) {
  for (const f of def.fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.k]).filter(Boolean))];
    if (!ids.length) continue;
    const rdef = ENTITIES[f.ref];
    const found = (await ctx.db.all(`SELECT * FROM e_${f.ref} WHERE company_id=? AND id IN (${ids.map(() => '?').join(',')})`, ctx.companyId, ...ids));
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

export async function list(ctx, def, query) {
  const { sql, extra } = filterClause(def, query);
  const size = Math.min(Math.max(parseInt(query.size) || 25, 1), 500);
  const page = Math.max(parseInt(query.page) || 1, 1);
  const sortable = new Set(['id', 'created_at', ...def.fields.map((f) => f.k)]);
  const sort = sortable.has(query.sort) ? query.sort : (def.sortDefault || 'id');
  const dir = query.dir === 'asc' ? 'ASC' : (query.dir === 'desc' ? 'DESC' : (sort === 'id' || def.sortDefault === sort ? 'DESC' : 'ASC'));
  const total = (await ctx.db.get(`SELECT COUNT(*) n FROM ${table(def)} WHERE ${sql}`, ctx.companyId, ...extra)).n;
  const rows = (await ctx.db.all(`SELECT * FROM ${table(def)} WHERE ${sql} ORDER BY ${q(sort)} ${dir}, id DESC LIMIT ? OFFSET ?`, ctx.companyId, ...extra, size, (page - 1) * size)).map((r) => decode(def, r));
  return { rows: await withLabels(ctx, def, rows), total, page, size };
}

export async function getOne(ctx, def, id) {
  const r = await getRow(ctx, def, id);
  if (!r) throw new HttpError(404, 'رکورد یافت نشد');
  await withLabels(ctx, def, [r]);
  return r;
}

async function build(ctx, def, input, old) {
  const rec = old ? { ...old } : {};
  for (const f of def.fields) {
    if (f.readonly) {
      if (!old && f.default !== undefined) rec[f.k] = f.default;
      continue;
    }
    if (input[f.k] !== undefined) {
      if (f.type === 'password' && (input[f.k] === '' || input[f.k] === null)) continue; // بدون تغییر
      rec[f.k] = await coerce(ctx, def, f, input[f.k]);
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
  const msg = String(e.message) + ' ' + (e.detail || '') + ' ' + (e.constraint || '');
  if (/unique|duplicate key/i.test(msg)) {
    const f = def.fields.find((x) => x.unique && msg.includes(x.k)) || def.fields.find((x) => x.unique);
    return new HttpError(409, `«${f?.label || 'مقدار'}» تکراری است`);
  }
  return e;
}

export async function create(ctx, def, input) {
  const rec = await build(ctx, def, input, null);
  await def.validate?.(ctx, rec, null);
  if (def.numbering) rec.number = await nextNumber(ctx, def);
  const fields = def.fields;
  try {
    const id = (await ctx.db.insert(`INSERT INTO ${table(def)} (company_id,${fields.map((f) => q(f.k)).join(',')},created_by) VALUES (?,${fields.map(() => '?').join(',')},?)`, ctx.companyId, ...fields.map((f) => persistValue(f, rec[f.k])), ctx.user.id));
    const saved = await getRow(ctx, def, id, { raw: true });
    await def.afterSave?.(ctx, saved, null);
    await audit(ctx, def.key, id, 'create', labelOf(def, saved));
    return await getOne(ctx, def, id);
  } catch (e) { throw mapDbError(e, def); }
}

export async function update(ctx, def, id, input) {
  if (def.noEdit) throw new HttpError(405, 'این مورد قابل ویرایش نیست');
  const old = await getRow(ctx, def, id, { raw: true });
  if (!old) throw new HttpError(404, 'رکورد یافت نشد');
  const rec = await build(ctx, def, input, old);
  await def.validate?.(ctx, rec, old);
  const fields = def.fields;
  try {
    (await ctx.db.run(`UPDATE ${table(def)} SET ${fields.map((f) => `${q(f.k)}=?`).join(',')}, updated_at=datetime('now') WHERE id=? AND company_id=?`, ...fields.map((f) => persistValue(f, rec[f.k])), old.id, ctx.companyId));
    const saved = await getRow(ctx, def, id, { raw: true });
    await def.afterSave?.(ctx, saved, old);
    await audit(ctx, def.key, old.id, 'update', labelOf(def, saved));
    return await getOne(ctx, def, id);
  } catch (e) { throw mapDbError(e, def); }
}

export async function remove(ctx, def, id) {
  const old = await getRow(ctx, def, id, { raw: true });
  if (!old) throw new HttpError(404, 'رکورد یافت نشد');
  await def.canDelete?.(old, ctx);
  try { (await ctx.db.run(`DELETE FROM ${table(def)} WHERE id=? AND company_id=?`, old.id, ctx.companyId)); }
  catch (e) { throw mapDbError(e, def); }
  await def.afterDelete?.(ctx, old);
  await audit(ctx, def.key, old.id, 'delete', labelOf(def, old));
  return { ok: true };
}

export async function runAction(ctx, def, id, key) {
  const act = (def.actions || []).find((a) => a.key === key);
  if (!act) throw new HttpError(404, 'عملیات نامعتبر است');
  const rec = await getRow(ctx, def, id, { raw: true });
  if (!rec) throw new HttpError(404, 'رکورد یافت نشد');
  if (!act.from.includes(rec.status)) throw new HttpError(409, 'این عملیات در وضعیت فعلی مجاز نیست');
  await act.run?.(ctx, rec);
  (await ctx.db.run(`UPDATE ${table(def)} SET status=?, updated_at=datetime('now') WHERE id=? AND company_id=?`, act.to, rec.id, ctx.companyId));
  await audit(ctx, def.key, rec.id, 'action:' + key, labelOf(def, rec));
  return await getOne(ctx, def, id);
}

// فهرست سبک برای انتخابگرها
export async function lookup(ctx, def) {
  const rows = (await ctx.db.all(`SELECT * FROM ${table(def)} WHERE company_id=? ORDER BY id DESC LIMIT 2000`, ctx.companyId));
  return rows.map((r) => ({ id: r.id, label: labelOf(def, r), price: r.price ?? r.cost ?? null, cost: r.cost ?? null, unit: r.unit ?? null }));
}

export async function toCsv(ctx, def) {
  const rows = (await ctx.db.all(`SELECT * FROM ${table(def)} WHERE company_id=? ORDER BY id`, ctx.companyId)).map((r) => decode(def, r));
  await withLabels(ctx, def, rows);
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
