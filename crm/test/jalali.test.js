'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('../public/jalali.js');

test('جلالی با Intl برای ۳۰ سال روزبه‌روز یکسان است و رفت‌وبرگشت سالم', () => {
  const fmt = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  let d = Date.UTC(2005, 0, 1), n = 0;
  const end = Date.UTC(2035, 0, 1);
  for (; d < end; d += 86400000, n++) {
    const dt = new Date(d);
    const p = Object.fromEntries(fmt.formatToParts(dt).map((x) => [x.type, x.value]));
    const got = J.toJalali(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    assert.deepEqual([got.jy, got.jm, got.jd], [+p.year, +p.month, +p.day], dt.toISOString());
    const back = J.toGregorian(got.jy, got.jm, got.jd);
    assert.deepEqual([back.gy, back.gm, back.gd], [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]);
  }
  assert.ok(n > 10000);
});
test('تبدیل رشته و اعتبارسنجی', () => {
  assert.equal(J.jalaliStrToIso('۱۴۰۳/۰۱/۰۱'), '2024-03-20');
  assert.equal(J.isoToJalaliStr('2024-03-20T10:00:00Z'), '1403/01/01');
  assert.equal(J.jalaliStrToIso('1403/12/30'), '2025-03-20'); // 1403 کبیسه است
  assert.equal(J.jalaliStrToIso('1404/12/30'), null);
  assert.equal(J.jalaliStrToIso('1404/07/31'), null);
  assert.equal(J.jalaliStrToIso('abc'), null);
});
