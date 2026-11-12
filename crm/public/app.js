'use strict';
/* رابط کاربری CRM — SPA بدون وابستگی. همه‌ی مقادیر پویا از طریق esc/h فرار داده می‌شوند (جلوگیری از XSS). */
const CURRENCY = 'تومان';

// ---------- ابزارهای پایه ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
const h = (strs, ...vals) => raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const nf = new Intl.NumberFormat('fa-IR');
const money = (n) => `${nf.format(Math.round(Number(n) || 0))} ${CURRENCY}`;
const num = (n) => nf.format(Number(n) || 0);
const dfDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const dfTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dfMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: '2-digit', month: 'long', timeZone: 'UTC' });
const fmtDate = (iso) => (iso ? dfDate.format(new Date(String(iso).slice(0, 10) + 'T00:00:00Z')) : '—');
const fmtDateTime = (iso) => (iso ? dfTime.format(new Date(iso)) : '—');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const L = {
  stage: { new: 'جدید', qualified: 'ارزیابی‌شده', proposal: 'پیشنهاد', negotiation: 'مذاکره', won: 'برنده', lost: 'ازدست‌رفته' },
  leadStatus: { new: 'جدید', contacted: 'تماس گرفته شد', qualified: 'واجد شرایط', lost: 'ازدست‌رفته', converted: 'تبدیل‌شده' },
  taskType: { todo: 'کار', call: 'تماس', meeting: 'جلسه', email: 'ایمیل' },
  priority: { low: 'کم', normal: 'متوسط', high: 'زیاد' },
  taskStatus: { open: 'باز', done: 'انجام‌شده' },
  role: { admin: 'مدیر سیستم', manager: 'مدیر فروش', sales: 'کارشناس فروش' },
  act: { note: 'یادداشت', call: 'تماس', meeting: 'جلسه', email: 'ایمیل', system: 'سیستم' },
  rel: { contact: 'مخاطب', company: 'شرکت', deal: 'معامله', lead: 'سرنخ' },
};
const BADGE = { new: 'b-info', qualified: 'b-pri', proposal: 'b-warn', negotiation: 'b-warn', won: 'b-ok', lost: 'b-bad', contacted: 'b-warn', converted: 'b-ok', high: 'b-bad', normal: '', low: '', open: 'b-info', done: 'b-ok' };
const badge = (map, k) => h`<span class="badge ${BADGE[k] || ''}">${map[k] ?? k}</span>`;
const REL_ROUTE = { contact: 'contacts', company: 'companies', deal: 'deals', lead: 'leads' };
const relLink = (t, id, label) => (t && id ? h`<a href="#/${REL_ROUTE[t]}/${id}">${label || `${L.rel[t]} #${id}`}</a>` : '—');
const isManager = () => ME && ME.role !== 'sales';

let ME = null, LK = null;
const view = () => $('#view');

async function api(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'crm' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/login')) { ME = null; showLogin(); }
    const e = new Error(data.error || 'خطا'); e.status = res.status; e.details = data.details; throw e;
  }
  return data;
}
function toast(msg, err) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg;
  $('#toasts').append(el); setTimeout(() => el.remove(), 3500);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e.status !== 401) toast(e.message, true); } };

// ---------- مودال و فرم ----------
function modal(content, onClose) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content.s}</div>`;
  let closed = false;
  const close = () => { if (closed) return; closed = true; ov.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(ov);
  $$('[data-close]', ov).forEach((b) => b.addEventListener('click', close));
  const first = $('input:not([type=hidden]),select,textarea', ov); if (first) first.focus();
  return { el: ov, close };
}

function optionsOf(f) {
  if (f.options) return Object.entries(f.options).map(([v, l]) => ({ id: v, name: l }));
  return (LK[f.lookup] || []).map((x) => ({ id: x.id, name: x.name }));
}
function fieldHtml(f, v) {
  const id = 'f_' + f.key, cls = f.full || f.type === 'textarea' ? 'field full' : 'field';
  const lab = h`<label for="${id}" class="${f.req ? 'req' : ''}">${f.label}</label>`;
  let input;
  if (f.type === 'select') {
    input = h`<select id="${id}" name="${f.key}">${f.req ? '' : raw('<option value="">—</option>')}${optionsOf(f).map((o) => h`<option value="${o.id}" ${String(o.id) === String(v ?? '') ? raw('selected') : ''}>${o.name}</option>`)}</select>`;
  } else if (f.type === 'textarea') input = h`<textarea id="${id}" name="${f.key}">${v ?? ''}</textarea>`;
  else if (f.type === 'checkbox') return h`<div class="${cls}"><label><input type="checkbox" id="${id}" name="${f.key}" style="width:auto" ${v ? raw('checked') : ''}> ${f.label}</label></div>`;
  else if (f.type === 'date') input = h`<input id="${id}" name="${f.key}" class="ltr" data-jdate placeholder="۱۴۰۵/۰۱/۱۵" value="${Jalali.isoToJalaliStr(v)}" autocomplete="off">`;
  else input = h`<input id="${id}" name="${f.key}" type="${f.type || 'text'}" ${f.type === 'number' ? raw('step="any" min="0"') : ''} ${f.type === 'email' || f.type === 'tel' ? raw('class="ltr"') : ''} value="${v ?? ''}">`;
  return h`<div class="${cls}">${lab}${input}<div class="err" data-err="${f.key}"></div></div>`;
}

/** فرم عمومی؛ onSubmit(values) باید Promise بدهد. خطای 422 سرور زیر فیلدها نمایش داده می‌شود. */
function openForm({ title, fields, values = {}, submitLabel = 'ذخیره', onSubmit, onCancel }) {
  let submitted = false;
  const vis = fields.filter((f) => !(f.managerOnly && !isManager()));
  const m = modal(h`<h2>${title}</h2><form novalidate><div class="form-grid">${vis.map((f) => fieldHtml(f, values[f.key]))}</div>
    <div class="actions"><button class="btn primary" type="submit">${submitLabel}</button><button class="btn" type="button" data-close>انصراف</button></div></form>`, () => { if (!submitted && onCancel) onCancel(); });
  const form = $('form', m.el);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('.err', form).forEach((x) => { x.textContent = ''; });
    const out = {}; let bad = false;
    for (const f of vis) {
      const el = form.elements[f.key];
      if (f.type === 'checkbox') out[f.key] = el.checked;
      else if (f.type === 'date') {
        const t = el.value.trim();
        if (!t) out[f.key] = '';
        else { const iso = Jalali.jalaliStrToIso(t); if (!iso) { $(`[data-err="${f.key}"]`, form).textContent = 'تاریخ شمسی نامعتبر (مثال: ۱۴۰۵/۰۱/۱۵)'; bad = true; } else out[f.key] = iso; }
      } else out[f.key] = el.value;
    }
    if (bad) return;
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { await onSubmit(out); submitted = true; m.close(); }
    catch (err) {
      btn.disabled = false;
      if (err.details) for (const [k, msg] of Object.entries(err.details)) { const t = $(`[data-err="${k}"]`, form); if (t) t.textContent = msg; }
      toast(err.message, true);
    }
  });
  return m;
}

// ---------- پیکربندی موجودیت‌ها ----------
const T = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const OWN = { key: 'owner_id', label: 'مسئول', type: 'select', lookup: 'users', managerOnly: true };
const ENT = {
  contacts: {
    title: 'مخاطبین', single: 'مخاطب', detail: true, name: (r) => r.full_name,
    sort: ['created_at', 'desc'],
    columns: [{ l: 'نام', k: 'first_name', s: 1, r: (r) => h`<b>${r.full_name}</b>` }, { l: 'شرکت', r: (r) => r.company_name || '—' }, { l: 'سمت', r: (r) => r.position || '—' },
      { l: 'موبایل', r: (r) => h`<span class="ltr">${r.mobile || '—'}</span>` }, { l: 'ایمیل', r: (r) => h`<span class="ltr">${r.email || '—'}</span>` }, { l: 'مسئول', r: (r) => r.owner_name || '—' }],
    filters: [{ key: 'owner_id', label: 'همه مسئولان', lookup: 'users', managerOnly: true }],
    fields: [T('first_name', 'نام', { req: 1 }), T('last_name', 'نام خانوادگی'), T('email', 'ایمیل', { type: 'email' }), T('mobile', 'موبایل', { type: 'tel' }), T('phone', 'تلفن', { type: 'tel' }),
      T('position', 'سمت'), { key: 'company_id', label: 'شرکت', type: 'select', lookup: 'companies' }, OWN, T('source', 'منبع آشنایی'), T('tags', 'برچسب‌ها'), { key: 'notes', label: 'توضیحات', type: 'textarea' }],
    info: (r) => [['شرکت', relLink('company', r.company_id, r.company_name)], ['سمت', r.position], ['موبایل', h`<span class="ltr">${r.mobile || '—'}</span>`], ['تلفن', r.phone], ['ایمیل', r.email], ['منبع', r.source], ['برچسب‌ها', r.tags], ['مسئول', r.owner_name], ['توضیحات', r.notes], ['ایجاد', fmtDateTime(r.created_at)]],
  },
  companies: {
    title: 'شرکت‌ها', single: 'شرکت', detail: true, name: (r) => r.name,
    columns: [{ l: 'نام شرکت', k: 'name', s: 1, r: (r) => h`<b>${r.name}</b>` }, { l: 'صنعت', k: 'industry', s: 1, r: (r) => r.industry || '—' }, { l: 'شهر', k: 'city', s: 1, r: (r) => r.city || '—' },
      { l: 'مخاطبین', r: (r) => num(r.contacts_count) }, { l: 'مسئول', r: (r) => r.owner_name || '—' }],
    filters: [{ key: 'owner_id', label: 'همه مسئولان', lookup: 'users', managerOnly: true }],
    fields: [T('name', 'نام شرکت', { req: 1 }), T('industry', 'صنعت'), T('website', 'وب‌سایت', { type: 'url' }), T('phone', 'تلفن', { type: 'tel' }), T('email', 'ایمیل', { type: 'email' }), T('city', 'شهر'),
      T('size', 'تعداد کارکنان', { type: 'number' }), OWN, T('address', 'آدرس', { full: 1 }), { key: 'notes', label: 'توضیحات', type: 'textarea' }],
    info: (r) => [['صنعت', r.industry], ['وب‌سایت', r.website ? h`<a class="ltr" href="${/^https?:\/\//.test(r.website) ? r.website : '#'}" target="_blank" rel="noopener noreferrer">${r.website}</a>` : null], ['تلفن', r.phone], ['ایمیل', r.email], ['شهر', r.city], ['آدرس', r.address], ['کارکنان', r.size != null ? num(r.size) : null], ['مسئول', r.owner_name], ['توضیحات', r.notes]],
  },
  leads: {
    title: 'سرنخ‌ها', single: 'سرنخ', detail: true, name: (r) => r.full_name,
    columns: [{ l: 'نام', k: 'first_name', s: 1, r: (r) => h`<b>${r.full_name}</b>` }, { l: 'شرکت', r: (r) => r.company_name || '—' }, { l: 'منبع', k: 'source', s: 1, r: (r) => r.source || '—' },
      { l: 'وضعیت', k: 'status', s: 1, r: (r) => badge(L.leadStatus, r.status) }, { l: 'امتیاز', k: 'score', s: 1, r: (r) => num(r.score) }, { l: 'مسئول', r: (r) => r.owner_name || '—' }],
    filters: [{ key: 'status', label: 'همه وضعیت‌ها', options: L.leadStatus }, { key: 'owner_id', label: 'همه مسئولان', lookup: 'users', managerOnly: true }],
    fields: [T('first_name', 'نام', { req: 1 }), T('last_name', 'نام خانوادگی'), T('company_name', 'شرکت'), T('email', 'ایمیل', { type: 'email' }), T('phone', 'تلفن', { type: 'tel' }), T('source', 'منبع'),
      { key: 'status', label: 'وضعیت', type: 'select', req: 1, options: { new: 'جدید', contacted: 'تماس گرفته شد', qualified: 'واجد شرایط', lost: 'ازدست‌رفته' } },
      T('score', 'امتیاز (۰ تا ۱۰۰)', { type: 'number' }), OWN, { key: 'notes', label: 'توضیحات', type: 'textarea' }],
    defaults: { status: 'new', score: 0 },
    info: (r) => [['شرکت', r.company_name], ['ایمیل', r.email], ['تلفن', r.phone], ['منبع', r.source], ['وضعیت', badge(L.leadStatus, r.status)], ['امتیاز', num(r.score)], ['مسئول', r.owner_name],
      ['مخاطب', relLink('contact', r.contact_id)], ['معامله', relLink('deal', r.deal_id)], ['توضیحات', r.notes]],
  },
  deals: {
    title: 'معاملات', single: 'معامله', detail: true, name: (r) => r.title,
    columns: [{ l: 'عنوان', k: 'title', s: 1, r: (r) => h`<b>${r.title}</b>` }, { l: 'ارزش', k: 'value', s: 1, r: (r) => money(r.value) }, { l: 'مرحله', k: 'stage', s: 1, r: (r) => badge(L.stage, r.stage) },
      { l: 'پایان مورد انتظار', k: 'expected_close', s: 1, r: (r) => fmtDate(r.expected_close) }, { l: 'مشتری', r: (r) => r.company_name || r.contact_name || '—' }, { l: 'مسئول', r: (r) => r.owner_name || '—' }],
    filters: [{ key: 'stage', label: 'همه مراحل', options: L.stage }, { key: 'owner_id', label: 'همه مسئولان', lookup: 'users', managerOnly: true }],
    fields: [T('title', 'عنوان معامله', { req: 1, full: 1 }), T('value', 'ارزش (' + CURRENCY + ')', { type: 'number' }),
      { key: 'stage', label: 'مرحله', type: 'select', req: 1, options: L.stage }, T('probability', 'احتمال موفقیت (٪)', { type: 'number' }), { key: 'expected_close', label: 'تاریخ پایان مورد انتظار (شمسی)', type: 'date' },
      { key: 'contact_id', label: 'مخاطب', type: 'select', lookup: 'contacts' }, { key: 'company_id', label: 'شرکت', type: 'select', lookup: 'companies' }, OWN,
      T('lost_reason', 'دلیل از دست رفتن'), { key: 'notes', label: 'توضیحات', type: 'textarea' }],
    defaults: { stage: 'new', value: 0 },
    info: (r) => [['ارزش', money(r.value)], ['مرحله', badge(L.stage, r.stage)], ['احتمال', num(r.probability) + '٪'], ['پایان مورد انتظار', fmtDate(r.expected_close)], ['مخاطب', relLink('contact', r.contact_id, r.contact_name)],
      ['شرکت', relLink('company', r.company_id, r.company_name)], ['مسئول', r.owner_name], ['تاریخ بستن', r.closed_at ? fmtDateTime(r.closed_at) : null], ['دلیل از دست رفتن', r.lost_reason], ['توضیحات', r.notes]],
  },
  tasks: {
    title: 'وظایف', single: 'وظیفه', name: (r) => r.title, sort: ['due_date', 'asc'], defaultFilters: { status: 'open' },
    columns: [{ l: '', r: (r) => h`<button class="btn sm" data-act="toggle" data-id="${r.id}" title="تغییر وضعیت">${r.status === 'done' ? '↺' : '✓'}</button>` },
      { l: 'عنوان', k: 'title', s: 1, r: (r) => h`<b style="${r.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''}">${r.title}</b>` },
      { l: 'نوع', r: (r) => L.taskType[r.type] }, { l: 'اولویت', k: 'priority', s: 1, r: (r) => badge(L.priority, r.priority) },
      { l: 'موعد', k: 'due_date', s: 1, r: (r) => h`<span class="${r.status === 'open' && r.due_date && r.due_date < todayIso() ? 'overdue' : ''}">${fmtDate(r.due_date)}</span>` },
      { l: 'مرتبط با', r: (r) => relLink(r.related_type, r.related_id, r.related_label) }, { l: 'مسئول', r: (r) => r.assignee_name || '—' }],
    filters: [{ key: 'status', label: 'همه وضعیت‌ها', options: L.taskStatus }, { key: 'assignee_id', label: 'همه مسئولان', lookup: 'users', managerOnly: true }],
    fields: [T('title', 'عنوان', { req: 1, full: 1 }), { key: 'type', label: 'نوع', type: 'select', req: 1, options: L.taskType }, { key: 'priority', label: 'اولویت', type: 'select', req: 1, options: L.priority },
      { key: 'due_date', label: 'موعد (شمسی)', type: 'date' }, { key: 'assignee_id', label: 'مسئول', type: 'select', lookup: 'users', managerOnly: true }, { key: 'notes', label: 'توضیحات', type: 'textarea' }],
    defaults: { type: 'todo', priority: 'normal' },
  },
  products: {
    title: 'محصولات و خدمات', single: 'محصول', name: (r) => r.name,
    columns: [{ l: 'نام', k: 'name', s: 1, r: (r) => h`<b>${r.name}</b>` }, { l: 'کد', k: 'sku', s: 1, r: (r) => h`<span class="ltr">${r.sku || '—'}</span>` }, { l: 'قیمت', k: 'price', s: 1, r: (r) => money(r.price) },
      { l: 'وضعیت', r: (r) => (r.active ? h`<span class="badge b-ok">فعال</span>` : h`<span class="badge">غیرفعال</span>`) }],
    filters: [{ key: 'active', label: 'همه', options: { 1: 'فعال', 0: 'غیرفعال' } }],
    fields: [T('name', 'نام', { req: 1 }), T('sku', 'کد کالا'), T('price', 'قیمت (' + CURRENCY + ')', { type: 'number' }), { key: 'active', label: 'فعال', type: 'checkbox' }, { key: 'description', label: 'توضیحات', type: 'textarea' }],
    defaults: { active: 1 }, writeManager: true,
  },
};

// ---------- ورود ----------
function showLogin() {
  $('#app').innerHTML = `<div class="login"><form class="card" id="loginForm"><h1>CRM</h1><p class="muted" style="text-align:center;margin-top:0">ورود به سیستم مدیریت ارتباط با مشتری</p>
  <div class="field"><label for="u">نام کاربری</label><input id="u" class="ltr" autocomplete="username" required></div>
  <div class="field"><label for="p">گذرواژه</label><input id="p" type="password" class="ltr" autocomplete="current-password" required></div>
  <div class="err muted" id="lerr" style="color:var(--bad);min-height:20px"></div><button class="btn primary" style="width:100%;justify-content:center">ورود</button></form></div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { ME = await api('POST', '/api/auth/login', { username: $('#u').value.trim(), password: $('#p').value }); await boot(); }
    catch (err) { $('#lerr').textContent = err.message; }
  });
}

// ---------- پوسته ----------
const NAV = [['dashboard', 'داشبورد', 'sales'], ['deals', 'معاملات', 'sales'], ['leads', 'سرنخ‌ها', 'sales'], ['contacts', 'مخاطبین', 'sales'], ['companies', 'شرکت‌ها', 'sales'], ['tasks', 'وظایف', 'sales'],
  ['products', 'محصولات', 'sales'], ['team', 'گزارش تیم', 'manager'], ['users', 'کاربران', 'admin'], ['audit', 'گزارش رویدادها', 'admin']];
const RANK = { sales: 1, manager: 2, admin: 3 };

async function boot() {
  try { if (!ME) ME = await api('GET', '/api/auth/me'); LK = await api('GET', '/api/lookups'); } catch { return showLogin(); }
  $('#app').innerHTML = `<div class="shell"><aside class="side" id="side"><div class="brand">◈ CRM فارسی</div><nav class="nav" id="nav"></nav>
    <div class="me"><div><b id="meName"></b><div class="muted" id="meRole"></div></div><div style="margin-top:8px;display:flex;gap:6px"><button class="btn sm" id="pwBtn">گذرواژه</button><button class="btn sm" id="outBtn">خروج</button></div></div></aside>
    <main class="main"><div id="view"></div></main></div>`;
  $('#meName').textContent = ME.name; $('#meRole').textContent = L.role[ME.role];
  $('#nav').innerHTML = NAV.filter((n) => RANK[ME.role] >= RANK[n[2]]).map(([k, l]) => `<a href="#/${k}" data-nav="${k}">${l}</a>`).join('');
  $('#outBtn').onclick = async () => { try { await api('POST', '/api/auth/logout', {}); } catch { /* ignore */ } ME = null; showLogin(); };
  $('#pwBtn').onclick = () => openForm({ title: 'تغییر گذرواژه', fields: [T('current', 'گذرواژه فعلی', { type: 'password', req: 1 }), T('password', 'گذرواژه جدید (حداقل ۸ نویسه)', { type: 'password', req: 1 })],
    onSubmit: async (v) => { await api('POST', '/api/auth/password', v); toast('گذرواژه تغییر کرد'); } });
  $('#nav').addEventListener('click', () => $('#side').classList.remove('open'));
  route();
}

let routeToken = 0;
async function route() {
  if (!ME || !view()) return;
  const token = ++routeToken;
  bind = null;
  const [name = 'dashboard', id] = location.hash.replace(/^#\//, '').split('/');
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  view().innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  try {
    let out;
    if (name === 'dashboard') out = await dashboardView();
    else if (name === 'deals' && !id) out = await dealsView();
    else if (name === 'deals' && id === 'list') out = await listView('deals');
    else if (name === 'team' && isManager()) out = await teamView();
    else if (name === 'users' && ME.role === 'admin') out = await usersView();
    else if (name === 'audit' && ME.role === 'admin') out = await auditView();
    else if (ENT[name] && id && ENT[name].detail && Number.isInteger(Number(id))) out = await detailView(name, Number(id));
    else if (ENT[name]) out = await listView(name);
    else { location.hash = '#/dashboard'; return; }
    if (token !== routeToken) return; // مسیر دیگری انتخاب شده
    if (out) view().innerHTML = out.s;
    bind && bind();
  } catch (e) { if (e.status !== 401) view().innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
let bind = null; // تابع اتصال رویدادها که هر view تنظیم می‌کند
window.addEventListener('hashchange', route);
document.addEventListener('click', (e) => { if (e.target.closest('[data-menu]')) $('#side')?.classList.toggle('open'); });

const pageHead = (title, actions = '') => h`<div class="top"><div style="display:flex;gap:10px;align-items:center"><button class="btn menu-btn" data-menu aria-label="منو">☰</button><h1>${title}</h1></div><div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div></div>`;

// ---------- فهرست عمومی ----------
const LIST_STATE = {};
async function listView(name) {
  const E = ENT[name];
  const st = (LIST_STATE[name] ||= { q: '', page: 1, sort: E.sort?.[0], dir: E.sort?.[1], f: { ...(E.defaultFilters || {}) } });
  const canWrite = !E.writeManager || isManager();
  const filters = E.filters.filter((f) => !(f.managerOnly && !isManager()));
  const out = h`${pageHead(E.title, h`${name === 'deals' ? h`<a class="btn" href="#/deals">نمای پایپ‌لاین</a>` : ''}${isManager() ? h`<a class="btn" id="csv" href="#">خروجی CSV</a>` : ''}${canWrite ? h`<button class="btn primary" id="add">+ ${E.single} جدید</button>` : ''}`)}
    <div class="toolbar"><input type="search" id="q" placeholder="جست‌وجو…" value="${st.q}" style="min-width:220px">
    ${filters.map((f) => h`<select data-f="${f.key}"><option value="">${f.label}</option>${optionsOf(f).map((o) => h`<option value="${o.id}" ${String(st.f[f.key] ?? '') === String(o.id) ? raw('selected') : ''}>${o.name}</option>`)}</select>`)}</div><div id="tbl"></div>`;
  bind = () => {
    let timer;
    const qs = () => new URLSearchParams({ q: st.q, page: st.page, limit: 25, ...(st.sort ? { sort: st.sort, dir: st.dir } : {}), ...Object.fromEntries(Object.entries(st.f).filter(([, v]) => v !== '')) });
    const load = guard(async () => {
      const r = await api('GET', `/api/${name}?${qs()}`);
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      $('#tbl').innerHTML = (r.data.length ? h`<div class="tablewrap"><table><thead><tr>${E.columns.map((c) => h`<th class="${c.s ? 'sortable' : ''}" data-sort="${c.s ? c.k : ''}">${c.l}${st.sort === c.k ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`)}<th></th></tr></thead>
        <tbody>${r.data.map((row) => h`<tr class="row" data-id="${row.id}">${E.columns.map((c) => h`<td>${c.r(row)}</td>`)}<td style="white-space:nowrap">${!E.detail && canWrite ? h`<button class="btn sm" data-act="edit" data-id="${row.id}">ویرایش</button> ` : ''}${(isManager() || name === 'tasks') && canWrite && !E.detail ? h`<button class="btn sm danger" data-act="del" data-id="${row.id}">حذف</button>` : ''}</td></tr>`)}</tbody></table></div>
        <div class="pager"><button class="btn sm" data-p="-1" ${st.page <= 1 ? raw('disabled') : ''}>قبلی</button><span>صفحه ${num(st.page)} از ${num(pages)} — ${num(r.total)} مورد</span><button class="btn sm" data-p="1" ${st.page >= pages ? raw('disabled') : ''}>بعدی</button></div>`
        : h`<div class="card empty">موردی یافت نشد.</div>`).s;
      $$('[data-sort]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.sort; if (!k) return; st.dir = st.sort === k && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = k; load(); }));
      $$('[data-p]').forEach((b) => b.addEventListener('click', () => { st.page += Number(b.dataset.p); load(); }));
      $$('tr.row').forEach((tr) => tr.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]'); const id = Number(tr.dataset.id); const row = r.data.find((x) => x.id === id);
        if (btn) return act(btn.dataset.act, row);
        if (e.target.closest('a')) return;
        if (E.detail) location.hash = `#/${name}/${id}`; else if (canWrite) act('edit', row);
      }));
    });
    const act = guard(async (a, row) => {
      if (a === 'toggle') { await api('PUT', `/api/tasks/${row.id}`, { status: row.status === 'done' ? 'open' : 'done' }); return load(); }
      if (a === 'edit') return openForm({ title: `ویرایش ${E.single}`, fields: E.fields, values: row, onSubmit: async (v) => { await api('PUT', `/api/${name}/${row.id}`, v); toast('ذخیره شد'); LK = await api('GET', '/api/lookups'); load(); } });
      if (a === 'del' && confirm(`«${E.name(row)}» حذف شود؟`)) { await api('DELETE', `/api/${name}/${row.id}`); toast('حذف شد'); load(); }
    });
    $('#q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value; st.page = 1; load(); }, 300); });
    $$('[data-f]').forEach((s) => s.addEventListener('change', () => { st.f[s.dataset.f] = s.value; st.page = 1; load(); }));
    const add = $('#add');
    if (add) add.addEventListener('click', () => openForm({ title: `${E.single} جدید`, fields: E.fields, values: E.defaults || {}, onSubmit: async (v) => { await api('POST', `/api/${name}`, v); toast('ایجاد شد'); LK = await api('GET', '/api/lookups'); load(); } }));
    const csv = $('#csv');
    if (csv) csv.addEventListener('click', async (e) => {
      e.preventDefault();
      const res = await fetch(`/api/${name}/export.csv?${qs()}`, { credentials: 'same-origin' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
    });
    load();
  };
  return out;
}

// ---------- صفحه جزئیات ----------
async function detailView(name, id) {
  const E = ENT[name];
  const row = await api('GET', `/api/${name}/${id}`);
  const rel = { contacts: 'contact', companies: 'company', leads: 'lead', deals: 'deal' }[name];
  const [acts, tasks] = await Promise.all([api('GET', `/api/activities?entity_type=${rel}&entity_id=${id}`), api('GET', `/api/tasks?related_type=${rel}&related_id=${id}&all=1&limit=200&sort=due_date&dir=asc`)]);
  let extra = raw('');
  if (name === 'companies') {
    const [cs, ds] = await Promise.all([api('GET', `/api/contacts?company_id=${id}&limit=100`), api('GET', `/api/deals?company_id=${id}&limit=100`)]);
    extra = h`<div class="card"><h2>مخاطبین (${num(cs.total)})</h2>${cs.data.length ? cs.data.map((c) => h`<div><a href="#/contacts/${c.id}">${c.full_name}</a> <span class="muted">${c.position || ''}</span></div>`) : h`<span class="muted">—</span>`}</div>
      <div class="card"><h2>معاملات (${num(ds.total)})</h2>${ds.data.length ? ds.data.map((d) => h`<div><a href="#/deals/${d.id}">${d.title}</a> ${badge(L.stage, d.stage)} <span class="muted">${money(d.value)}</span></div>`) : h`<span class="muted">—</span>`}</div>`;
  } else if (name === 'contacts') {
    const ds = await api('GET', `/api/deals?contact_id=${id}&limit=100`);
    extra = h`<div class="card"><h2>معاملات (${num(ds.total)})</h2>${ds.data.length ? ds.data.map((d) => h`<div><a href="#/deals/${d.id}">${d.title}</a> ${badge(L.stage, d.stage)} <span class="muted">${money(d.value)}</span></div>`) : h`<span class="muted">—</span>`}</div>`;
  }
  let items = [];
  if (name === 'deals') items = await api('GET', `/api/deals/${id}/items`);
  const itemsTotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const itemsCard = name === 'deals' ? h`<div class="card"><h2 style="display:flex;justify-content:space-between">اقلام معامله <button class="btn sm" id="editItems">ویرایش اقلام</button></h2>
    ${items.length ? h`<table><thead><tr><th>شرح</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead><tbody>${items.map((i) => h`<tr><td>${i.name}</td><td>${num(i.qty)}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`)}</tbody>
    <tfoot><tr><th colspan="3">جمع کل</th><th>${money(itemsTotal)}</th></tr></tfoot></table>` : h`<span class="muted">قلمی ثبت نشده است. با ثبت اقلام، ارزش معامله خودکار محاسبه می‌شود.</span>`}</div>` : raw('');
  const canDel = isManager();
  const out = h`${pageHead(E.name(row), h`
    ${name === 'leads' && row.status !== 'converted' ? h`<button class="btn primary" id="convert">تبدیل به مخاطب</button>` : ''}
    ${name === 'deals' ? h`<select id="stageSel" aria-label="مرحله">${Object.entries(L.stage).map(([k, v]) => h`<option value="${k}" ${k === row.stage ? raw('selected') : ''}>${v}</option>`)}</select>` : ''}
    <button class="btn" id="edit">ویرایش</button>${canDel ? h`<button class="btn danger" id="del">حذف</button>` : ''}<a class="btn" href="#/${name}">بازگشت</a>`)}
    <div class="grid cols2"><div class="grid" style="align-content:start"><div class="card"><dl class="dl">${E.info(row).map(([k, v]) => h`<dt>${k}</dt><dd>${v || v === 0 ? v : '—'}</dd>`)}</dl></div>${itemsCard}${extra}</div>
    <div class="grid" style="align-content:start">
      <div class="card"><h2>ثبت فعالیت</h2><form id="actForm"><div class="form-grid"><div class="field"><select name="type">${['note', 'call', 'meeting', 'email'].map((t) => h`<option value="${t}">${L.act[t]}</option>`)}</select></div><div class="field"></div><div class="field full"><textarea name="body" placeholder="متن یادداشت یا خلاصه‌ی مکالمه…" required></textarea></div></div><button class="btn primary sm">ثبت</button></form>
        <ul class="timeline" style="margin-top:12px">${acts.map((a) => h`<li class="${a.type === 'system' ? 'sys' : ''}"><span class="dot"></span><div><div>${a.body}</div><div class="meta">${L.act[a.type]} · ${a.user_name || '—'} · ${fmtDateTime(a.created_at)}</div></div></li>`)}</ul></div>
      <div class="card"><h2 style="display:flex;justify-content:space-between">وظایف مرتبط <button class="btn sm" id="addTask">+ وظیفه</button></h2>
        ${tasks.data.length ? tasks.data.map((t) => h`<div style="display:flex;gap:8px;align-items:center;margin:6px 0"><button class="btn sm" data-toggle="${t.id}" data-status="${t.status}">${t.status === 'done' ? '↺' : '✓'}</button><span style="${t.status === 'done' ? 'text-decoration:line-through;opacity:.6' : ''}">${t.title}</span><span class="muted ${t.status === 'open' && t.due_date && t.due_date < todayIso() ? 'overdue' : ''}">${fmtDate(t.due_date)}</span></div>`) : h`<span class="muted">—</span>`}</div></div></div>`;
  bind = () => {
    const reload = () => route();
    $('#edit').onclick = () => openForm({ title: `ویرایش ${E.single}`, fields: E.fields, values: row, onSubmit: async (v) => { await api('PUT', `/api/${name}/${id}`, v); toast('ذخیره شد'); LK = await api('GET', '/api/lookups'); reload(); } });
    const del = $('#del'); if (del) del.onclick = guard(async () => { if (confirm(`«${E.name(row)}» و سوابق/وظایف مرتبط حذف شود؟`)) { await api('DELETE', `/api/${name}/${id}`); toast('حذف شد'); location.hash = `#/${name}`; } });
    $('#actForm').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target; await api('POST', '/api/activities', { entity_type: rel, entity_id: id, type: f.type.value, body: f.body.value }); reload(); });
    $('#addTask').onclick = () => openForm({ title: 'وظیفه‌ی جدید', fields: ENT.tasks.fields, values: ENT.tasks.defaults, onSubmit: async (v) => { await api('POST', '/api/tasks', { ...v, related_type: rel, related_id: id }); reload(); } });
    $$('[data-toggle]').forEach((b) => { b.onclick = guard(async () => { await api('PUT', `/api/tasks/${b.dataset.toggle}`, { status: b.dataset.status === 'done' ? 'open' : 'done' }); reload(); }); });
    const conv = $('#convert');
    if (conv) conv.onclick = () => openForm({ title: 'تبدیل سرنخ به مخاطب', submitLabel: 'تبدیل', fields: [{ key: 'create_deal', label: 'یک معامله هم ایجاد شود', type: 'checkbox', full: 1 }, T('deal_title', 'عنوان معامله', { full: 1 }), T('deal_value', 'ارزش معامله', { type: 'number' })],
      values: { create_deal: true, deal_title: `معامله ${row.full_name}` }, onSubmit: async (v) => { const r = await api('POST', `/api/leads/${id}/convert`, v); toast('سرنخ تبدیل شد'); location.hash = `#/contacts/${r.contact_id}`; } });
    const sel = $('#stageSel');
    if (sel) sel.onchange = () => moveDeal(id, sel.value);
    const ei = $('#editItems');
    if (ei) ei.onclick = () => editItems(id, items, reload);
  };
  return out;
}

/** انتقال معامله به مرحله‌ی جدید (برای «ازدست‌رفته» دلیل پرسیده می‌شود) و سپس بازخوانی صفحه */
async function moveDeal(id, stage) {
  try {
    if (stage === 'lost') {
      await new Promise((resolve, reject) => openForm({ title: 'دلیل از دست رفتن معامله', fields: [T('lost_reason', 'دلیل', { full: 1 })],
        onSubmit: async (v) => { await api('PUT', `/api/deals/${id}`, { stage, lost_reason: v.lost_reason }); resolve(); },
        onCancel: () => reject(Object.assign(new Error('لغو شد'), { cancelled: true })) }));
    } else await api('PUT', `/api/deals/${id}`, { stage });
  } catch (e) { if (!e.cancelled && e.status !== 401) toast(e.message, true); }
  route();
}

function editItems(dealId, items, done) {
  const rows = items.length ? items.map((i) => ({ ...i })) : [{ name: '', qty: 1, price: 0 }];
  const draw = () => {
    const body = $('#itemsBody', m.el);
    body.innerHTML = rows.map((r, i) => `<tr><td><input data-i="${i}" data-k="name" value="${esc(r.name)}" list="plist" placeholder="شرح"></td><td><input data-i="${i}" data-k="qty" type="number" min="0" step="any" value="${esc(r.qty)}" style="width:70px"></td>
      <td><input data-i="${i}" data-k="price" type="number" min="0" step="any" value="${esc(r.price)}" style="width:130px"></td><td><button type="button" class="btn sm danger" data-rm="${i}">✕</button></td></tr>`).join('');
    $$('input', body).forEach((inp) => inp.addEventListener('input', () => {
      const r = rows[inp.dataset.i]; r[inp.dataset.k] = inp.dataset.k === 'name' ? inp.value : Number(inp.value);
      if (inp.dataset.k === 'name') { const p = LK.products.find((x) => x.name === inp.value); if (p) { r.product_id = p.id; r.price = p.price; draw(); } }
      $('#itotal', m.el).textContent = money(rows.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0));
    }));
    $$('[data-rm]', body).forEach((b) => b.addEventListener('click', () => { rows.splice(Number(b.dataset.rm), 1); draw(); }));
    $('#itotal', m.el).textContent = money(rows.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0));
  };
  const m = modal(h`<h2>اقلام معامله</h2><datalist id="plist">${LK.products.map((p) => h`<option value="${p.name}"></option>`)}</datalist>
    <table><thead><tr><th>شرح / محصول</th><th>تعداد</th><th>قیمت واحد</th><th></th></tr></thead><tbody id="itemsBody"></tbody></table>
    <p><button class="btn sm" id="addRow" type="button">+ ردیف</button> <b style="margin-inline-start:12px">جمع: <span id="itotal"></span></b></p>
    <div class="actions"><button class="btn primary" id="saveItems">ذخیره</button><button class="btn" data-close>انصراف</button></div>`);
  draw();
  $('#addRow', m.el).onclick = () => { rows.push({ name: '', qty: 1, price: 0 }); draw(); };
  $('#saveItems', m.el).onclick = guard(async () => {
    const clean = rows.filter((r) => r.name && r.name.trim());
    await api('PUT', `/api/deals/${dealId}/items`, { items: clean }); m.close(); toast('اقلام ذخیره شد'); done();
  });
}

// ---------- معاملات (کانبان) ----------
async function dealsView() {
  const E = ENT.deals;
  const r = await api('GET', '/api/deals?all=1&limit=5000&sort=expected_close&dir=asc');
  const byStage = Object.fromEntries(Object.keys(L.stage).map((s) => [s, r.data.filter((d) => d.stage === s)]));
  const out = h`${pageHead('معاملات', h`<a class="btn" href="#/deals/list">نمای فهرست</a><button class="btn primary" id="add">+ معامله جدید</button>`)}
    <div class="kanban">${Object.entries(L.stage).map(([s, label]) => h`<div class="col" data-stage="${s}"><h3><span>${label}</span><span class="badge">${num(byStage[s].length)}</span></h3><div class="sum">${money(byStage[s].reduce((a, d) => a + d.value, 0))}</div>
      ${byStage[s].map((d) => h`<div class="dcard" draggable="true" data-id="${d.id}"><a class="t" href="#/deals/${d.id}">${d.title}</a><div class="s">${money(d.value)}</div><div class="s">${d.company_name || d.contact_name || ''}</div>
        <div class="s">${d.expected_close ? h`<span class="${s !== 'won' && s !== 'lost' && d.expected_close < todayIso() ? 'overdue' : ''}">📅 ${fmtDate(d.expected_close)}</span>` : ''} ${isManager() && d.owner_name ? '· ' + d.owner_name : ''}</div>
        <select data-move="${d.id}" aria-label="تغییر مرحله" style="margin-top:6px;padding:2px 6px;font-size:12px">${Object.entries(L.stage).map(([k, v]) => h`<option value="${k}" ${k === d.stage ? raw('selected') : ''}>${v}</option>`)}</select></div>`)}</div>`)}</div>`;
  bind = () => {
    $('#add').onclick = () => openForm({ title: 'معامله جدید', fields: E.fields, values: E.defaults, onSubmit: async (v) => { await api('POST', '/api/deals', v); toast('ایجاد شد'); route(); } });
    $$('[data-move]').forEach((s) => s.addEventListener('change', () => moveDeal(Number(s.dataset.move), s.value)));
    $$('.dcard').forEach((c) => c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; }));
    $$('.col').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('over'); const id = Number(e.dataTransfer.getData('text/plain')); const d = r.data.find((x) => x.id === id); if (d && d.stage !== col.dataset.stage) moveDeal(id, col.dataset.stage); });
    });
  };
  return out;
}

// ---------- داشبورد ----------
async function dashboardView() {
  const d = await api('GET', '/api/dashboard');
  const maxStage = Math.max(1, ...d.pipeline.stages.filter((s) => !['lost'].includes(s.stage)).map((s) => s.value));
  const maxRev = Math.max(1, ...d.revenue_by_month.map((m) => m.value));
  const kpi = (l, v, s = '') => h`<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const stageOrder = Object.keys(L.stage);
  return h`${pageHead('داشبورد', h`<span class="muted">${ME.name}</span>`)}
  <div class="grid kpis">${kpi('ارزش پایپ‌لاین باز', money(d.pipeline.open_value), `${num(d.pipeline.open_count)} معامله`)}${kpi('پیش‌بینی وزنی', money(d.pipeline.weighted_value), 'بر اساس احتمال مراحل')}
    ${kpi('فروش این ماه', money(d.won_month.value), `${num(d.won_month.count)} معامله برنده`)}${kpi('نرخ موفقیت', d.win_rate == null ? '—' : num(d.win_rate) + '٪', 'برنده / (برنده + ازدست‌رفته)')}
    ${kpi('سرنخ‌های باز', num(d.counts.leads_open))}${kpi('وظایف عقب‌افتاده', h`<span class="${d.tasks_overdue ? 'overdue' : ''}">${num(d.tasks_overdue)}</span>`)}${kpi('مخاطبین', num(d.counts.contacts), `${num(d.counts.companies)} شرکت`)}</div>
  <div class="grid cols2" style="margin-top:14px">
    <div class="card"><h2>قیف فروش (ارزش به تفکیک مرحله)</h2>${stageOrder.map((s) => { const x = d.pipeline.stages.find((y) => y.stage === s) || { count: 0, value: 0 }; return h`<div class="barrow"><span>${L.stage[s]} <span class="muted">(${num(x.count)})</span></span><div class="track"><div class="bar" style="width:${Math.round((x.value / maxStage) * 100)}%;${s === 'lost' ? 'background:var(--bad)' : s === 'won' ? 'background:var(--ok)' : ''}"></div></div><span class="num">${money(x.value)}</span></div>`; })}</div>
    <div class="card"><h2>فروش ماهانه (۶ ماه اخیر)</h2>${d.revenue_by_month.length ? h`<div class="chart">${d.revenue_by_month.map((m) => h`<div class="c" title="${money(m.value)}"><span>${num(Math.round(m.value / 1e6))}م</span><div class="b" style="height:${Math.max(2, Math.round((m.value / maxRev) * 100))}%"></div><span>${dfMonth.format(new Date(m.month + 'T00:00:00Z'))}</span></div>`)}</div><div class="muted" style="font-size:12px">اعداد به میلیون ${CURRENCY}</div>` : h`<div class="empty">هنوز فروشی ثبت نشده.</div>`}</div>
    <div class="card"><h2>وظایف امروز و عقب‌افتاده</h2>${d.tasks_due.length ? d.tasks_due.map((t) => h`<div style="margin:6px 0"><span class="badge">${L.taskType[t.type]}</span> ${t.title} <span class="${t.due_date < todayIso() ? 'overdue' : 'muted'}">${fmtDate(t.due_date)}</span></div>`) : h`<span class="muted">وظیفه‌ی معوقی نیست 🎉</span>`}<p><a href="#/tasks">همه‌ی وظایف ←</a></p></div>
    <div class="card"><h2>معاملات نزدیک به بسته‌شدن (۱۴ روز)</h2>${d.closing_soon.length ? d.closing_soon.map((x) => h`<div style="margin:6px 0"><a href="#/deals/${x.id}">${x.title}</a> ${badge(L.stage, x.stage)} <span class="muted">${money(x.value)} · ${fmtDate(x.expected_close)}</span></div>`) : h`<span class="muted">—</span>`}</div>
    <div class="card"><h2>وضعیت سرنخ‌ها</h2>${d.leads_by_status.length ? d.leads_by_status.map((x) => h`<div style="margin:5px 0">${badge(L.leadStatus, x.status)} ${num(x.count)}</div>`) : h`<span class="muted">—</span>`}</div>
    <div class="card"><h2>آخرین فعالیت‌ها</h2><ul class="timeline">${d.recent.map((a) => h`<li class="${a.type === 'system' ? 'sys' : ''}"><span class="dot"></span><div>${a.body} <a href="#/${REL_ROUTE[a.entity_type]}/${a.entity_id}">(${L.rel[a.entity_type]} #${num(a.entity_id)})</a><div class="meta">${a.user_name || '—'} · ${fmtDateTime(a.created_at)}</div></div></li>`)}</ul></div></div>`;
}

// ---------- گزارش تیم / کاربران / ممیزی ----------
async function teamView() {
  const rows = await api('GET', '/api/reports/team');
  return h`${pageHead('گزارش عملکرد تیم فروش')}<div class="tablewrap"><table><thead><tr><th>کارشناس</th><th>معاملات باز</th><th>ارزش پایپ‌لاین</th><th>برده</th><th>فروش (برنده)</th><th>ازدست‌رفته</th><th>نرخ موفقیت</th><th>وظایف معوق</th></tr></thead><tbody>
    ${rows.map((r) => h`<tr><td><b>${r.name}</b></td><td>${num(r.open_deals)}</td><td>${money(r.pipeline_value)}</td><td>${num(r.won_count)}</td><td>${money(r.won_value)}</td><td>${num(r.lost_count)}</td><td>${r.won_count + r.lost_count ? num(Math.round((r.won_count / (r.won_count + r.lost_count)) * 100)) + '٪' : '—'}</td><td class="${r.overdue_tasks ? 'overdue' : ''}">${num(r.overdue_tasks)}</td></tr>`)}</tbody></table></div>`;
}
const USER_FIELDS = (isNew) => [...(isNew ? [T('username', 'نام کاربری (لاتین)', { req: 1 })] : []), T('name', 'نام نمایشی', { req: 1 }), { key: 'role', label: 'نقش', type: 'select', req: 1, options: L.role },
  ...(isNew ? [] : [{ key: 'active', label: 'فعال', type: 'checkbox' }]), T('password', isNew ? 'گذرواژه (حداقل ۸ نویسه)' : 'گذرواژه جدید (خالی = بدون تغییر)', { type: 'password', req: isNew })];
async function usersView() {
  const rows = await api('GET', '/api/users');
  bind = () => {
    $('#add').onclick = () => openForm({ title: 'کاربر جدید', fields: USER_FIELDS(true), values: { role: 'sales' }, onSubmit: async (v) => { await api('POST', '/api/users', v); LK = await api('GET', '/api/lookups'); route(); } });
    $$('[data-edit]').forEach((b) => b.addEventListener('click', () => { const u = rows.find((x) => x.id === Number(b.dataset.edit));
      openForm({ title: `ویرایش ${u.username}`, fields: USER_FIELDS(false), values: u, onSubmit: async (v) => { if (!v.password) delete v.password; await api('PUT', `/api/users/${u.id}`, v); LK = await api('GET', '/api/lookups'); route(); } }); }));
  };
  return h`${pageHead('کاربران', h`<button class="btn primary" id="add">+ کاربر جدید</button>`)}<div class="tablewrap"><table><thead><tr><th>نام کاربری</th><th>نام</th><th>نقش</th><th>وضعیت</th><th>ایجاد</th><th></th></tr></thead><tbody>
    ${rows.map((u) => h`<tr><td class="ltr">${u.username}</td><td>${u.name}</td><td>${L.role[u.role]}</td><td>${u.active ? h`<span class="badge b-ok">فعال</span>` : h`<span class="badge b-bad">غیرفعال</span>`}</td><td>${fmtDate(u.created_at)}</td><td><button class="btn sm" data-edit="${u.id}">ویرایش</button></td></tr>`)}</tbody></table></div>`;
}
async function auditView() {
  const rows = await api('GET', '/api/audit');
  return h`${pageHead('گزارش رویدادها (۳۰۰ مورد اخیر)')}<div class="tablewrap"><table><thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>موجودیت</th><th>شناسه</th><th>جزئیات</th></tr></thead><tbody>
    ${rows.map((a) => h`<tr><td>${fmtDateTime(a.created_at)}</td><td>${a.user_name || '—'}</td><td>${a.action}</td><td>${a.entity || ''}</td><td>${a.entity_id ?? ''}</td><td class="ltr muted" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.detail || ''}</td></tr>`)}</tbody></table></div>`;
}

boot();
