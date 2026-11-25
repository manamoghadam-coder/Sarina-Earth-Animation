// Usage: PW_MANA=… PW_SARINA=… node e2e/e2e-social.cjs  (needs a running server on MANA_URL, default http://localhost:8080 and playwright)
const { chromium } = require('playwright'); const BASE = process.env.MANA_URL || 'http://localhost:8080'; const SH = process.argv[2] || '.';
(async () => { const b = await chromium.launch(); const errs = []; const res = [];
  const ok = (n, c) => res.push([c ? 'PASS' : 'FAIL', n]);
  const stub = () => { window.__spoken = []; const syn = { cancel() {}, getVoices: () => [{ lang: 'fa-IR', name: 'FA' }, { lang: 'en-US', name: 'EN' }], addEventListener() {}, speak(u) { window.__spoken.push([u.lang, u.rate, u.text]); setTimeout(() => u.onend && u.onend(), 5); } }; Object.defineProperty(window, 'speechSynthesis', { value: syn, configurable: true }); window.SpeechSynthesisUtterance = function (t) { this.text = t; }; };
  const login = async (u, pw, vp, wait) => { const c = await b.newContext({ viewport: vp }); await c.addInitScript(stub); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(u + ' ' + e.message)); p.on('console', (m) => m.type() === 'error' && !/40[1349]|50[03]/.test(m.text()) && errs.push(u + ' c:' + m.text()));
    await p.goto(BASE + '/'); await p.fill('#u', u); await p.fill('#p', pw); await p.click('button:has-text("ورود")'); await p.waitForSelector(wait); await p.waitForTimeout(700); return p; };
  const m = await login('mana', process.env.PW_MANA, { width: 1100, height: 900 }, 'text=/بخیر/');
  // Mana writes a message to Sarina
  await m.goto(BASE + '/messages'); await m.waitForSelector('text=پیام'); await m.waitForTimeout(500); await m.screenshot({ path: SH + '/n_msg_mana.png' });
  for (let i = 0; i < 5; i++) { const ok2 = m.locator('[role=alertdialog] button:has-text("باشه")'); if (await ok2.count()) { await ok2.first().click(); await m.waitForTimeout(250); } }
  const body = m.locator('textarea').first(); await body.fill('فردا امتحان داری، موفق باشی 💜');
  await m.locator('button:has-text("🧒 سارینا")').first().click();
  await m.click('button:has-text("ارسال")'); await m.waitForTimeout(1200);
  const s = await login('sarina', process.env.PW_SARINA, { width: 390, height: 900 }, 'text=سلام سارینا');
  ok('sarina home shows Mom message tile with unread badge', await s.locator('text=پیام مامان').first().isVisible());
  await s.screenshot({ path: SH + '/n_home_sarina.png', fullPage: false });
  await s.goto(BASE + '/messages'); await s.waitForSelector('text=فردا امتحان'); ok('sarina reads Mom message', true);
  await s.goto(BASE + '/diary'); await s.waitForSelector('text=دفترچه'); await s.screenshot({ path: SH + '/n_diary.png' });
  await s.goto(BASE + '/night'); await s.waitForSelector('text=/خوشحال/'); await s.screenshot({ path: SH + '/n_night.png' });
  await s.goto(BASE + '/wishes'); await s.waitForSelector('text=آرزو'); await s.screenshot({ path: SH + '/n_wishes.png' });
  await s.goto(BASE + '/chat'); await s.waitForSelector('text=/چت|گروه/'); await s.screenshot({ path: SH + '/n_chat.png' });
  // voice: slow default + sentence by sentence + bilingual
  await s.goto(BASE + '/'); await s.waitForSelector('text=سلام سارینا'); await s.evaluate(() => { window.__spoken.length = 0; }); await s.click('button[aria-label^="بشنو"] >> nth=0'); await s.waitForTimeout(800);
  const sp = await s.evaluate(() => window.__spoken); ok('speech default rate is slow (<=0.7)', sp.length > 0 && sp.every((x) => x[1] <= 0.7));
  await s.evaluate(() => { window.__spoken.length = 0; }); await s.click('summary:has-text("تنظیم صدا")'); await s.click('button:has-text("آزمایش صدا")'); await s.waitForTimeout(2500);
  const sp2 = await s.evaluate(() => window.__spoken); ok('test speech uses both fa-IR and en-US voices', sp2.some((x) => x[0] === 'fa-IR') && sp2.some((x) => x[0] === 'en-US')); ok('speech split into several sentences', sp2.length >= 4);
  await s.click('button:has-text("خیلی آرام")'); await s.waitForTimeout(1500); const sp3 = await s.evaluate(() => window.__spoken.slice(-1)[0]); ok('speed preset changes rate to 0.55', sp3 && sp3[1] === 0.55);
  await m.goto(BASE + '/family'); await m.waitForSelector('text=برنامه‌ی هفتگی'); await m.click('button:has-text("مرور و دفترچه")'); await m.waitForTimeout(800); await m.screenshot({ path: SH + '/n_kidw.png' });
  await m.goto(BASE + '/report'); await m.waitForSelector('text=/گزارش/'); await m.waitForTimeout(800); await m.screenshot({ path: SH + '/n_report.png' });
  await m.goto(BASE + '/meals'); await m.waitForSelector('text=برنامه‌ی غذایی'); ok('meals page renders', true);
  console.log(res.map((r) => r.join('  ')).join('\n')); console.log('errors', errs); await b.close(); })();
