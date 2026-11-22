// پورتال ERP — رابط کاربری (بدون وابستگی خارجی)
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : nf.format(n));

// ─── تاریخ شمسی ───
function g2j(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979; gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  jy += 33 * Math.floor(days / 12053); days %= 12053;
  jy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}
function j2g(jy, jm, jd) {
  let gy = jy <= 979 ? 621 : 1600; jy -= jy <= 979 ? 0 : 979;
  let days = 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + 78 + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097); days %= 146097;
  if (days > 36524) { gy += 100 * Math.floor(--days / 36524); days %= 36524; if (days >= 365) days++; }
  gy += 4 * Math.floor(days / 1461); days %= 1461;
  if (days > 365) { gy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const sa = [0, 31, (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0; for (; gm < 13 && gd > sa[gm]; gm++) gd -= sa[gm];
  return [gy, gm, gd];
}
const p2 = (n) => String(n).padStart(2, '0');
const faDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const toFa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
export const isoToJ = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); const [a, b, c] = g2j(y, m, d); return `${a}/${p2(b)}/${p2(c)}`; };
export const jToIso = (j) => {
  const m = faDigits(j).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return null;
  const [jy, jm, jd] = [+m[1], +m[2], +m[3]];
  if (jm < 1 || jm > 12 || jd < 1 || jd > (jm <= 6 ? 31 : jm <= 11 ? 30 : 30)) return null;
  const [gy, gm, gd] = j2g(jy, jm, jd);
  const back = g2j(gy, gm, gd);
  if (back[0] !== jy || back[1] !== jm || back[2] !== jd) return null; // تاریخ نامعتبر (مثلاً ۳۰ اسفند در سال کبیسه‌نبودن)
  return `${gy}-${p2(gm)}-${p2(gd)}`;
};
const showDate = (iso) => (iso ? toFa(isoToJ(iso)) : '—');
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); const [jy, jm] = g2j(y, m, 15); return toFa(`${jy}/${p2(jm)}`); };

// ─── ارتباط با سرور ───
const state = { me: null, company: sessionStorage.getItem('erp_company') || '', lookups: {} };
async function api(method, url, body) {
  const headers = { 'X-ERP': '1' };
  if (body) headers['Content-Type'] = 'application/json';
  if (state.company) headers['X-Company'] = state.company;
  const res = await fetch('/api' + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/login') { state.me = null; renderLogin(); throw new Error(data.error || 'نشست منقضی شد'); }
  if (!res.ok) throw new Error(data.error || 'خطا');
  return data;
}
let toastTimer;
function toast(msg, isErr) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2500);
}
async function lookup(key) {
  if (!state.lookups[key]) state.lookups[key] = await api('GET', `/entities/${key}/lookup`);
  return state.lookups[key];
}

// ─── ورود ───
function renderLogin(msg) {
  $app.innerHTML = `<div class="loginwrap"><form class="card login" id="lf">
    <h1>🏢 پورتال ERP</h1>
    <label for="u">نام کاربری</label><input id="u" autocomplete="username" required autofocus dir="ltr">
    <label for="p">گذرواژه</label><input id="p" type="password" autocomplete="current-password" required dir="ltr">
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}<div id="le"></div>
    <button class="btn pri" style="width:100%;margin-top:16px">ورود</button></form></div>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/login', { username: document.getElementById('u').value.trim(), password: document.getElementById('p').value }); await boot(); }
    catch (er) { document.getElementById('le').innerHTML = `<div class="err">${esc(er.message)}</div>`; }
  };
}

// ─── چارچوب اصلی ───
async function boot() {
  try { state.me = await api('GET', '/me'); } catch { return renderLogin(); }
  state.lookups = {};
  window.addEventListener('hashchange', route);
  route();
}
const GROUP_ORDER = ['hr', 'inventory', 'purchasing', 'sales', 'finance', 'projects', 'quality'];
function shell(inner, active) {
  const me = state.me;
  const nav = [`<a href="#/" class="${active === 'dash' ? 'on' : ''}">📊 داشبورد</a>`];
  if (me.isSuper) nav.push(`<div class="grp">مدیر کل</div><a href="#/companies" class="${active === 'companies' ? 'on' : ''}">🏢 شرکت‌ها</a>`);
  for (const m of me.modules) {
    if (m.key === 'admin') continue;
    nav.push(`<div class="grp">${m.icon} ${esc(m.title)}</div>`);
    for (const k of m.entities) nav.push(`<a href="#/e/${k}" class="${active === k ? 'on' : ''}">${esc(me.meta[k].title)}</a>`);
    if (m.key === 'inventory') nav.push(`<a href="#/report/stock" class="${active === 'report:stock' ? 'on' : ''}">گزارش موجودی</a>`);
    if (m.key === 'accounting') for (const [r, l] of [['trial', 'تراز آزمایشی'], ['ledger', 'دفتر کل (معین)'], ['income', 'صورت سود و زیان'], ['balance', 'ترازنامه']]) nav.push(`<a href="#/report/${r}" class="${active === 'report:' + r ? 'on' : ''}">${l}</a>`);
    if (m.key === 'production') nav.push(`<a href="#/report/mrp" class="${active === 'report:mrp' ? 'on' : ''}">نیازمندی مواد (MRP)</a>`);
    if (m.key === 'finance') nav.push(`<a href="#/report/balances" class="${active === 'report:balances' ? 'on' : ''}">مانده حساب‌ها</a>`);
  }
  const adm = me.modules.find((m) => m.key === 'admin');
  if (adm) nav.push(`<div class="grp">⚙️ مدیریت</div><a href="#/e/users" class="${active === 'users' ? 'on' : ''}">کاربران</a><a href="#/settings" class="${active === 'settings' ? 'on' : ''}">تنظیمات شرکت</a><a href="#/audit" class="${active === 'audit' ? 'on' : ''}">گزارش رویدادها</a>`);
  $app.innerHTML = `<div class="layout"><nav class="side" id="side"><div class="brand">🏢 پورتال ERP</div>${nav.join('')}</nav>
    <div class="main"><header class="top"><div class="who"><button class="btn sm menu-btn" id="mb">☰</button>
      <b>${esc(me.company?.name || 'بدون شرکت فعال')}</b>${me.isSuper ? ' <select id="cs" style="width:auto"></select>' : ''}</div>
      <div class="who"><span>${esc(me.user.name)} <span class="badge info">${esc(me.user.roleLabel || me.user.role)}</span></span>
      <button class="btn sm" id="pw">تغییر گذرواژه</button><button class="btn sm" id="lo">خروج</button></div></header>
    <main class="content">${inner}</main></div></div>`;
  document.getElementById('mb').onclick = () => document.getElementById('side').classList.toggle('open');
  document.getElementById('side').onclick = (e) => { if (e.target.tagName === 'A') e.currentTarget.classList.remove('open'); };
  document.getElementById('lo').onclick = async () => { await api('POST', '/logout', {}); state.me = null; renderLogin(); };
  document.getElementById('pw').onclick = changePassword;
  if (me.isSuper) fillCompanySwitch();
}
async function fillCompanySwitch() {
  const list = await api('GET', '/companies');
  const cs = document.getElementById('cs');
  cs.innerHTML = `<option value="">— انتخاب شرکت —</option>` + list.filter((c) => c.active).map((c) => `<option value="${c.id}" ${String(c.id) === state.company ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  cs.onchange = async () => { state.company = cs.value; sessionStorage.setItem('erp_company', cs.value); state.me = await api('GET', '/me'); state.lookups = {}; location.hash = '#/'; route(); };
}

async function route() {
  if (!state.me) return;
  const [, kind, argRaw] = location.hash.split('/');
  const arg = (argRaw || '').split('?')[0];
  try {
    if (!kind) return await pageDashboard();
    if (kind === 'e') return await pageEntity(arg);
    if (kind === 'report') return await pageReport(arg);
    if (kind === 'companies') return await pageCompanies();
    if (kind === 'settings') return await pageSettings();
    if (kind === 'audit') return await pageAudit();
    shell('<div class="empty">صفحه یافت نشد</div>');
  } catch (e) { shell(`<div class="err">${esc(e.message)}</div>`); }
}

// ─── داشبورد ───
async function pageDashboard() {
  if (!state.me.company) {
    return shell(`<h1>خوش آمدید</h1><div class="sub">برای کار با داده‌ها ابتدا از بالای صفحه یک شرکت انتخاب کنید یا از بخش «شرکت‌ها» شرکت جدید بسازید.</div>`, 'dash');
  }
  const d = await api('GET', '/dashboard');
  const cur = state.me.company.currency;
  const cards = d.cards.map((c) => {
    const href = c.link?.startsWith('report:') ? `#/report/${c.link.slice(7)}` : c.link ? `#/e/${c.link}` : '#/';
    return `<a class="card stat ${c.warn ? 'warn' : ''}" href="${href}"><div class="l">${esc(c.label)}</div><div class="v">${fmt(c.value)}</div>${c.money ? `<div class="hint">${esc(cur)}</div>` : ''}</a>`;
  }).join('');
  const meta = state.me.meta;
  const lab = (ent, f, k) => meta[ent].fields.find((x) => x.k === f).options.find((o) => o.v === k)?.l || k;
  let charts = '';
  if (d.charts.sales?.length) {
    const max = Math.max(...d.charts.sales.map((r) => r.v), 1);
    charts += `<div class="card"><h2>فروش ماهانه (${esc(cur)})</h2><div class="chartbars">${d.charts.sales.map((r) => `<div class="b"><span>${fmt(Math.round(r.v / 1e6))}م</span><i style="height:${Math.max(r.v / max * 100, 2)}%"></i><span>${monthName(r.m)}</span></div>`).join('')}</div></div>`;
  }
  const pills = (rows, ent, f) => rows.map((r) => `<span class="badge ${meta[ent].fields.find((x) => x.k === f).options.find((o) => o.v === r.k)?.c || ''}">${esc(lab(ent, f, r.k))}: ${fmt(r.v)}</span>`).join('');
  if (d.charts.tasks?.length) charts += `<div class="card"><h2>وضعیت وظایف پروژه‌ها</h2><div class="legend">${pills(d.charts.tasks, 'tasks', 'status')}</div></div>`;
  if (d.charts.ncr?.length) charts += `<div class="card"><h2>NCRهای باز بر اساس شدت</h2><div class="legend">${pills(d.charts.ncr, 'ncr', 'severity')}</div></div>`;
  shell(`<h1>داشبورد</h1><div class="sub">نمای کلی ${esc(state.me.company.name)}</div><div class="cards">${cards}</div><div class="grid2">${charts}</div>`, 'dash');
}

// ─── صفحه‌ی عمومی موجودیت‌ها ───
const badge = (f, v) => { const o = f.options?.find((x) => x.v === v); return o ? `<span class="badge ${o.c || ''}">${esc(o.l)}</span>` : '—'; };
function cell(f, r) {
  const v = r[f.k];
  switch (f.type) {
    case 'select': return badge(f, v);
    case 'ref': return esc(r._l?.[f.k] || '—');
    case 'date': return showDate(v);
    case 'money': case 'number':
      if (f.display === 'progress') return `<span class="bar"><i style="width:${Math.min(+v || 0, 100)}%"></i></span> ${fmt(v)}٪`;
      return fmt(v);
    case 'bool': return v ? '✔️' : '—';
    default: return esc(v ?? '—');
  }
}
async function pageEntity(key) {
  const meta = state.me.meta[key];
  if (!meta) return shell('<div class="empty">یافت نشد</div>');
  const perm = state.me.perms[meta.module] || '';
  const st = { q: '', page: 1, sort: '', dir: '', filters: {} };
  shell(`<h1>${esc(meta.title)}</h1><div class="toolbar" id="tb"></div><div id="tbl"></div>`, key);
  const filterFields = meta.fields.filter((f) => f.filter && f.type === 'select');
  document.getElementById('tb').innerHTML = `<input type="search" id="q" placeholder="جستجو…">` +
    filterFields.map((f) => `<select data-f="${f.k}"><option value="">${esc(f.label)}: همه</option>${f.options.map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}</select>`).join('') +
    `<span class="sp"></span>` + (key !== 'users' ? `<button class="btn" id="ex">⬇ CSV</button>` : '') +
    (perm.includes('c') ? `<button class="btn pri" id="nw">＋ ${esc(meta.singular)} جدید</button>` : '');
  let timer;
  document.getElementById('q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 250); };
  document.querySelectorAll('[data-f]').forEach((s) => (s.onchange = () => { st.filters[s.dataset.f] = s.value; st.page = 1; load(); }));
  const ex = document.getElementById('ex');
  if (ex) ex.onclick = async () => {
    const res = await fetch(`/api/export/${key}`, { headers: { 'X-Company': state.company } });
    if (!res.ok) return toast('خطا در دریافت فایل', true);
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = key + '.csv'; a.click();
  };
  const nw = document.getElementById('nw');
  if (nw) nw.onclick = () => openForm(meta, null, load);

  async function load() {
    const qs = new URLSearchParams({ q: st.q, page: st.page, size: 25 });
    if (st.sort) { qs.set('sort', st.sort); qs.set('dir', st.dir); }
    for (const [k, v] of Object.entries(st.filters)) if (v) qs.set('f_' + k, v);
    const data = await api('GET', `/entities/${key}?${qs}`);
    const cols = meta.fields.filter((f) => f.list);
    const pages = Math.max(Math.ceil(data.total / data.size), 1);
    const rowsHtml = data.rows.map((r) => {
      const acts = (meta.actions || []).filter((a) => a.from.includes(r.status) && perm.includes('e'));
      return `<tr>${cols.map((f) => `<td class="${f.type === 'money' || f.type === 'number' ? 'num' : ''}">${cell(f, r)}</td>`).join('')}<td class="act">
        ${acts.map((a) => `<button class="btn sm ${a.style || ''}" data-act="${a.key}" data-id="${r.id}">${esc(a.label)}</button>`).join(' ')}
        ${perm.includes('e') && !meta.noEdit ? `<button class="btn sm" data-edit="${r.id}">ویرایش</button>` : `<button class="btn sm" data-edit="${r.id}">مشاهده</button>`}
        ${perm.includes('d') ? `<button class="btn sm bad" data-del="${r.id}">حذف</button>` : ''}</td></tr>`;
    }).join('');
    const t = document.getElementById('tbl');
    t.innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map((f) => `<th class="sortable" data-s="${f.k}">${esc(f.label)}${st.sort === f.k ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${cols.length + 1}" class="empty">موردی یافت نشد</td></tr>`}</tbody></table>
      <div class="pager"><button class="btn sm" id="pp" ${st.page <= 1 ? 'disabled' : ''}>قبلی</button><span>صفحه ${fmt(st.page)} از ${fmt(pages)} — ${fmt(data.total)} مورد</span><button class="btn sm" id="np" ${st.page >= pages ? 'disabled' : ''}>بعدی</button></div></div>`;
    t.querySelectorAll('[data-s]').forEach((th) => (th.onclick = () => { st.dir = st.sort === th.dataset.s && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = th.dataset.s; load(); }));
    t.querySelector('#pp').onclick = () => { st.page--; load(); };
    t.querySelector('#np').onclick = () => { st.page++; load(); };
    t.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => openForm(meta, await api('GET', `/entities/${key}/${b.dataset.edit}`), load)));
    t.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('این مورد حذف شود؟ این عمل قابل بازگشت نیست.')) return;
      try { await api('DELETE', `/entities/${key}/${b.dataset.del}`); delete state.lookups[key]; toast('حذف شد'); load(); } catch (e) { toast(e.message, true); }
    }));
    t.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const a = meta.actions.find((x) => x.key === b.dataset.act);
      if (a.confirm && !confirm(a.confirm)) return;
      b.disabled = true;
      try { await api('POST', `/entities/${key}/${b.dataset.id}/actions/${a.key}`, {}); toast('انجام شد'); load(); } catch (e) { toast(e.message, true); b.disabled = false; }
    }));
  }
  await load();
}

// ─── فرم ایجاد/ویرایش ───
async function openForm(meta, rec, done) {
  const perm = state.me.perms[meta.module] || '';
  const readOnly = rec ? (meta.noEdit || !perm.includes('e')) : false;
  const refs = {};
  for (const f of meta.fields) if (f.type === 'ref') refs[f.ref] = await lookup(f.ref);
  const lineField = meta.fields.find((f) => f.type === 'lines');
  const hasLines = !!lineField, cols = lineField?.cols || [];
  for (const c of cols) if (c.type === 'ref' && !refs[c.ref]) refs[c.ref] = await lookup(c.ref);
  const blank = () => Object.fromEntries(cols.map((c) => [c.k, c.k === 'qty' ? 1 : c.type === 'number' ? 0 : '']));
  let lines = rec?.lines?.length ? rec.lines.map((l) => ({ ...l })) : [blank()];
  const locked = rec && meta.editWhen && !meta.editWhen.includes(rec.status);

  const input = (f) => {
    const v = rec ? rec[f.k] : f.default === '$today' ? new Date().toISOString().slice(0, 10) : f.default;
    const id = 'f_' + f.k; const dis = readOnly || locked ? 'disabled' : '';
    if (f.readonly) return `<div class="ro">${rec ? cell(f, rec) : '<span class="hint">خودکار</span>'}</div>`;
    switch (f.type) {
      case 'textarea': return `<textarea id="${id}" rows="3" ${dis}>${esc(v ?? '')}</textarea>`;
      case 'select': return `<select id="${id}" ${dis}><option value="">—</option>${f.options.map((o) => `<option value="${esc(o.v)}" ${o.v === v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
      case 'ref': return `<select id="${id}" ${dis}><option value="">—</option>${refs[f.ref].map((o) => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      case 'date': return `<input id="${id}" dir="ltr" placeholder="۱۴۰۵/۰۱/۰۱" value="${esc(toFa(isoToJ(v)))}" ${dis} inputmode="numeric">`;
      case 'number': case 'money': return `<input id="${id}" type="number" step="any" ${f.min !== undefined ? `min="${f.min}"` : ''} value="${esc(v ?? '')}" ${dis}>`;
      case 'bool': return `<select id="${id}" ${dis}><option value="1" ${v ? 'selected' : ''}>بله</option><option value="0" ${v ? '' : 'selected'}>خیر</option></select>`;
      case 'password': return `<input id="${id}" type="password" autocomplete="new-password" dir="ltr" ${dis}>`;
      default: return `<input id="${id}" value="${esc(v ?? '')}" ${dis}>`;
    }
  };
  const bg = document.createElement('div'); bg.className = 'modalbg';
  const render = () => {
    bg.innerHTML = `<div class="modal" role="dialog"><h2>${rec ? (readOnly || locked ? 'مشاهده' : 'ویرایش') : 'ایجاد'} ${esc(meta.singular)}${rec?.number ? ' — ' + esc(rec.number) : ''}</h2>
      ${locked ? '<div class="hint" style="margin-bottom:10px">این سند از حالت پیش‌نویس خارج شده و قابل ویرایش نیست.</div>' : ''}
      <form class="form" id="mf">${meta.fields.filter((f) => f.type !== 'lines').map((f) =>
        `<div class="${f.type === 'textarea' ? 'full' : ''}"><label class="${f.required ? 'req' : ''}" for="f_${f.k}">${esc(f.label)}</label>${input(f)}</div>`).join('')}
      ${hasLines ? `<div class="full lines"><label>${esc(lineField.label)}</label><table><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}<th>جمع</th><th></th></tr></thead><tbody id="lb"></tbody></table>
        ${readOnly || locked ? '' : '<button type="button" class="btn sm" id="al" style="margin-top:6px">＋ ردیف</button>'}</div>` : ''}
      </form><div id="fe"></div>
      <div class="foot">${readOnly || locked ? '' : '<button class="btn pri" id="sv">ذخیره</button>'}<button class="btn" id="cn">بستن</button></div></div>`;
    if (hasLines) renderLines();
    bg.querySelector('#cn').onclick = () => bg.remove();
    const sv = bg.querySelector('#sv');
    if (sv) sv.onclick = save;
    bg.querySelector('#mf').onsubmit = (e) => { e.preventDefault(); save(); };
  };
  function renderLines() {
    const dis = readOnly || locked ? 'disabled' : '';
    const has = (k) => cols.some((c) => c.k === k);
    const cellHtml = (c, l, i) => {
      if (c.type === 'ref') return `<select data-i="${i}" data-k="${c.k}" ${dis}><option value="">—</option>${refs[c.ref].map((o) => `<option value="${o.id}" ${+l[c.k] === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      if (c.type === 'number') return `<input type="number" step="any" min="0" data-i="${i}" data-k="${c.k}" value="${esc(l[c.k] ?? '')}" style="width:120px" ${dis}>`;
      return `<input data-i="${i}" data-k="${c.k}" value="${esc(l[c.k] ?? '')}" ${dis}>`;
    };
    const sum = (k) => lines.reduce((s, l) => s + (+l[k] || 0), 0);
    const rowTotal = (l) => (has('qty') && has('price') ? fmt((+l.qty || 0) * (+l.price || 0)) : '');
    let foot = '';
    if (has('qty') && has('price')) foot = `<b>جمع جزء: ${fmt(lines.reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0))}</b>`;
    else if (has('debit')) { const d = sum('debit'), c = sum('credit'); foot = `<b>بدهکار: ${fmt(d)} — بستانکار: ${fmt(c)}</b> ${Math.abs(d - c) < 0.005 ? '<span class="badge ok">تراز</span>' : `<span class="badge bad">اختلاف ${fmt(d - c)}</span>`}`; }
    bg.querySelector('#lb').innerHTML = lines.map((l, i) => `<tr>${cols.map((c) => `<td>${cellHtml(c, l, i)}</td>`).join('')}<td class="num">${rowTotal(l)}</td>
      <td>${dis ? '' : `<button type="button" class="btn sm bad" data-rm="${i}">✕</button>`}</td></tr>`).join('') + `<tr><td colspan="${cols.length + 2}">${foot}</td></tr>`;
    bg.querySelectorAll('#lb [data-k]').forEach((el) => (el.onchange = () => {
      const l = lines[el.dataset.i]; l[el.dataset.k] = el.value;
      if (el.dataset.k === 'item_id' && has('price')) { const it = refs.items.find((x) => x.id === +el.value); if (it) l.price = (meta.key === 'purchase_orders' ? it.cost : it.price) ?? 0; }
      if (el.dataset.k === 'debit' && +el.value > 0) l.credit = 0;
      if (el.dataset.k === 'credit' && +el.value > 0) l.debit = 0;
      renderLines();
    }));
    bg.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.rm, 1); if (!lines.length) lines.push(blank()); renderLines(); }));
    const al = bg.querySelector('#al'); if (al) al.onclick = () => { lines.push(blank()); renderLines(); };
  }
  async function save() {
    const body = {};
    for (const f of meta.fields) {
      if (f.readonly || f.type === 'lines') continue;
      const el = bg.querySelector('#f_' + f.k); if (!el) continue;
      let v = el.value;
      if (f.type === 'date') { if (v.trim() === '') v = ''; else { v = jToIso(v); if (!v) return showErr(`«${f.label}»: تاریخ شمسی را به شکل ۱۴۰۵/۰۱/۲۵ وارد کنید`); } }
      body[f.k] = v;
    }
    if (hasLines) body.lines = lines.filter((l) => l[cols[0].k]).map((l) => Object.fromEntries(cols.map((c) => [c.k, c.type === 'ref' ? +l[c.k] : c.type === 'number' ? +l[c.k] || 0 : l[c.k] || null])));
    const btn = bg.querySelector('#sv'); btn.disabled = true;
    try {
      await api(rec ? 'PUT' : 'POST', `/entities/${meta.key}${rec ? '/' + rec.id : ''}`, body);
      delete state.lookups[meta.key]; bg.remove(); toast('ذخیره شد'); done();
    } catch (e) { showErr(e.message); btn.disabled = false; }
  }
  const showErr = (m) => { bg.querySelector('#fe').innerHTML = `<div class="err">${esc(m)}</div>`; };
  render(); document.body.appendChild(bg);
  const first = bg.querySelector('input:not([disabled]),select:not([disabled])'); first?.focus();
}

// ─── گزارش‌ها ───
const REPORT_TITLES = { trial: 'تراز آزمایشی', ledger: 'دفتر کل (حساب معین)', income: 'صورت سود و زیان', balance: 'ترازنامه', mrp: 'نیازمندی مواد (MRP)' };
async function pageAccReport(name) {
  const cur = state.me.company.currency;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const accounts = name === 'ledger' ? await lookup('accounts') : [];
  const range = name !== 'balance';
  const dv = (k) => (q.get(k) ? toFa(isoToJ(q.get(k))) : '');
  const bar = `<form class="toolbar" id="rf">${name === 'ledger' ? `<select id="ra" style="min-width:240px"><option value="">— انتخاب حساب —</option>${accounts.map((a) => `<option value="${a.id}" ${q.get('account') === String(a.id) ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>` : ''}
    ${range ? `<label class="hint">از</label><input id="rfrom" placeholder="۱۴۰۵/۰۱/۰۱" dir="ltr" style="width:130px" value="${dv('from')}">` : ''}
    <label class="hint">${range ? 'تا' : 'تا تاریخ'}</label><input id="rto" placeholder="${toFa(isoToJ(new Date().toISOString().slice(0, 10)))}" dir="ltr" style="width:130px" value="${dv('to')}">
    <button class="btn pri">نمایش</button><span class="sp"></span><button type="button" class="btn" id="pr">🖨 چاپ</button></form><div id="rerr"></div>`;
  let body = '';
  const ready = name !== 'ledger' || q.get('account');
  if (ready) {
    const d = await api('GET', `/reports/${name}?${q}`);
    const row = (cells, cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr>`;
    const tbl = (head, rows) => `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">داده‌ای وجود ندارد</td></tr>`}</tbody></table></div>`;
    if (name === 'trial') {
      body = tbl(['کد', 'نام حساب', 'مانده ابتدا', 'گردش بدهکار', 'گردش بستانکار', 'مانده پایان'], [...d.rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${fmt(r.opening)}</td><td class="num">${fmt(r.debit)}</td><td class="num">${fmt(r.credit)}</td><td class="num">${fmt(r.closing)}</td></tr>`),
        `<tr><td></td><td><b>جمع</b></td><td class="num"><b>${fmt(d.totals.opening)}</b></td><td class="num"><b>${fmt(d.totals.debit)}</b></td><td class="num"><b>${fmt(d.totals.credit)}</b></td><td class="num"><b>${fmt(d.totals.closing)}</b></td></tr>`]);
      body += `<p class="hint">مانده مثبت = بدهکار، منفی = بستانکار. ${d.totals.debit === d.totals.credit ? '✔ جمع بدهکار و بستانکار برابر است.' : '⚠ عدم تعادل!'}</p>`;
    } else if (name === 'ledger') {
      body = `<h2>${esc(d.account.code)} · ${esc(d.account.name)}</h2>` + tbl(['تاریخ', 'سند', 'شرح', 'بدهکار', 'بستانکار', 'مانده'], [
        `<tr><td colspan="5"><b>مانده ابتدای دوره</b></td><td class="num"><b>${fmt(d.opening)}</b></td></tr>`,
        ...d.rows.map((r) => `<tr><td>${showDate(r.date)}</td><td>${esc(r.number)}</td><td>${esc(r.memo || r.description)}</td><td class="num">${r.debit ? fmt(r.debit) : ''}</td><td class="num">${r.credit ? fmt(r.credit) : ''}</td><td class="num">${fmt(r.balance)}</td></tr>`),
        `<tr><td colspan="5"><b>مانده پایان</b></td><td class="num"><b>${fmt(d.closing)}</b></td></tr>`]);
    } else if (name === 'income') {
      const sec = (title, list, total) => `<tr><td colspan="2"><b>${title}</b></td></tr>${list.map((a) => row([`&nbsp;&nbsp;${esc(a.code)} ${esc(a.name)}`, fmt(a.amount)])).join('')}${row([`<b>جمع ${title}</b>`, `<b>${fmt(total)}</b>`])}`;
      body = `<div class="tablewrap"><table><tbody>${sec('درآمدها', d.revenue, d.totalRevenue)}${sec('هزینه‌ها', d.expenses, d.totalExpenses)}
        ${row(['<b>سود ناخالص (درآمد − بهای تمام‌شده)</b>', `<b>${fmt(d.grossProfit)}</b>`])}${row([`<b>${d.netIncome >= 0 ? 'سود خالص' : 'زیان خالص'}</b>`, `<b>${fmt(d.netIncome)}</b>`])}</tbody></table></div>`;
    } else if (name === 'balance') {
      const side = (title, list, total, extra = '') => `<table><tbody><tr><td colspan="2"><b>${title}</b></td></tr>${list.map((a) => row([`${esc(a.code)} ${esc(a.name)}`, fmt(a.amount)])).join('')}${extra}${row([`<b>جمع ${title}</b>`, `<b>${fmt(total)}</b>`])}</tbody></table>`;
      body = `<div class="grid2"><div class="tablewrap">${side('دارایی‌ها', d.assets, d.totalAssets)}</div><div class="tablewrap">${side('بدهی‌ها', d.liabilities, d.totalLiabilities)}
        ${side('حقوق صاحبان سرمایه', d.equity, d.totalEquity, row(['سود (زیان) دوره‌ی جاری', fmt(d.earnings)]))}</div></div>
        <p class="hint">${d.difference === 0 ? '✔ دارایی‌ها = بدهی‌ها + حقوق صاحبان سرمایه' : `⚠ اختلاف ${fmt(d.difference)}`}</p>`;
    }
  } else body = '<div class="empty">یک حساب را انتخاب و «نمایش» را بزنید.</div>';
  shell(`<h1>${REPORT_TITLES[name]}</h1><div class="sub">مبالغ به ${esc(cur)}</div>${bar}${body}`, 'report:' + name);
  document.getElementById('pr').onclick = () => print();
  document.getElementById('rf').onsubmit = (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [id, k] of [['rfrom', 'from'], ['rto', 'to']]) {
      const el = document.getElementById(id); if (!el || !el.value.trim()) continue;
      const iso = jToIso(el.value); if (!iso) return (document.getElementById('rerr').innerHTML = '<div class="err">تاریخ شمسی را به شکل ۱۴۰۵/۰۱/۲۵ وارد کنید</div>');
      p.set(k, iso);
    }
    const a = document.getElementById('ra'); if (a?.value) p.set('account', a.value);
    location.hash = `#/report/${name}?${p}`;
  };
}
async function pageMrp() {
  const d = await api('GET', '/reports/mrp');
  const rows = d.rows.map((r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${fmt(r.required)} ${esc(r.unit || '')}</td><td class="num">${fmt(r.onhand)}</td><td class="num">${fmt(r.incoming)}</td><td class="num"><b>${fmt(r.shortage)}</b></td>
    <td>${r.shortage > 0 ? '<span class="badge bad">کسری — سفارش خرید لازم است</span>' : r.uncovered > 0 ? '<span class="badge warn">منتظر دریافت خرید</span>' : '<span class="badge ok">تأمین شده</span>'}</td></tr>`).join('');
  shell(`<h1>نیازمندی مواد (MRP)</h1><div class="sub">بر اساس ${fmt(d.workOrders)} دستور تولید باز (پیش‌نویس/آزادشده) در برابر موجودی و سفارش‌های خرید تأییدشده</div>
    <div class="tablewrap"><table><thead><tr><th>کد</th><th>ماده</th><th>نیاز</th><th>موجودی</th><th>در راه (خرید)</th><th>کسری</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">دستور تولید بازی وجود ندارد</td></tr>'}</tbody></table></div>`, 'report:mrp');
}
async function pageReport(name) {
  if (name === 'mrp') return pageMrp();
  if (REPORT_TITLES[name]) return pageAccReport(name);
  const d = await api('GET', `/reports/${name}`);
  const cur = state.me.company.currency;
  if (name === 'stock') {
    const rows = d.items.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${i.by.map((b) => `${esc(b.warehouse)}: ${fmt(b.qty)}`).join('، ') || '—'}</td>
      <td class="num"><b>${fmt(i.total)}</b> ${esc(i.unit || '')}</td><td class="num">${fmt(i.min_stock)}</td><td class="num">${fmt(i.value)}</td><td>${i.low ? '<span class="badge bad">زیر حداقل</span>' : '<span class="badge ok">عادی</span>'}</td></tr>`).join('');
    return shell(`<h1>گزارش موجودی</h1><div class="sub">ارزش بر اساس قیمت تمام‌شده (${esc(cur)}) — مجموع: ${fmt(d.items.reduce((s, i) => s + i.value, 0))}</div>
      <div class="tablewrap"><table><thead><tr><th>کد</th><th>کالا</th><th>به تفکیک انبار</th><th>موجودی کل</th><th>حداقل</th><th>ارزش</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty">کالایی ثبت نشده</td></tr>'}</tbody></table></div>`, 'report:stock');
  }
  const t = (list) => `<div class="tablewrap"><table><thead><tr><th>نام</th><th>مانده (${esc(cur)})</th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.balance >= 0 ? '' : '(بستانکار) '}${fmt(Math.abs(x.balance))}</td></tr>`).join('') || '<tr><td colspan="2" class="empty">مانده‌ای وجود ندارد</td></tr>'}</tbody></table></div>`;
  shell(`<h1>مانده حساب‌ها</h1><div class="sub">مشتریان: سفارش‌های تأییدشده/ارسالی منهای دریافت‌ها — تأمین‌کنندگان: سفارش‌های تأییدشده/دریافتی منهای پرداخت‌ها</div>
    <div class="grid2"><div><h2>مشتریان (مطالبات)</h2>${t(d.customers)}</div><div><h2>تأمین‌کنندگان (بدهی)</h2>${t(d.suppliers)}</div></div>`, 'report:balances');
}

// ─── شرکت‌ها (مدیر کل) ───
async function pageCompanies() {
  const list = await api('GET', '/companies');
  const mods = state.me.allModules;
  shell(`<h1>شرکت‌ها</h1><div class="sub">هر شرکت داده، کاربران و ماژول‌های فعال مستقل دارد.</div>
    <div class="toolbar"><span class="sp"></span><button class="btn pri" id="nc">＋ شرکت جدید</button></div>
    <div class="tablewrap"><table><thead><tr><th>نام</th><th>واحد پول</th><th>ماژول‌های فعال</th><th>کاربران</th><th>وضعیت</th><th></th></tr></thead><tbody>
    ${list.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.currency)}</td><td>${c.modules.map((m) => esc(mods.find((x) => x.key === m)?.title || m)).join('، ')}</td><td>${fmt(c.users)}</td>
      <td>${c.active ? '<span class="badge ok">فعال</span>' : '<span class="badge bad">غیرفعال</span>'}</td>
      <td class="act"><button class="btn sm" data-enter="${c.id}">ورود به شرکت</button> <button class="btn sm" data-ed="${c.id}">ویرایش</button></td></tr>`).join('')}</tbody></table></div>`, 'companies');
  document.getElementById('nc').onclick = () => companyForm(null);
  document.querySelectorAll('[data-enter]').forEach((b) => (b.onclick = async () => { state.company = b.dataset.enter; sessionStorage.setItem('erp_company', state.company); state.me = await api('GET', '/me'); state.lookups = {}; location.hash = '#/'; route(); }));
  document.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => companyForm(list.find((c) => c.id === +b.dataset.ed))));
  function companyForm(c) {
    const bg = document.createElement('div'); bg.className = 'modalbg';
    bg.innerHTML = `<div class="modal"><h2>${c ? 'ویرایش شرکت' : 'شرکت جدید'}</h2><form class="form" id="cf">
      <div><label class="req">نام شرکت</label><input id="cn" value="${esc(c?.name || '')}" required></div><div><label>واحد پول</label><input id="cu" value="${esc(c?.currency || 'ریال')}"></div>
      <div class="full"><label>ماژول‌های فعال</label>${mods.map((m) => `<label style="display:inline-flex;gap:6px;margin-left:14px;color:var(--ink)"><input type="checkbox" style="width:auto" value="${m.key}" ${!c || c.modules.includes(m.key) ? 'checked' : ''}>${esc(m.title)}</label>`).join('')}</div>
      ${c ? `<div><label>وضعیت</label><select id="ca"><option value="1" ${c.active ? 'selected' : ''}>فعال</option><option value="0" ${c.active ? '' : 'selected'}>غیرفعال</option></select></div>` :
        `<div class="full"><h2 style="margin-top:8px">مدیر شرکت (کاربر اول)</h2></div><div><label class="req">نام کاربری</label><input id="au" dir="ltr" required></div><div><label class="req">نام کامل</label><input id="an" required></div><div><label class="req">گذرواژه (حداقل ۶ نویسه)</label><input id="ap" type="password" dir="ltr" required minlength="6"></div>`}
      </form><div id="fe"></div><div class="foot"><button class="btn pri" id="sv">ذخیره</button><button class="btn" id="cl">بستن</button></div></div>`;
    document.body.appendChild(bg);
    bg.querySelector('#cl').onclick = () => bg.remove();
    bg.querySelector('#sv').onclick = async () => {
      const body = { name: bg.querySelector('#cn').value, currency: bg.querySelector('#cu').value, modules: [...bg.querySelectorAll('input[type=checkbox]:checked')].map((x) => x.value) };
      try {
        if (c) { body.active = bg.querySelector('#ca').value === '1'; await api('PUT', `/companies/${c.id}`, body); }
        else { Object.assign(body, { admin_username: bg.querySelector('#au').value, admin_name: bg.querySelector('#an').value, admin_password: bg.querySelector('#ap').value }); await api('POST', '/companies', body); }
        bg.remove(); toast('ذخیره شد'); pageCompanies();
      } catch (e) { bg.querySelector('#fe').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
  }
}

// ─── تنظیمات، رویدادها، گذرواژه ───
async function pageSettings() {
  const c = state.me.company;
  shell(`<h1>تنظیمات شرکت</h1><form class="card form" id="sf" style="max-width:600px"><div><label>نام شرکت</label><input id="n" value="${esc(c.name)}"></div><div><label>واحد پول</label><input id="c" value="${esc(c.currency)}"></div>
    <div class="full"><label>بستن دوره‌ی مالی تا تاریخ (ثبت سند در این تاریخ و قبل از آن ممنوع می‌شود؛ خالی = باز)</label><input id="lk" dir="ltr" placeholder="۱۴۰۴/۱۲/۲۹" value="${esc(c.lock_date ? toFa(isoToJ(c.lock_date)) : '')}"></div>
    <div class="full"><button class="btn pri">ذخیره</button></div></form>`, 'settings');
  document.getElementById('sf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const lkv = document.getElementById('lk').value.trim(); const lk = lkv ? jToIso(lkv) : null;
      if (lkv && !lk) throw new Error('تاریخ شمسی نامعتبر است');
      await api('PUT', '/company', { name: document.getElementById('n').value, currency: document.getElementById('c').value, lock_date: lk }); state.me = await api('GET', '/me'); toast('ذخیره شد'); pageSettings(); } catch (er) { toast(er.message, true); }
  };
}
async function pageAudit() {
  const rows = await api('GET', '/audit');
  const A = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف', login: 'ورود' };
  shell(`<h1>گزارش رویدادها</h1><div class="sub">۳۰۰ رویداد آخر</div><div class="tablewrap"><table><thead><tr><th>زمان (UTC)</th><th>کاربر</th><th>عمل</th><th>بخش</th><th>جزئیات</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td dir="ltr">${esc(r.at)}</td><td>${esc(r.username)}</td><td>${esc(A[r.action] || r.action)}</td><td>${esc(state.me.meta[r.entity]?.title || r.entity)}</td><td>${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`, 'audit');
}
function changePassword() {
  const bg = document.createElement('div'); bg.className = 'modalbg';
  bg.innerHTML = `<div class="modal" style="max-width:420px"><h2>تغییر گذرواژه</h2><form class="form" style="grid-template-columns:1fr"><div><label>گذرواژه فعلی</label><input id="a" type="password" dir="ltr"></div><div><label>گذرواژه جدید (حداقل ۸ نویسه)</label><input id="b" type="password" dir="ltr"></div></form><div id="fe"></div>
    <div class="foot"><button class="btn pri" id="sv">ذخیره</button><button class="btn" id="cl">بستن</button></div></div>`;
  document.body.appendChild(bg);
  bg.querySelector('#cl').onclick = () => bg.remove();
  bg.querySelector('#sv').onclick = async () => {
    try { await api('POST', '/password', { current: bg.querySelector('#a').value, next: bg.querySelector('#b').value }); bg.remove(); toast('گذرواژه تغییر کرد'); }
    catch (e) { bg.querySelector('#fe').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
}

boot();
