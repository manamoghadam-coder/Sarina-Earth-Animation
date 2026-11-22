// تولید صنعتی: تکمیل دستور تولید (مصرف مواد، ورود محصول، بهای تمام‌شده) و MRP ساده
import { HttpError, bad } from './util.js';
import { stockOf, insertMove, applyAvgCost, invKey } from './stock.js';
import { autoPost, acct } from './accounting.js';

const parse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const r2 = (x) => Math.round(x * 100) / 100;

export function loadBom(ctx, bomId) {
  const b = ctx.db.prepare('SELECT * FROM e_boms WHERE id=? AND company_id=?').get(bomId, ctx.companyId);
  if (!b) throw bad('فرمول ساخت (BOM) یافت نشد');
  b.lines = parse(b.lines);
  return b;
}

export function requirements(ctx, bom, goodQty) {
  const batches = goodQty / bom.output_qty;
  return bom.lines.map((l) => ({ item_id: l.item_id, need: r2(l.qty * batches) }));
}

export function completeWorkOrder(ctx, wo) {
  const bom = loadBom(ctx, wo.bom_id);
  if (bom.status !== 'active') throw new HttpError(409, 'BOM غیرفعال است');
  const good = wo.actual_qty || wo.qty;
  const reqs = requirements(ctx, bom, good);
  const item = (id) => ctx.db.prepare('SELECT id,code,name,cost,kind FROM e_items WHERE id=? AND company_id=?').get(id, ctx.companyId);
  // کنترل موجودی مواد
  for (const r of reqs) {
    const have = stockOf(ctx.db, ctx.companyId, r.item_id, wo.warehouse_id);
    if (have < r.need) throw new HttpError(409, `موجودی «${item(r.item_id).name}» در انبار کافی نیست (موجودی ${have}، نیاز ${r.need})`);
  }
  // مصرف مواد به بهای میانگین فعلی
  let material = 0; const byAcc = {};
  for (const r of reqs) {
    const it = item(r.item_id), val = r2(r.need * (it.cost || 0));
    material += val; const k = invKey(it.kind); byAcc[k] = r2((byAcc[k] || 0) + val);
    insertMove(ctx, { kind: 'out', item_id: r.item_id, warehouse_id: wo.warehouse_id, qty: r.need, ref: wo.number, note: 'مصرف در تولید', source: wo.number });
  }
  const conversion = r2(bom.conversion_cost * (good / bom.output_qty));
  const total = r2(material + conversion), unit = r2(total / good);
  applyAvgCost(ctx, bom.product_id, good, unit);
  insertMove(ctx, { kind: 'in', item_id: bom.product_id, warehouse_id: wo.warehouse_id, qty: good, ref: wo.number, note: 'تولید محصول', source: wo.number });
  ctx.db.prepare('UPDATE e_work_orders SET material_cost=?, conversion_cost=?, unit_cost=?, actual_qty=? WHERE id=? AND company_id=?').run(r2(material), conversion, unit, good, wo.id, ctx.companyId);

  // سند: بدهکار موجودی کالای ساخته‌شده؛ بستانکار مواد مصرفی + دستمزد و سربار جذب‌شده
  const prod = item(bom.product_id);
  autoPost(ctx, {
    date: new Date().toISOString().slice(0, 10), description: `تکمیل دستور تولید ${wo.number}`, source: 'work_orders', source_ref: wo.id,
    lines: [
      { account_id: acct(ctx, invKey(prod.kind)), debit: total },
      ...Object.entries(byAcc).map(([k, v]) => ({ account_id: acct(ctx, k), credit: v })),
      { account_id: acct(ctx, 'conv_absorbed'), credit: conversion },
    ],
  });
}

// برنامه‌ریزی نیازمندی مواد (MRP ساده): دستورهای پیش‌نویس/آزادشده در برابر موجودی و سفارش‌های خرید تأییدشده
export function mrp(ctx) {
  const need = new Map();
  const open = ctx.db.prepare(`SELECT * FROM e_work_orders WHERE company_id=? AND status IN ('draft','released')`).all(ctx.companyId);
  for (const wo of open) {
    const bom = ctx.db.prepare('SELECT * FROM e_boms WHERE id=? AND company_id=?').get(wo.bom_id, ctx.companyId);
    if (!bom) continue;
    bom.lines = parse(bom.lines);
    for (const r of requirements(ctx, bom, wo.actual_qty || wo.qty)) need.set(r.item_id, (need.get(r.item_id) || 0) + r.need);
  }
  const incoming = new Map();
  for (const po of ctx.db.prepare(`SELECT lines FROM e_purchase_orders WHERE company_id=? AND status='approved'`).all(ctx.companyId))
    for (const l of parse(po.lines)) incoming.set(l.item_id, (incoming.get(l.item_id) || 0) + l.qty);
  const rows = [...need].map(([id, required]) => {
    const it = ctx.db.prepare('SELECT code,name,unit FROM e_items WHERE id=?').get(id);
    const onhand = stockOf(ctx.db, ctx.companyId, id), inc = incoming.get(id) || 0;
    return { item_id: id, code: it.code, name: it.name, unit: it.unit, required: r2(required), onhand: r2(onhand), incoming: r2(inc), shortage: r2(Math.max(0, required - onhand - inc)), uncovered: r2(Math.max(0, required - onhand)) };
  }).sort((a, b) => b.shortage - a.shortage);
  return { rows, workOrders: open.length };
}
