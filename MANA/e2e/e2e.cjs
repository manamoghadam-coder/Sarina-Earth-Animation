const { chromium } = require('playwright');
// Usage: MANA_URL=http://localhost:8080 PW_MANA=… PW_SARINA=… PW_SAMAN=… node e2e/e2e.cjs <screenshot-dir>
// Requires `playwright` (npm i -g playwright) and a seeded database (npm run seed in server/). Speech APIs are stubbed.
const SP = process.argv[2] || '.';
const URL = process.env.MANA_URL || URL;
const PW = { mana: process.env.PW_MANA, sarina: process.env.PW_SARINA, saman: process.env.PW_SAMAN };
const stub = () => {
  window.__spoken = [];
  const synth = { speaking: false, cancel() {}, pause() {}, resume() {}, getVoices: () => [{ lang: 'fa-IR', name: 'Fake Persian' }], addEventListener() {},
    speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); } };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  window.__heard = 'سلام';
  window.SpeechRecognition = window.webkitSpeechRecognition = function () { this.start = () => setTimeout(() => { this.onresult && this.onresult({ results: [[{ transcript: window.__heard }]] }); this.onend && this.onend(); }, 50); this.stop = () => {}; };
};
(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); };
  async function session(user, vp) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: 'fa-IR', timezoneId: 'Asia/Tehran', permissions: [] });
    await ctx.addInitScript(stub);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror ' + e.message)); page.on('console', (m) => m.type() === 'error' && !/40[13]/.test(m.text()) && errs.push('console ' + m.text()));
    await page.goto(URL + '/'); await page.fill('#u', user); await page.fill('#p', PW[user]); await page.click('button:has-text("ورود")');
    return { ctx, page, errs };
  }
  // ---------- Saman (phone) ----------
  { const { page, errs } = await session('saman', { width: 390, height: 844 });
    await page.waitForSelector('text=سلام سامان جان'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${SP}/saman-home.png` });
    const btn = page.locator('button[aria-label="دستیار من"]'); ok('saman: fixed assistant button visible', await btn.isVisible());
    ok('saman: button label', (await btn.innerText()).includes('دستیار من 🎙️'));
    await page.click('text=تکالیف من >> nth=0'); await page.waitForURL('**/homework');
    const spoken = await page.evaluate(() => window.__spoken);
    ok('saman: tapping icon speaks name+purpose', spoken.some((t) => t.includes('تکالیف من') && t.includes('اینجا می‌توانی تکالیف مدرسه‌ات را ببینی')));
    ok('saman: button still visible after navigation', await btn.isVisible());
    await page.screenshot({ path: `${SP}/saman-homework.png` });
    await page.goto(URL + '/'); await page.waitForSelector('text=سلام سامان جان');
    await page.click('button[aria-label="بشنو: ستاره‌های من"]');
    ok('saman: speaker button speaks stars icon', (await page.evaluate(() => window.__spoken)).some((t) => t.includes('ستاره‌های من. اینجا تعداد ستاره‌هایی')));
    // assistant by voice
    await btn.click(); await page.waitForSelector('text=بزن و حرف بزن');
    await page.evaluate(() => (window.__heard = 'الان چیکار کنم؟')); await page.click('text=بزن و حرف بزن');
    await page.waitForTimeout(600);
    ok('saman: voice command "الان چیکار کنم" answered aloud', (await page.evaluate(() => window.__spoken)).some((t) => /وقت|کار مهمی نداری/.test(t)));
    await page.evaluate(() => (window.__heard = 'برنامه امروز من چیه')); await page.click('text=بزن و حرف بزن'); await page.waitForTimeout(600);
    const today = (await page.evaluate(() => window.__spoken)).find((t) => t.startsWith('امروز این کارها'));
    ok('saman: reads today schedule', !!today && today.includes('تکالیف'));
    await page.screenshot({ path: `${SP}/saman-assistant.png` });
    await page.evaluate(() => (window.__heard = 'تکالیفم رو انجام دادم')); await page.click('text=بزن و حرف بزن'); await page.waitForTimeout(600);
    ok('saman: asks confirmation before reporting', await page.locator('text=را انجام دادی؟').first().isVisible());
    await page.evaluate(() => (window.__heard = 'بله')); await page.click('text=بزن و حرف بزن'); await page.waitForTimeout(800);
    ok('saman: "بله" voice confirms; mother-approval message', (await page.evaluate(() => window.__spoken)).some((t) => t.includes('به مامان خبر دادم')));
    // isolation as seen from the browser
    const iso = await page.evaluate(async () => { const g = async (u) => (await fetch(u, { credentials: 'same-origin' })).status; return [await g('/api/tasks'), await g('/api/transactions'), await g('/api/children'), await g('/api/dashboard')]; });
    ok('saman: parent APIs forbidden from browser', iso.every((s) => s === 403));
    ok('saman: no console/page errors', errs.length === 0); if (errs.length) console.log(errs);
  }
  // ---------- Sarina (tablet) ----------
  { const { page, errs } = await session('sarina', { width: 820, height: 1180 });
    await page.waitForSelector('text=سلام سارینا جان'); await page.waitForTimeout(400); await page.screenshot({ path: `${SP}/sarina-home.png` });
    await page.click('text=برنامه هفته >> nth=0'); await page.waitForURL('**/week'); await page.waitForSelector('text=کلاس رقص'); await page.screenshot({ path: `${SP}/sarina-week.png` });
    ok('sarina: weekly schedule shows dance class', await page.locator('text=کلاس رقص').first().isVisible());
    ok('sarina: no console/page errors', errs.length === 0); if (errs.length) console.log(errs); }
  // ---------- Mana (phone + desktop) ----------
  { const { page, errs } = await session('mana', { width: 390, height: 844 });
    await page.waitForSelector('text=/صبح بخیر|عصر بخیر|شب بخیر/'); await page.waitForTimeout(600); await page.screenshot({ path: `${SP}/mana-dash-mobile.png` });
    ok('mana: pending approval from Saman is shown', await page.locator('text=در انتظار تأیید').first().isVisible());
    ok('mana: fixed assistant button visible', await page.locator('button:has-text("دستیار من 🎙️")').isVisible());
    await page.goto(URL + '/ai'); await page.fill('input[placeholder^="مثلاً"]', 'فردا ساعت ۱۰ جلسه دارم.'); await page.click('button:has-text("ارسال")'); await page.waitForSelector('text=تأیید و ثبت');
    await page.screenshot({ path: `${SP}/mana-ai.png` }); await page.click('text=تأیید و ثبت'); await page.waitForSelector('text=رویداد ثبت شد');
    ok('mana: AI proposal -> confirm -> event created', true);
    await page.goto(URL + '/finance'); await page.waitForSelector('text=مانده نقدینگی'); await page.screenshot({ path: `${SP}/mana-finance.png` });
    await page.goto(URL + '/family'); await page.waitForSelector('text=برنامه‌ی هفتگی'); await page.screenshot({ path: `${SP}/mana-family.png` });
    await page.goto(URL + '/calendar'); await page.waitForSelector('text=ماهانه'); await page.screenshot({ path: `${SP}/mana-calendar.png` });
    ok('mana: no horizontal scroll on phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok('mana: no console/page errors', errs.length === 0); if (errs.length) console.log(errs);
  }
  { const { page } = await session('mana', { width: 1280, height: 800 }); await page.waitForSelector('text=/صبح بخیر|عصر بخیر|شب بخیر/'); await page.waitForTimeout(500); await page.screenshot({ path: `${SP}/mana-dash-desktop.png` }); }
  console.log(results.map((r) => r.join('  ')).join('\n'));
  await browser.close();
})();
