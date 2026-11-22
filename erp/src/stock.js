// توابع مشترک انبار (بدون وابستگی به entities.js تا چرخه‌ی import ایجاد نشود)
export async function stockOf(db, companyId, itemId, warehouseId) {
  const q = `SELECT COALESCE(SUM(CASE kind WHEN 'in' THEN qty ELSE -qty END),0) s FROM e_stock_moves WHERE company_id=? AND item_id=?` + (warehouseId ? ' AND warehouse_id=?' : '');
  return (await db.get(q, ...(warehouseId ? [companyId, itemId, warehouseId] : [companyId, itemId]))).s;
}

export async function insertMove(ctx, m) {
  (await ctx.db.run(`INSERT INTO e_stock_moves (company_id,date,kind,item_id,warehouse_id,qty,reference,note,source,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`, ctx.companyId, m.date || new Date().toISOString().slice(0, 10), m.kind, m.item_id, m.warehouse_id, m.qty, m.ref ?? null, m.note ?? null, m.source ?? null, ctx.user.id));
}

// میانگین موزون متحرک: باید «قبل از» ثبت تراکنش ورود صدا زده شود
export async function applyAvgCost(ctx, itemId, qtyIn, unitCost) {
  const it = (await ctx.db.get('SELECT cost FROM e_items WHERE id=? AND company_id=?', itemId, ctx.companyId));
  const have = Math.max(await stockOf(ctx.db, ctx.companyId, itemId), 0);
  const cost = have + qtyIn > 0 ? (have * (it?.cost || 0) + qtyIn * unitCost) / (have + qtyIn) : unitCost;
  (await ctx.db.run('UPDATE e_items SET cost=? WHERE id=? AND company_id=?', Math.round(cost * 100) / 100, itemId, ctx.companyId));
}

// حساب موجودی مربوط به نوع کالا
export const invKey = (kind) => (kind === 'finished' ? 'inv_fg' : 'inv_raw');
