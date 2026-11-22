// تولید صنعتی: تکمیل دستور تولید (ضایعات، مرکز کار)، MRP، ظرفیت و نگهداری و تعمیرات (PM)
import { HttpError, bad, today, addDays, daysBetween } from './util.js';
import { stockOf, insertMove, applyAvgCost, invKey } from './stock.js';
import { autoPost, acct } from './accounting.js';

const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const r2 = (x) => Math.round(x * 100) / 100;

export async function loadBom(ctx, bomId) {
  const b = (await ctx.db.get('SELECT * FROM e_boms WHERE id=? AND company_id=?', bomId, ctx.companyId));
  if (!b) throw bad('فرمول ساخت (BOM) یافت نشد');
  b.lines = parse(b.lines);
  return b;
}

// planning=true: درصد ضایعات برنامه‌ای BOM هم لحاظ می‌شود (برای MRP)
export function requirements(bom, qty, planning) {
  const batches = (qty / bom.output_qty) * (planning ? 1 + (bom.scrap_pct || 0) / 100 : 1);
  return bom.lines.map((l) => ({ item_id: l.item_id, need: r2(l.qty * batches) }));
}

export function plannedHours(bom, qty) { return r2((qty / bom.output_qty) * (bom.hours_per_batch || 0)); }

export async function completeWorkOrder(ctx, wo) {
  const bom = await loadBom(ctx, wo.bom_id);
  if (bom.status !== 'active') throw new HttpError(409, 'BOM غیرفعال است');
  const good = wo.actual_qty || wo.qty, scrap = wo.scrap_qty || 0, made = good + scrap;
  const reqs = requirements(bom, made, false);
  const item = async (id) => (await ctx.db.get('SELECT id,code,name,cost,kind FROM e_items WHERE id=? AND company_id=?', id, ctx.companyId));
  for (const r of reqs) {
    const have = await stockOf(ctx.db, ctx.companyId, r.item_id, wo.warehouse_id);
    if (have < r.need) throw new HttpError(409, `موجودی «${(await item(r.item_id)).name}» در انبار کافی نیست (موجودی ${have}، نیاز ${r.need})`);
  }
  let material = 0; const byAcc = {};
  for (const r of reqs) {
    const it = await item(r.item_id), val = r2(r.need * (it.cost || 0));
    material += val; const k = invKey(it.kind); byAcc[k] = r2((byAcc[k] || 0) + val);
    await insertMove(ctx, { kind: 'out', item_id: r.item_id, warehouse_id: wo.warehouse_id, qty: r.need, ref: wo.number, note: 'مصرف در تولید', source: wo.number });
  }
  // دستمزد/سربار = مبلغ ثابت BOM + ساعت کار × نرخ ساعتی مرکز کار
  const wc = bom.work_center_id ? (await ctx.db.get('SELECT hourly_rate FROM e_work_centers WHERE id=? AND company_id=?', bom.work_center_id, ctx.companyId)) : null;
  const hours = wo.run_hours ?? plannedHours(bom, made);
  const conversion = r2(bom.conversion_cost * (made / bom.output_qty) + (wc ? hours * (wc.hourly_rate || 0) : 0));
  const total = r2(material + conversion), unit = r2(total / good); // هزینه‌ی ضایعات روی محصول سالم جذب می‌شود
  await applyAvgCost(ctx, bom.product_id, good, unit);
  await insertMove(ctx, { kind: 'in', item_id: bom.product_id, warehouse_id: wo.warehouse_id, qty: good, ref: wo.number, note: 'تولید محصول', source: wo.number });
  (await ctx.db.run('UPDATE e_work_orders SET material_cost=?, conversion_cost=?, unit_cost=?, actual_qty=?, scrap_cost=?, yield_pct=?, run_hours=? WHERE id=? AND company_id=?', r2(material), conversion, unit, good, r2(unit * scrap), Math.round((good / made) * 1000) / 10, hours, wo.id, ctx.companyId));

  const prod = await item(bom.product_id);
  await autoPost(ctx, {
    date: today(), description: `تکمیل دستور تولید ${wo.number}`, source: 'work_orders', source_ref: wo.id,
    lines: [
      { account_id: await acct(ctx, invKey(prod.kind)), debit: total },
      ...(await Promise.all(Object.entries(byAcc).map(async ([k, v]) => ({ account_id: await acct(ctx, k), credit: v })))),
      { account_id: await acct(ctx, 'conv_absorbed'), credit: conversion },
    ],
  });
}

export async function mrp(ctx) {
  const need = new Map();
  const open = (await ctx.db.all(`SELECT * FROM e_work_orders WHERE company_id=? AND status IN ('draft','released')`, ctx.companyId));
  for (const wo of open) {
    const bom = (await ctx.db.get('SELECT * FROM e_boms WHERE id=? AND company_id=?', wo.bom_id, ctx.companyId));
    if (!bom) continue;
    bom.lines = parse(bom.lines);
    for (const r of requirements(bom, wo.actual_qty || wo.qty, true)) need.set(r.item_id, (need.get(r.item_id) || 0) + r.need);
  }
  const incoming = new Map();
  for (const po of (await ctx.db.all(`SELECT lines FROM e_purchase_orders WHERE company_id=? AND status='approved'`, ctx.companyId)))
    for (const l of parse(po.lines)) incoming.set(l.item_id, (incoming.get(l.item_id) || 0) + l.qty);
  const rows = [];
  for (const [id, required] of need) {
    const it = await ctx.db.get('SELECT code,name,unit FROM e_items WHERE id=?', id);
    const onhand = await stockOf(ctx.db, ctx.companyId, id), inc = incoming.get(id) || 0;
    rows.push({ item_id: id, code: it.code, name: it.name, unit: it.unit, required: r2(required), onhand: r2(onhand), incoming: r2(inc), shortage: r2(Math.max(0, required - onhand - inc)), uncovered: r2(Math.max(0, required - onhand)) });
  }
  rows.sort((a, b) => b.shortage - a.shortage);
  return { rows, workOrders: open.length };
}

// ظرفیت مراکز کار: بار ساعتی دستورهای باز در برابر ظرفیت روزانه
export async function capacity(ctx) {
  const rows = (await ctx.db.all(`SELECT w.id, w.name, w.capacity_hours_day cap, w.hourly_rate, w.status,
      COALESCE(SUM(o.planned_hours),0) hours, COUNT(o.id) orders, MIN(o.due_date) earliest
    FROM e_work_centers w
    LEFT JOIN e_boms b ON b.work_center_id=w.id AND b.company_id=w.company_id
    LEFT JOIN e_work_orders o ON o.bom_id=b.id AND o.company_id=w.company_id AND o.status IN ('draft','released')
    WHERE w.company_id=? GROUP BY w.id ORDER BY w.name`, ctx.companyId));
  return { rows: rows.map((r) => ({ ...r, days: r.cap > 0 ? r2(r.hours / r.cap) : null })) };
}

// ─── نگهداری و تعمیرات ───
export async function pmRows(ctx) {
  const t = today();
  return (await ctx.db.all(`SELECT m.id,m.code,m.name,m.status,m.last_pm_date,m.next_pm_date,m.pm_interval_days,
      (SELECT COUNT(*) FROM e_maintenance_orders o WHERE o.machine_id=m.id AND o.status IN ('open','in_progress')) open_orders,
      (SELECT COUNT(*) FROM e_maintenance_orders o WHERE o.machine_id=m.id AND o.kind='preventive' AND o.status IN ('open','in_progress')) open_pm,
      (SELECT COALESCE(SUM(o.downtime_hours),0) FROM e_maintenance_orders o WHERE o.machine_id=m.id AND o.status='done' AND o.completed_date>=?) downtime90
    FROM e_machines m WHERE m.company_id=? AND m.status!='retired' ORDER BY m.next_pm_date IS NULL, m.next_pm_date`, addDays(t, -90), ctx.companyId))
    .map((r) => {
      const left = r.next_pm_date ? daysBetween(t, r.next_pm_date) : null;
      return { ...r, days_left: left, pm_state: left === null ? 'none' : left < 0 ? 'overdue' : left <= 7 ? 'soon' : 'ok' };
    });
}
export const pmDue = async (ctx) => (await pmRows(ctx)).filter((r) => (r.pm_state === 'overdue' || r.pm_state === 'soon') && !r.open_pm);

export function nextPm(machine) {
  if (!machine.pm_interval_days) return null;
  return addDays(machine.last_pm_date || today(), machine.pm_interval_days);
}

export async function completeMaintenance(ctx, mo) {
  const m = (await ctx.db.get('SELECT * FROM e_machines WHERE id=? AND company_id=?', mo.machine_id, ctx.companyId));
  const t = today();
  (await ctx.db.run('UPDATE e_maintenance_orders SET completed_date=? WHERE id=? AND company_id=?', t, mo.id, ctx.companyId));
  if (mo.kind === 'preventive') { m.last_pm_date = t; (await ctx.db.run('UPDATE e_machines SET last_pm_date=?, next_pm_date=? WHERE id=?', t, nextPm(m), m.id)); }
  (await ctx.db.run(`UPDATE e_machines SET status='operational' WHERE id=?`, m.id));
  if (mo.cost > 0) await autoPost(ctx, { date: t, description: `هزینه نگهداری و تعمیرات ${mo.number} (${m.name})`, source: 'maintenance_orders', source_ref: mo.id,
    lines: [{ account_id: await acct(ctx, 'exp_maintenance'), debit: mo.cost }, { account_id: await acct(ctx, 'bank'), credit: mo.cost }] });
}
