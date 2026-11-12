/* تبدیل تقویم شمسی ⇄ میلادی (الگوریتم jalaali) + کمک‌های ورودی/نمایش تاریخ */
(function (root) {
  'use strict';
  const div = (a, b) => ~~(a / b), mod = (a, b) => a - ~~(a / b) * b;
  const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function jalCal(jy) {
    let gy = jy + 621, leapJ = -14, jp = BREAKS[0], jm, jump = 0, i;
    for (i = 1; i < BREAKS.length; i++) {
      jm = BREAKS[i]; jump = jm - jp;
      if (jy < jm) break;
      leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4); jp = jm;
    }
    let n = jy - jp;
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
  }
  const g2d = (gy, gm, gd) => {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  };
  const d2g = (jdn) => {
    let j = 4 * jdn + 139361631;
    j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = div(mod(j, 1461), 4) * 5 + 308;
    const gd = div(mod(i, 153), 5) + 1, gm = mod(div(i, 153), 12) + 1;
    return { gy: div(j, 1461) - 100100 + div(8 - gm, 6), gm, gd };
  };
  const j2d = (jy, jm, jd) => {
    const r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  };
  function d2j(jdn) {
    const g = d2g(jdn);
    let jy = g.gy - 621;
    const r = jalCal(jy), jdn1f = g2d(g.gy, 3, r.march);
    let k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      k -= 186;
    } else { jy -= 1; k += 179; if (r.leap === 1) k += 1; }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  const isLeapJ = (jy) => jalCal(jy).leap === 0;
  const daysInJMonth = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJ(jy) ? 30 : 29);

  const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd));
  const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd));
  const p2 = (n) => String(n).padStart(2, '0');

  /** ISO (YYYY-MM-DD ...) → "1405/08/21" با ارقام لاتین */
  function isoToJalaliStr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const j = toJalali(+m[1], +m[2], +m[3]);
    return `${j.jy}/${p2(j.jm)}/${p2(j.jd)}`;
  }
  /** "۱۴۰۵/۰۸/۲۱" (ارقام فارسی/عربی/لاتین، جداکننده / - .) → ISO یا null */
  function jalaliStrToIso(s) {
    const t = String(s || '').replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).trim();
    const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(t);
    if (!m) return null;
    const jy = +m[1], jm = +m[2], jd = +m[3];
    if (jy < 1200 || jy > 1700 || jm < 1 || jm > 12 || jd < 1 || jd > daysInJMonth(jy, jm)) return null;
    const g = toGregorian(jy, jm, jd);
    return `${g.gy}-${p2(g.gm)}-${p2(g.gd)}`;
  }
  const api = { toJalali, toGregorian, isoToJalaliStr, jalaliStrToIso, daysInJMonth, isLeapJ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Jalali = api;
})(typeof window !== 'undefined' ? window : globalThis);
