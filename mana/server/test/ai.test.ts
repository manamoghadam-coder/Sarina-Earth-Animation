import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseTime, parseDate, ruleParse } from '../src/ai.ts';
process.env.TZ = 'UTC';
test('amounts', () => {
  assert.equal(parseAmount('امروز ۸۰۰ هزار تومان خرید'), 800000);
  assert.equal(parseAmount('هشتصد هزار تومان'), 800000);
  assert.equal(parseAmount('2.5 میلیون تومان'), 2500000);
  assert.equal(parseAmount('۳۵۰۰۰۰ تومان'), 350000);
  assert.equal(parseAmount('دو میلیون و پانصد هزار تومان'), 2500000);
});
test('times', () => {
  assert.equal(parseTime('فردا ساعت ۱۰ جلسه'), '10:00');
  assert.equal(parseTime('ساعت ۱۶:۳۰'), '16:30');
  assert.equal(parseTime('ساعت ۴ عصر'), '16:00');
  assert.equal(parseTime('۱۰ شب'), '22:00');
});
test('dates (reference: Saturday 2026-11-21)', () => {
  assert.equal(parseDate('فردا', '2026-11-21'), '2026-11-22');
  assert.equal(parseDate('پس فردا', '2026-11-21'), '2026-11-23');
  assert.equal(parseDate('سه شنبه', '2026-11-21'), '2026-11-24');
  assert.equal(parseDate('شنبه', '2026-11-21'), '2026-11-28');
});
test('intents', () => {
  const t = '2026-11-21';
  assert.equal(ruleParse('فردا ساعت ۱۰ جلسه دارم.', t).intent, 'create_event');
  const e = ruleParse('امروز ۸۰۰ هزار تومان خرید خانه داشتم.', t); assert.equal(e.intent, 'create_transaction'); assert.equal((e as any).amount, 800000); assert.equal((e as any).category, 'خانه');
  const c = ruleParse('برای سارینا فردا تمرین سنتور ثبت کن.', t); assert.equal(c.intent, 'create_child_activity'); assert.equal((c as any).child, 'sarina'); assert.equal((c as any).date, '2026-11-22');
  assert.equal(ruleParse('سامان امروز تکالیفش را انجام داده است.', t).intent, 'child_done');
  assert.equal(ruleParse('گزارش هزینه‌های این ماه را بده.', t).intent, 'report_expenses');
  assert.equal(ruleParse('سه کار مهم فردا را مشخص کن.', t).intent, 'top_priorities');
  assert.equal(ruleParse('hello', t).intent, 'unknown');
});
