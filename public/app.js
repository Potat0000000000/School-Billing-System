// =====================================================
// Torres Capitol College — Billing & Payments (front end)
// =====================================================

// Edit these to match the school's real payment details (shown to students on "Pay a bill").
const PAY_INFO = {
  gcash: '09XX XXX XXXX · Torres Capitol College',
  bank: 'Landbank / BPI · Account name and number here',
  counter: 'Business Office, Main Building · Mon–Fri, 8:00 AM–5:00 PM'
};

let token = localStorage.getItem('token') || '';
let me = JSON.parse(localStorage.getItem('user') || 'null');
const S = { view: null, meta: null, sum: null, acct: null, acctData: null, receipt: null, preBill: null, badges: {}, users: [], terms: [] };

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0);
const peso = (n) => '₱' + num(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const orNo = (id) => 'OR-' + String(id).padStart(5, '0');
const PERIODS = { prelim: 'Prelims', midterm: 'Midterms', prefinal: 'Pre-Finals', finals: 'Finals' };
const METHODS = { cash: 'Cash', gcash: 'GCash', bank: 'Bank transfer', 'bank transfer': 'Bank transfer', 'business office': 'Business Office' };
const methodLabel = (m) => METHODS[String(m || '').toLowerCase()] || m || '—';
const fmtDate = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
};
const fmtDT = (s) => (s ? new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const isOverdue = (b) => b.status !== 'paid' && b.due_date && b.due_date < todayStr();
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

const CHIP = {
  paid: ['Paid', 'ok'], confirmed: ['Confirmed', 'ok'], partially_paid: ['Partly paid', 'warn'], pending: ['Awaiting verification', 'warn'],
  unpaid: ['Unpaid', 'bad'], rejected: ['Rejected', 'bad'], voided: ['Voided', 'mute'], cancelled: ['Cancelled', 'mute'], overdue: ['Overdue', 'bad']
};
const chip = (s) => { const [l, c] = CHIP[s] || [s, 'mute']; return `<span class="chip ${c}">${esc(l)}</span>`; };

const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>',
  pay: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v7H2v-7z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  log: '<path d="M4 4h16v16H4z M8 9h8 M8 13h8 M8 17h5"/>'
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && token) {
    handleLogout();
    throw new Error(data.error || 'Your session expired. Sign in again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}

// ---------- forms & modals ----------
async function submitForm(e, fn) {
  e.preventDefault();
  const form = e.target;
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try { await fn(new FormData(form), form); }
  catch (err) { toast(err.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}

let askResolve = null;
function openModal({ title, body, foot = '', wide = false }) {
  $('modalRoot').innerHTML = `<div class="modal"><div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="dialog-head"><h3>${esc(title)}</h3><button class="icon-btn" onclick="closeModal()" aria-label="Close">✕</button></div>
    <div class="dialog-body">${body}</div>${foot ? `<div class="dialog-foot">${foot}</div>` : ''}</div></div>`;
}
function closeModal() {
  $('modalRoot').innerHTML = '';
  if (askResolve) { askResolve(false); askResolve = null; }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modalRoot').innerHTML) closeModal(); });
function ask(title, message, ok = 'Confirm', danger = false) {
  return new Promise((res) => {
    askResolve = res;
    openModal({
      title, body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn" onclick="answerAsk(false)">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" onclick="answerAsk(true)">${esc(ok)}</button>`
    });
  });
}
function answerAsk(v) { const r = askResolve; askResolve = null; closeModal(); if (r) r(v); }
const formFoot = (label) => `<div class="dialog-foot" style="padding:0;margin-top:.5rem"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">${esc(label)}</button></div>`;

function togglePw(btn) {
  const i = btn.parentElement.querySelector('input');
  i.type = i.type === 'password' ? 'text' : 'password';
  btn.textContent = i.type === 'password' ? 'Show' : 'Hide';
}
function toggleSide(open) { $('side').classList.toggle('open', open); $('scrim').classList.toggle('open', open); }
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  $('themeBtn').textContent = next === 'dark' ? '☀' : '☾';
}

// ---------- boot & auth ----------
document.addEventListener('DOMContentLoaded', () => {
  $('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '☀' : '☾';
  const resetToken = new URLSearchParams(location.search).get('reset');
  if (resetToken) {
    RESET_TOKEN = resetToken;
    history.replaceState(null, '', location.pathname); // keep the token out of the address bar
    handleLogout();
    switchAuthTab('reset');
  } else if (token && me) showApp(); else showAuth();
});

function switchAuthTab(tab) {
  const panes = { login: 'loginForm', register: 'registerForm', forgot: 'forgotForm', reset: 'resetForm' };
  Object.entries(panes).forEach(([k, id]) => $(id).classList.toggle('hidden', k !== tab));
  $('authSeg').classList.toggle('hidden', tab === 'forgot' || tab === 'reset');
  $('tabLogin').classList.toggle('on', tab === 'login');
  $('tabRegister').classList.toggle('on', tab === 'register');
}

// Password reset: the emailed link opens the site as /?reset=TOKEN
let RESET_TOKEN = '';
async function doForgot(fd, form) {
  const r = await post('/api/auth/forgot-password', { identifier: fd.get('identifier').trim() });
  toast(r.message);
  form.reset();
  switchAuthTab('login');
}
async function doReset(fd, form) {
  if (fd.get('new_password') !== fd.get('confirm_password')) throw new Error('The two passwords do not match.');
  const r = await post('/api/auth/reset-password', { token: RESET_TOKEN, new_password: fd.get('new_password') });
  RESET_TOKEN = '';
  form.reset();
  toast(r.message);
  switchAuthTab('login');
}

async function doLogin(fd, form) {
  const data = await post('/api/auth/login', { identifier: fd.get('identifier').trim(), password: fd.get('password') });
  token = data.token; me = data.user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(me));
  form.reset();
  showApp();
}

async function doRegister(fd, form) {
  const data = await post('/api/auth/register', {
    student_id: fd.get('student_id').trim(), full_name: fd.get('full_name').trim(), email: fd.get('email').trim(),
    year_level: fd.get('year_level'), password: fd.get('password')
  });
  toast(data.message);
  form.reset();
  switchAuthTab('login');
}

function handleLogout() {
  localStorage.removeItem('token'); localStorage.removeItem('user');
  token = ''; me = null; S.meta = null; S.acct = null; S.acctData = null; S.badges = {};
  closeModal();
  showAuth();
}
function showAuth() { $('auth').classList.remove('hidden'); $('app').classList.add('hidden'); }

const NAV = {
  student: [['dashboard', 'Dashboard', 'home'], ['pay', 'Pay a bill', 'pay'], ['history', 'Payments & receipts', 'receipt'], ['account', 'My account', 'user']],
  cashier: [['terminal', 'Cashier terminal', 'pay'], ['dashboard', 'Dashboard', 'home'], ['students', 'Student accounts', 'search'], ['transactions', 'Transactions', 'list'], ['registrations', 'Registrations', 'inbox'], ['account', 'My account', 'user']],
  admin: [['overview', 'Overview', 'chart'], ['terminal', 'Cashier terminal', 'pay'], ['students', 'Student accounts', 'search'], ['transactions', 'Transactions', 'list'], ['registrations', 'Registrations', 'inbox'], ['users', 'Users & staff', 'user'], ['setup', 'Billing setup', 'cog'], ['audit', 'Audit log', 'log'], ['account', 'My account', 'user']]
};
const TITLES = { terminal: 'Cashier terminal', dashboard: 'Dashboard', overview: 'Overview', pay: 'Pay a bill', history: 'Payments & receipts', account: 'My account', students: 'Student accounts', transactions: 'Transactions', registrations: 'Registrations', users: 'Users & staff', setup: 'Billing setup', audit: 'Audit log' };

function showApp() {
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('whoName').textContent = me.full_name;
  $('whoRole').textContent = cap(me.role) + (me.student_or_emp_id ? ' · ' + me.student_or_emp_id : '');
  go(NAV[me.role][0][0]);
  refreshBadges();
}

function renderNav() {
  $('nav').innerHTML = NAV[me.role].map(([id, label, icon]) => {
    const n = (id === 'dashboard' || id === 'overview') ? S.badges.pay : id === 'registrations' ? S.badges.reg : 0;
    return `<button class="${S.view === id ? 'on' : ''}" onclick="go('${id}')"><svg viewBox="0 0 24 24">${ICON[icon]}</svg><span>${label}</span>${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
}

async function refreshBadges() {
  if (!me || me.role === 'student') return;
  try {
    const s = await api('/api/staff/stats');
    S.badges = { pay: s.pending_payments, reg: s.pending_registrations };
    renderNav();
  } catch (e) {}
}

function go(view) {
  S.view = view;
  renderNav();
  $('pageTitle').textContent = TITLES[view];
  toggleSide(false);
  $('view').innerHTML = '<div class="skeleton"></div>';
  window.scrollTo(0, 0);
  Promise.resolve(VIEWS[view]()).catch((e) => {
    $('view').innerHTML = `<div class="panel"><div class="panel-body empty">${esc(e.message)}</div></div>`;
  });
}
const refresh = () => go(S.view);
const setView = (html) => { $('view').innerHTML = html; };

// ---------- shared table pieces ----------
const dueCell = (b) => (b.due_period ? `${esc(PERIODS[b.due_period])}<small>${fmtDate(b.due_date)}</small>` : fmtDate(b.due_date));
const billStatus = (b) => chip(b.status) + (isOverdue(b) ? ' ' + chip('overdue') : '');

function paymentRows(list, { staffActions = false, admin = false } = {}) {
  if (!list.length) return `<tr><td colspan="6" class="empty">No payments yet.</td></tr>`;
  return list.map((p) => `<tr>
    <td>${fmtDT(p.payment_date)}${p.status === 'confirmed' ? `<small>${orNo(p.payment_id)}</small>` : ''}</td>
    <td>${esc(p.bill_title)}</td>
    <td>${esc(methodLabel(p.payment_method))}${p.reference_no ? `<small>Ref. ${esc(p.reference_no)}</small>` : ''}</td>
    <td class="num right">${peso(p.amount_paid)}</td>
    <td>${chip(p.status)}</td>
    <td class="right"><div class="row-actions" style="justify-content:flex-end">
      ${p.status === 'confirmed' ? `<button class="btn sm" onclick="showReceipt(${p.payment_id})">Receipt</button>` : ''}
      ${staffActions && p.status === 'pending' ? `<button class="btn sm primary" onclick="confirmPending(${p.payment_id})">Confirm</button><button class="btn sm danger" onclick="rejectPending(${p.payment_id})">Reject</button>` : ''}
      ${admin && p.status === 'confirmed' ? `<button class="btn sm danger" onclick="openVoid(${p.payment_id})">Void</button>` : ''}
    </div></td></tr>`).join('');
}
const paymentHead = `<thead><tr><th>Date</th><th>Item</th><th>Method</th><th class="right">Amount</th><th>Status</th><th></th></tr></thead>`;

// =====================================================
// RECEIPTS & STATEMENTS
// =====================================================
async function showReceipt(id) {
  try { showReceiptObj((await api(`/api/payments/${id}/receipt`)).receipt); }
  catch (e) { toast(e.message, 'error'); }
}

function receiptHTML(r) {
  return `<div class="receipt">
    <div class="r-head"><div><h2>Torres Capitol College</h2><small>Business Office · Official Receipt</small></div>
      <div class="r-no"><small>Receipt no.</small><strong>${esc(r.or_no)}</strong></div></div>
    <dl>
      <dt>Date</dt><dd>${esc(fmtDT(r.date))}</dd>
      <dt>Received from</dt><dd>${esc(r.student_name)}</dd>
      <dt>Student ID</dt><dd>${esc(r.student_no || '—')}</dd>
      <dt>Item</dt><dd>${esc(r.bill_title)}${r.category ? ` <small>(${esc(r.category)})</small>` : ''}</dd>
      <dt>Payment method</dt><dd>${esc(methodLabel(r.method))}</dd>
      ${r.reference_no ? `<dt>Reference no.</dt><dd>${esc(r.reference_no)}</dd>` : ''}
      <dt>Received by</dt><dd>${esc(r.received_by || 'Business Office')}</dd>
    </dl>
    <div class="r-total"><span>Amount paid</span><strong>${peso(r.amount)}</strong></div>
    <p class="r-foot">Remaining on this item: ${peso(r.bill_balance)}. Keep this receipt for your records.</p></div>`;
}

function showReceiptObj(r) {
  S.receipt = r;
  openModal({
    title: 'Official receipt', wide: true, body: receiptHTML(r),
    foot: `<button class="btn" onclick="closeModal()">Close</button><button class="btn" onclick="printReceipt()">Print</button><button class="btn primary" onclick="downloadReceiptPDF()">Download PDF</button>`
  });
}
function printHTML(html) { $('printArea').innerHTML = html; window.print(); }
const printReceipt = () => printHTML(receiptHTML(S.receipt));

function downloadReceiptPDF() {
  const r = S.receipt;
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!r) return;
  if (!J) { toast('The PDF tool did not load. Use Print and choose “Save as PDF”.', 'error'); return; }
  const d = new J({ unit: 'mm', format: 'a5' });
  const W = 148;
  const money = (n) => 'PHP ' + num(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  d.setFillColor(14, 34, 56); d.rect(0, 0, W, 30, 'F');
  d.setTextColor(255, 255, 255); d.setFont('times', 'bold'); d.setFontSize(17); d.text('Torres Capitol College', 12, 13);
  d.setFont('helvetica', 'normal'); d.setFontSize(9); d.text('Business Office  |  Official Receipt', 12, 20);
  d.setFillColor(184, 134, 43); d.rect(0, 30, W, 1.6, 'F');
  d.setTextColor(100, 112, 129); d.setFontSize(8.5); d.text('Receipt no.', W - 12, 41, { align: 'right' });
  d.setTextColor(14, 34, 56); d.setFont('times', 'bold'); d.setFontSize(15); d.text(r.or_no, W - 12, 48, { align: 'right' });
  const rows = [['Date', fmtDT(r.date)], ['Received from', r.student_name], ['Student ID', r.student_no || '-'], ['Item', r.bill_title],
    ['Category', r.category || '-'], ['Payment method', methodLabel(r.method)], ['Reference no.', r.reference_no || '-'], ['Received by', r.received_by || 'Business Office']];
  let y = 62;
  rows.forEach(([k, v]) => {
    d.setFont('helvetica', 'normal'); d.setTextColor(100, 112, 129); d.setFontSize(9); d.text(k, 12, y);
    d.setTextColor(26, 37, 51); d.setFontSize(10);
    const lines = d.splitTextToSize(String(v), 70);
    d.text(lines, 58, y);
    y += Math.max(7, lines.length * 5 + 2);
  });
  d.setDrawColor(14, 34, 56); d.setLineWidth(0.6); d.line(12, y + 2, W - 12, y + 2);
  d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(100, 112, 129); d.text('Amount paid', 12, y + 11);
  d.setFont('times', 'bold'); d.setFontSize(18); d.setTextColor(14, 34, 56); d.text(money(r.amount), W - 12, y + 12, { align: 'right' });
  d.setFont('helvetica', 'normal'); d.setFontSize(9); d.setTextColor(100, 112, 129);
  d.text('Remaining on this item: ' + money(r.bill_balance), 12, y + 21);
  d.setFontSize(8); d.text('Generated electronically by the TCC billing system. Keep this receipt for your records.', W / 2, 200, { align: 'center' });
  d.save(`${r.or_no}.pdf`);
}

function printSOA(d) {
  d = d || S.sum;
  const st = d.student;
  const rows = d.bills.map((b) => `<tr><td>${esc(b.title)}</td><td>${b.due_period ? esc(PERIODS[b.due_period]) + ' · ' : ''}${fmtDate(b.due_date)}</td>
    <td class="right">${peso(b.amount)}</td><td class="right">${peso(b.paid)}</td><td class="right">${peso(num(b.amount) - num(b.paid))}</td></tr>`).join('');
  printHTML(`<div class="receipt soa"><div class="r-head"><div><h2>Statement of Account</h2><small>Torres Capitol College · Business Office</small></div>
    <div class="r-no"><small>As of</small><strong>${fmtDate(todayStr())}</strong></div></div>
    <dl><dt>Student</dt><dd>${esc(st.full_name)}</dd><dt>Student ID</dt><dd>${esc(st.student_or_emp_id)}</dd></dl>
    <table><thead><tr><th>Item</th><th>Due</th><th class="right">Billed</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No bills.</td></tr>'}</tbody></table>
    <div class="r-total"><span>Total outstanding balance</span><strong>${peso(d.current_balance)}</strong></div></div>`);
}

// =====================================================
// VIEWS
// =====================================================
const VIEWS = {};

// ---------- student ----------
VIEWS.dashboard = async function () {
  if (me.role !== 'student') return staffDashboard(false);
  const d = (S.sum = await api(`/api/student/${me.user_id}/summary`));
  const billed = d.bills.reduce((s, b) => s + num(b.amount), 0);
  const paid = d.bills.reduce((s, b) => s + num(b.paid), 0);
  const pend = d.payments.filter((p) => p.status === 'pending').reduce((s, p) => s + num(p.amount_paid), 0);
  const next = d.bills.filter((b) => b.status !== 'paid' && b.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const pct = billed ? Math.min(100, (paid / billed) * 100) : 0;
  const open = d.bills.some((b) => b.status !== 'paid');

  setView(`
    <section class="statement">
      <div>
        <div class="label">Outstanding balance</div>
        <div class="amount ${d.current_balance <= 0.01 ? 'clear' : ''}">${peso(d.current_balance)}</div>
        <div class="bar" title="${pct.toFixed(0)}% paid"><i style="width:${pct}%"></i></div>
        <p class="muted" style="margin:.5rem 0 1.1rem">${peso(paid)} paid of ${peso(billed)} billed</p>
        <div class="row-actions">
          ${open ? `<button class="btn primary" onclick="go('pay')">Pay a bill</button>` : ''}
          <button class="btn" onclick="printSOA()">Print statement</button>
        </div>
      </div>
      <div><dl>
        <div><dt>Next due</dt><dd>${next ? `${esc(next.title)}<br><small>${next.due_period ? PERIODS[next.due_period] + ' · ' : ''}${fmtDate(next.due_date)}</small>` : 'Nothing due'}</dd></div>
        <div><dt>Awaiting verification</dt><dd>${pend ? peso(pend) : 'None'}</dd></div>
        <div><dt>Student</dt><dd>${esc(d.student.full_name)}<br><small>${esc(d.student.student_or_emp_id)}</small></dd></div>
      </dl></div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h3>Billed fees & fines</h3><p>Fees are due at the exam period shown.</p></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Due</th><th class="right">Amount</th><th class="right">Paid</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.bills.length ? d.bills.map((b) => `<tr>
          <td>${esc(b.title)}${b.category ? `<small>${esc(b.category)}</small>` : ''}</td><td>${dueCell(b)}</td>
          <td class="num right">${peso(b.amount)}</td><td class="num right">${peso(b.paid)}</td><td>${billStatus(b)}</td>
          <td class="right">${b.status !== 'paid' ? `<button class="btn sm" onclick="S.preBill=${b.bill_id};go('pay')">Pay</button>` : ''}</td></tr>`).join('')
          : `<tr><td colspan="6" class="empty">No bills yet. Fees will appear here once the Business Office issues them.</td></tr>`}</tbody>
      </table></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h3>Recent payments</h3><button class="link-btn" onclick="go('history')">View all</button></div>
      <div class="table-wrap"><table>${paymentHead}<tbody>${paymentRows(d.payments.slice(0, 5))}</tbody></table></div>
    </section>`);
};

VIEWS.pay = async function () {
  const d = (S.sum = await api(`/api/student/${me.user_id}/summary`));
  const open = d.bills.filter((b) => num(b.amount) - num(b.paid) > 0.01);
  const pending = d.payments.filter((p) => p.status === 'pending');
  const pre = open.find((b) => b.bill_id === S.preBill) || (open.length === 1 ? open[0] : null);
  S.preBill = null;

  setView(`<div class="split">
    <section class="panel"><div class="panel-head"><div><h3>Submit a payment</h3><p>Pay first, then enter your reference number here.</p></div></div>
      <div class="panel-body">${open.length ? `
        <form onsubmit="submitForm(event, doPay)">
          <label class="field"><span>Bill to pay</span>
            <select name="bill_id" onchange="fillPayAmount(this)" required>
              <option value="">Choose a bill</option>
              ${open.map((b) => `<option value="${b.bill_id}" data-rem="${(num(b.amount) - num(b.paid)).toFixed(2)}" ${pre && pre.bill_id === b.bill_id ? 'selected' : ''}>${esc(b.title)} — balance ${peso(num(b.amount) - num(b.paid))}</option>`).join('')}
            </select></label>
          <div class="grid2">
            <label class="field"><span>Amount (₱)</span><input name="amount_paid" id="payAmount" type="number" step="0.01" min="0.01" value="${pre ? (num(pre.amount) - num(pre.paid)).toFixed(2) : ''}" required />
              <small>You can pay part of a bill.</small></label>
            <label class="field"><span>Paid through</span><select name="payment_method"><option>GCash</option><option>Bank Transfer</option><option>Business Office</option></select></label>
          </div>
          <label class="field"><span>Reference number</span><input name="reference_no" placeholder="From your GCash or bank receipt" />
            <small>Not needed if you paid at the Business Office.</small></label>
          <button class="btn primary" type="submit">Submit payment</button>
        </form>` : `<p class="empty" style="padding:1rem 0">You have no unpaid bills.</p>`}
      </div></section>
    <div>
      <section class="panel"><div class="panel-head"><h3>How it works</h3></div><div class="panel-body">
        <ol class="steps"><li>Pay using one of the channels below.</li><li>Enter the amount and reference number here.</li><li>A cashier verifies your payment.</li><li>Your official receipt is emailed and appears under Payments & receipts.</li></ol></div></section>
      <section class="panel"><div class="panel-head"><h3>Where to pay</h3></div><ul class="mini-list">
        <li><span>GCash</span><span>${esc(PAY_INFO.gcash)}</span></li><li><span>Bank</span><span>${esc(PAY_INFO.bank)}</span></li><li><span>In person</span><span>${esc(PAY_INFO.counter)}</span></li></ul></section>
    </div></div>
    ${pending.length ? `<section class="panel"><div class="panel-head"><h3>Awaiting verification</h3></div><div class="table-wrap"><table>${paymentHead}<tbody>${paymentRows(pending)}</tbody></table></div></section>` : ''}`);
};

function fillPayAmount(sel) {
  const o = sel.options[sel.selectedIndex];
  $('payAmount').value = o && o.dataset.rem ? o.dataset.rem : '';
}
async function doPay(fd, form) {
  const sel = form.querySelector('select[name=bill_id]');
  const rem = num(sel.options[sel.selectedIndex].dataset.rem);
  if (num(fd.get('amount_paid')) > rem + 0.01) throw new Error(`The amount is more than the remaining balance of ${peso(rem)}.`);
  const r = await post('/api/student/payments', {
    bill_id: fd.get('bill_id'), amount_paid: fd.get('amount_paid'), payment_method: fd.get('payment_method'), reference_no: fd.get('reference_no')
  });
  toast(r.message);
  go('pay');
}

VIEWS.history = async function () {
  const d = (S.sum = await api(`/api/student/${me.user_id}/summary`));
  setView(`<section class="panel"><div class="panel-head"><div><h3>Payment history</h3><p>Receipts are available once a cashier confirms your payment.</p></div></div>
    <div class="table-wrap"><table>${paymentHead}<tbody>${paymentRows(d.payments)}</tbody></table></div></section>`);
};

// ---------- account (all roles) ----------
VIEWS.account = async function () {
  setView(`<div class="split">
    <section class="panel"><div class="panel-head"><h3>Profile</h3></div><div class="panel-body" style="display:grid;gap:.9rem">
      <div><small>Name</small><div style="font-weight:500">${esc(me.full_name)}</div></div>
      <div><small>${me.role === 'student' ? 'Student ID' : 'Employee ID'}</small><div style="font-weight:500">${esc(me.student_or_emp_id || '—')}</div></div>
      <div><small>Email</small><div style="font-weight:500">${esc(me.email || '—')}</div></div>
      <div><small>Role</small><div style="font-weight:500">${cap(me.role)}</div></div></div></section>
    <section class="panel"><div class="panel-head"><h3>Change password</h3></div><div class="panel-body">
      <form onsubmit="submitForm(event, doChangePw)">
        <label class="field"><span>Current password</span><input name="current_password" type="password" autocomplete="current-password" required /></label>
        <label class="field"><span>New password</span><input name="new_password" type="password" minlength="6" autocomplete="new-password" required /><small>At least 6 characters.</small></label>
        <button class="btn primary" type="submit">Update password</button>
      </form></div></section></div>`);
};
async function doChangePw(fd, form) {
  const r = await post('/api/auth/change-password', { current_password: fd.get('current_password'), new_password: fd.get('new_password') });
  toast(r.message);
  form.reset();
}

// ---------- staff dashboard / admin overview ----------
VIEWS.overview = () => staffDashboard(true);

async function staffDashboard(admin) {
  const [s, p, ov] = await Promise.all([
    api('/api/staff/stats'),
    api('/api/cashier/pending-payments'),
    admin ? api('/api/admin/overview') : Promise.resolve(null)
  ]);
  S.badges = { pay: s.pending_payments, reg: s.pending_registrations };
  renderNav();

  let extra = '';
  if (ov) {
    const max = Math.max(1, ...ov.series.map((x) => x.total));
    const rate = ov.collected_total + s.outstanding > 0 ? (ov.collected_total / (ov.collected_total + s.outstanding)) * 100 : 0;
    const studentsActive = ov.users.filter((u) => u.role === 'student' && u.status === 'approved').reduce((a, u) => a + u.n, 0);
    extra = `
      <div class="kpis">
        <div class="kpi ok"><span>Collected, all time</span><strong>${peso(ov.collected_total)}</strong></div>
        <div class="kpi"><span>Collection rate</span><strong>${rate.toFixed(0)}%</strong><small class="muted">of everything billed</small></div>
        <div class="kpi"><span>Active students</span><strong>${studentsActive}</strong></div>
        <div class="kpi"><span>Staff accounts</span><strong>${ov.users.filter((u) => u.role !== 'student' && u.status === 'approved').reduce((a, u) => a + u.n, 0)}</strong></div>
      </div>
      <div class="split-wrap split">
        <section class="panel"><div class="panel-head"><div><h3>Collections, last 14 days</h3><p>Confirmed payments per day</p></div></div>
          <div class="panel-body"><div class="chart">${ov.series.map((x) => `<div class="col" title="${fmtDate(x.day)}: ${peso(x.total)}"><i style="height:${(x.total / max) * 100}%"></i><span>${x.day.slice(8)}</span></div>`).join('')}</div></div></section>
        <section class="panel"><div class="panel-head"><h3>Largest balances</h3></div>
          ${ov.debtors.length ? `<ul class="mini-list">${ov.debtors.map((x) => `<li><span>${esc(x.full_name)}<br><small>${esc(x.student_or_emp_id)}</small></span><strong class="num text-bad">${peso(x.owed)}</strong></li>`).join('')}</ul>` : `<p class="empty">No outstanding balances.</p>`}</section>
      </div>
      <div class="split-wrap split" style="grid-template-columns:1fr 1fr">
        <section class="panel"><div class="panel-head"><h3>By payment method</h3></div>
          ${ov.methods.length ? `<ul class="mini-list">${ov.methods.map((m) => `<li><span>${esc(methodLabel(m.method))} <small>${m.n} payment${m.n === 1 ? '' : 's'}</small></span><strong class="num">${peso(m.total)}</strong></li>`).join('')}</ul>` : `<p class="empty">No payments yet.</p>`}</section>
        <section class="panel"><div class="panel-head"><h3>By fee type</h3></div>
          ${ov.categories.length ? `<ul class="mini-list">${ov.categories.map((m) => `<li><span>${esc(m.category)}</span><strong class="num">${peso(m.total)}</strong></li>`).join('')}</ul>` : `<p class="empty">No payments yet.</p>`}</section>
      </div>`;
  }

  setView(`
    <div class="kpis">
      <div class="kpi ok"><span>Collected today</span><strong>${peso(s.collected_today)}</strong><small class="muted">${s.transactions_today} transaction${s.transactions_today === 1 ? '' : 's'}</small></div>
      <div class="kpi bad"><span>Outstanding balance</span><strong>${peso(s.outstanding)}</strong><small class="muted">${s.overdue_bills} overdue bill${s.overdue_bills === 1 ? '' : 's'}</small></div>
      <div class="kpi"><span>Awaiting verification</span><strong>${s.pending_payments}</strong><small class="muted">student payments</small></div>
      <div class="kpi"><span>New registrations</span><strong>${s.pending_registrations}</strong><small class="muted">to approve</small></div>
    </div>
    ${extra}
    <section class="panel"><div class="panel-head"><div><h3>Payments awaiting verification</h3><p>Check the reference number against the GCash or bank record, then confirm.</p></div>
      <button class="btn sm" onclick="refresh()">Refresh</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Student</th><th>Item</th><th>Method</th><th class="right">Amount</th><th>Submitted</th><th></th></tr></thead>
        <tbody>${p.payments.length ? p.payments.map((x) => `<tr>
          <td>${esc(x.full_name)}<small>${esc(x.student_or_emp_id)}</small></td><td>${esc(x.title)}</td>
          <td>${esc(methodLabel(x.payment_method))}<small>${x.reference_no ? 'Ref. ' + esc(x.reference_no) : 'No reference'}</small></td>
          <td class="num right">${peso(x.amount_paid)}</td><td>${fmtDT(x.payment_date)}</td>
          <td class="right"><div class="row-actions" style="justify-content:flex-end"><button class="btn sm primary" onclick="confirmPending(${x.payment_id})">Confirm</button><button class="btn sm danger" onclick="rejectPending(${x.payment_id})">Reject</button></div></td></tr>`).join('')
          : `<tr><td colspan="6" class="empty">Nothing waiting. New student payments will show up here.</td></tr>`}</tbody>
      </table></div></section>`);
}

async function confirmPending(id) {
  if (!(await ask('Confirm payment', 'Confirm this payment and email the receipt to the student?', 'Confirm payment'))) return;
  try {
    const r = await post(`/api/cashier/payments/${id}/confirm`);
    toast(r.message);
    showReceiptObj(r.receipt);
    afterPaymentChange();
  } catch (e) { toast(e.message, 'error'); }
}
async function rejectPending(id) {
  if (!(await ask('Reject payment', 'Reject this payment? The student will see it as rejected.', 'Reject', true))) return;
  try { toast((await post(`/api/cashier/payments/${id}/reject`)).message); afterPaymentChange(); }
  catch (e) { toast(e.message, 'error'); }
}
function afterPaymentChange() {
  refreshBadges();
  if (S.view === 'terminal') { if (S.acct) loadTermStudent(S.acct); termKpis(); }
  else if (S.view === 'students' && S.acct) loadAccount(S.acct);
  else if (S.view === 'transactions') loadTransactions();
  else if (S.view === 'dashboard' || S.view === 'overview') refresh();
}

// ---------- cashier terminal: issue a bill + process payment on one screen ----------
const termTimers = {};
const termPicker = (w) => `<label class="field"><span>Student</span>
  <div class="ta"><input id="tin${w}" placeholder="Search Student ID or name, press Enter to pick" autocomplete="off"
    oninput="termSearch('${w}', this.value)" onfocus="this.select();termSearch('${w}', '')" onkeydown="termKey(event, '${w}')" />
  <div id="tl${w}" class="ta-list hidden"></div></div></label>`;

VIEWS.terminal = async function () {
  const [s, m, regs] = await Promise.all([api('/api/staff/stats'), api('/api/meta'), api('/api/staff/registrations')]);
  S.meta = m;
  S.badges = { pay: s.pending_payments, reg: s.pending_registrations };
  renderNav();
  const t = m.term;
  const review = me.role === 'admin' ? 'overview' : 'dashboard';

  setView(`
    <div class="kpis">
      <div class="kpi ok"><span>Collected today</span><strong id="tkToday">${peso(s.collected_today)}</strong><small class="muted" id="tkCount">${s.transactions_today} transaction${s.transactions_today === 1 ? '' : 's'}</small></div>
      <div class="kpi bad"><span>Total outstanding balance</span><strong id="tkOut">${peso(s.outstanding)}</strong><small class="muted" id="tkOver">${s.overdue_bills} overdue bill${s.overdue_bills === 1 ? '' : 's'}</small></div>
      <div class="kpi click" onclick="go('${review}')" title="Review student-submitted payments"><span>Awaiting verification</span><strong id="tkPend">${s.pending_payments}</strong><small class="muted">student payments · review</small></div>
      <div class="kpi click" onclick="$('termRegs').scrollIntoView({ behavior: 'smooth' })"><span>New registrations</span><strong id="tkReg">${s.pending_registrations}</strong><small class="muted">to approve</small></div>
    </div>

    <div class="term-split">
      <section class="panel">
        <div class="panel-head"><div><h3>Issue a bill</h3><p>Charge a fee or violation to a student's account.</p></div></div>
        <div class="panel-body">
          ${termPicker('Issue')}
          <p class="who-line muted" id="tbWho"></p>
          <form id="tbForm" onsubmit="submitForm(event, doTermIssue)">
            <label class="field"><span>Fee type</span><select name="fee_type_id" onchange="termFeePick(this)" required>
              <option value="">Select a standard fee type</option>
              ${m.fee_types.map((f) => `<option value="${f.fee_type_id}" data-amt="${f.default_amount ?? ''}" data-name="${esc(f.name)}">${esc(f.name)}${f.description ? ' — ' + esc(f.description) : ''}</option>`).join('')}
            </select></label>
            <label class="field"><span>Bill title / description</span><input name="title" id="tbTitle" placeholder="e.g. Late library return, Laboratory fee" required /></label>
            <div class="grid2">
              <label class="field"><span>Amount (₱)</span><input name="amount" id="tbAmount" type="number" step="0.01" min="0.01" placeholder="0.00" required /></label>
              <label class="field"><span>Due at</span><select name="due_period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === 'finals' ? 'selected' : ''}>${v}${t ? ' — ' + fmtDate(t[k]) : ''}</option>`).join('')}</select></label>
            </div>
            <p class="muted" style="margin-top:-.4rem;font-size:.85rem">${t ? esc(t.label) : 'No active semester is set, so this bill will have no due date.'}</p>
            <button class="btn primary block" type="submit">Issue bill to account</button>
          </form>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h3>Process payment</h3><p>Take money at the counter.</p></div>
          <button class="btn sm" onclick="exportCSV()">Export payments (CSV)</button></div>
        <div class="panel-body recent">
          ${termPicker('Pay')}
          <div id="tpBox"><p class="muted">Pick a student to see their unpaid bills and take a payment.</p></div>
        </div>
      </section>
    </div>

    <section class="panel" id="termRegs">
      <div class="panel-head"><div><h3>Pending account registrations</h3><p>Verify the student is enrolled before approving.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Year</th><th>Registered</th><th></th></tr></thead>
      <tbody>${regs.users.length ? regs.users.map((u) => `<tr><td>${esc(u.student_or_emp_id)}</td><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${u.year_level || '—'}</td><td>${fmtDT(u.created_at)}</td>
        <td class="right"><div class="row-actions" style="justify-content:flex-end"><button class="btn sm primary" onclick="setReg(${u.user_id},'approved')">Approve</button><button class="btn sm danger" onclick="setReg(${u.user_id},'rejected')">Reject</button></div></td></tr>`).join('')
        : `<tr><td colspan="6" class="empty">No pending student registrations.</td></tr>`}</tbody></table></div>
    </section>`);
  if (S.acct) loadTermStudent(S.acct);
};

function termSearch(w, q) {
  clearTimeout(termTimers[w]);
  termTimers[w] = setTimeout(async () => {
    const list = $('tl' + w);
    if (!list) return;
    try {
      const r = await api(`/api/staff/students?q=${encodeURIComponent(q.trim())}`);
      list.innerHTML = r.students.length
        ? r.students.map((s) => `<button type="button" class="ta-item" onclick="termPick(${s.user_id})"><span>${esc(s.full_name)}<br><small>${esc(s.student_or_emp_id)}</small></span>
            <span class="num ${num(s.balance) > 0.01 ? 'text-bad' : 'text-ok'}">${num(s.balance) > 0.01 ? peso(s.balance) : 'Settled'}</span></button>`).join('')
        : `<div class="empty" style="padding:1rem">No approved student matches “${esc(q)}”.</div>`;
      list.classList.remove('hidden');
    } catch (e) { toast(e.message, 'error'); }
  }, 220);
}
async function termKey(e, w) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  clearTimeout(termTimers[w]);
  try {
    const r = await api(`/api/staff/students?q=${encodeURIComponent(e.target.value.trim())}`);
    if (r.students.length) termPick(r.students[0].user_id);
    else toast('No approved student matches that search.', 'error');
  } catch (err) { toast(err.message, 'error'); }
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.ta-list').forEach((l) => { if (!l.parentElement.contains(e.target)) l.classList.add('hidden'); });
});

// Picking a student in either panel updates both.
function termPick(id) {
  document.querySelectorAll('.ta-list').forEach((l) => l.classList.add('hidden'));
  S.acct = id;
  loadTermStudent(id);
}

async function loadTermStudent(id) {
  const box = $('tpBox');
  if (!box) return;
  box.innerHTML = '<div class="skeleton" style="height:140px"></div>';
  try {
    const d = (S.acctData = await api(`/api/staff/students/${id}/account`));
    const label = `${d.student.full_name} (${d.student.student_or_emp_id})`;
    ['Issue', 'Pay'].forEach((w) => { if ($('tin' + w)) $('tin' + w).value = label; });
    $('tbWho').textContent = `${d.student.year_level ? 'Year ' + d.student.year_level + ' · ' : ''}Current balance ${peso(d.current_balance)}`;
    box.innerHTML = termPayHTML(d);
  } catch (e) { box.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

function termPayHTML(d) {
  const open = d.bills.filter((b) => num(b.amount) - num(b.paid) > 0.01);
  const pending = d.payments.filter((p) => p.status === 'pending');
  const first = open[0];
  const rem0 = first ? num(first.amount) - num(first.paid) : 0;
  const admin = me.role === 'admin';
  const recent = d.payments.slice(0, 6);
  return `
    <div class="owe-banner ${d.current_balance > 0.01 ? '' : 'clear'}"><span>${d.current_balance > 0.01 ? 'Total outstanding' : 'Nothing owed'}</span><strong>${peso(d.current_balance)}</strong></div>
    ${pending.length ? `<div class="note">${pending.length} payment${pending.length === 1 ? '' : 's'} submitted by this student ${pending.length === 1 ? 'is' : 'are'} waiting for your check. See Recent payments below.</div>` : ''}
    ${open.length ? `<form onsubmit="submitForm(event, doTermPay)">
      <label class="field"><span>Fee / item to pay</span><select name="bill_id" id="tpBill" onchange="termBillPick(this)" required>
        ${open.map((b) => { const r = num(b.amount) - num(b.paid); return `<option value="${b.bill_id}" data-rem="${r.toFixed(2)}">${esc(b.title)} — remaining ${peso(r)}${isOverdue(b) ? ' (overdue)' : ''}</option>`; }).join('')}
      </select></label>
      <div class="grid2">
        <label class="field"><span>Amount paying (₱)</span><input name="amount_paid" id="tpAmount" type="number" step="0.01" min="0.01" max="${rem0.toFixed(2)}" value="${rem0.toFixed(2)}" oninput="termChange()" required /></label>
        <label class="field"><span>Payment method</span><select name="payment_method" id="tpMethod" onchange="termMethodChange()"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank transfer</option></select></label>
      </div>
      <label class="field" id="tpCashRow"><span>Cash received (₱) <small>(optional, to work out change)</small></span><input id="tpCash" type="number" step="0.01" min="0" oninput="termChange()" /></label>
      <p class="change-line" id="tpChange"></p>
      <label class="field hidden" id="tpRefRow"><span>Reference number <small>(optional)</small></span><input name="reference_no" placeholder="From the GCash or bank receipt" /></label>
      <button class="btn primary block" type="submit">Confirm payment &amp; print receipt</button>
    </form>` : `<p class="text-ok" style="font-weight:600">No unpaid bills for this student.</p>`}
    <h4>Recent payments</h4>
    ${recent.length ? `<ul class="mini-list">${recent.map((p) => `<li>
      <span>${p.status === 'confirmed' ? `<strong>${orNo(p.payment_id)}</strong> · ` : ''}${peso(p.amount_paid)} · ${esc(methodLabel(p.payment_method))}<br><small>${esc(p.bill_title)} · ${fmtDT(p.payment_date)}</small></span>
      <span class="row-actions" style="flex-wrap:nowrap;align-items:center">${chip(p.status)}
        ${p.status === 'confirmed' ? `<button class="btn sm" onclick="showReceipt(${p.payment_id})">Receipt</button>` : ''}
        ${p.status === 'pending' ? `<button class="btn sm primary" onclick="confirmPending(${p.payment_id})">Confirm</button><button class="btn sm danger" onclick="rejectPending(${p.payment_id})">Reject</button>` : ''}
        ${admin && p.status === 'confirmed' ? `<button class="btn sm danger" onclick="openVoid(${p.payment_id})">Void</button>` : ''}</span></li>`).join('')}</ul>`
      : `<p class="muted">No payments yet.</p>`}`;
}

function termBillPick(sel) {
  const o = sel.options[sel.selectedIndex];
  if (!o) return;
  $('tpAmount').value = o.dataset.rem;
  $('tpAmount').max = o.dataset.rem;
  termChange();
}
function termMethodChange() {
  const cash = $('tpMethod').value === 'cash';
  $('tpCashRow').classList.toggle('hidden', !cash);
  $('tpRefRow').classList.toggle('hidden', cash);
  termChange();
}
function termChange() {
  const out = $('tpChange');
  if (!out) return;
  const due = num($('tpAmount').value);
  const got = $('tpMethod').value === 'cash' ? num($('tpCash').value) : 0;
  out.className = 'change-line' + (got ? (got >= due ? ' ok' : ' short') : '');
  out.textContent = got ? (got >= due ? `Change to give: ${peso(got - due)}` : `Short by ${peso(due - got)}`) : '';
}
function termFeePick(sel) {
  const o = sel.options[sel.selectedIndex];
  if (!o || !o.value) return;
  const names = Array.from(sel.options).map((x) => x.dataset.name).filter(Boolean);
  if (!$('tbTitle').value || names.includes($('tbTitle').value)) $('tbTitle').value = o.dataset.name;
  if (o.dataset.amt) $('tbAmount').value = o.dataset.amt;
}

async function doTermPay(fd) {
  const sel = $('tpBill');
  const rem = num(sel.options[sel.selectedIndex].dataset.rem);
  const amt = num(fd.get('amount_paid'));
  if (amt > rem + 0.01) throw new Error(`The amount is more than the remaining balance of ${peso(rem)}.`);
  if (fd.get('payment_method') === 'cash' && num($('tpCash').value) && num($('tpCash').value) < amt) throw new Error('The cash received is less than the amount being paid.');
  const r = await post('/api/payments', { bill_id: fd.get('bill_id'), amount_paid: fd.get('amount_paid'), payment_method: fd.get('payment_method'), reference_no: fd.get('reference_no') });
  toast(r.message);
  showReceiptObj(r.receipt);
  loadTermStudent(S.acct);
  termKpis();
}

async function doTermIssue(fd, form) {
  if (!S.acct) throw new Error('Pick a student first.');
  const who = S.acctData ? S.acctData.student.full_name : 'this student';
  if (!(await ask('Issue bill', `Bill ${peso(fd.get('amount'))} for "${fd.get('title')}" to ${who}?`, 'Issue bill'))) return;
  const r = await post('/api/staff/bills', { user_id: S.acct, fee_type_id: fd.get('fee_type_id'), title: fd.get('title'), amount: fd.get('amount'), due_period: fd.get('due_period') });
  toast(r.message);
  form.reset();
  loadTermStudent(S.acct);
  termKpis();
}

async function termKpis() {
  try {
    const s = await api('/api/staff/stats');
    S.badges = { pay: s.pending_payments, reg: s.pending_registrations };
    renderNav();
    const set = (id, v) => { if ($(id)) $(id).textContent = v; };
    set('tkToday', peso(s.collected_today));
    set('tkCount', `${s.transactions_today} transaction${s.transactions_today === 1 ? '' : 's'}`);
    set('tkOut', peso(s.outstanding));
    set('tkOver', `${s.overdue_bills} overdue bill${s.overdue_bills === 1 ? '' : 's'}`);
    set('tkPend', s.pending_payments);
    set('tkReg', s.pending_registrations);
  } catch (e) {}
}

// ---------- student accounts (cashier counter) ----------
VIEWS.students = function () {
  setView(`<section class="panel"><div class="panel-body">
    <label class="field" style="margin:0"><span>Find a student</span>
      <div class="ta"><input id="taInput" placeholder="Type a name or Student ID" autocomplete="off" oninput="taSearch(this.value)" onfocus="taSearch(this.value)" />
      <div id="taList" class="ta-list hidden"></div></div></label></div></section><div id="acctBox"></div>`);
  if (S.acct) loadAccount(S.acct);
  else $('acctBox').innerHTML = `<p class="muted">Search for a student to see their bills and payments, collect a payment, or issue a bill.</p>`;
};

let taTimer = null;
function taSearch(q) {
  clearTimeout(taTimer);
  taTimer = setTimeout(async () => {
    const list = $('taList');
    if (!list) return;
    try {
      const r = await api(`/api/staff/students?q=${encodeURIComponent(q.trim())}`);
      list.innerHTML = r.students.length
        ? r.students.map((s) => `<button class="ta-item" onclick="pickStudent(${s.user_id})"><span>${esc(s.full_name)}<br><small>${esc(s.student_or_emp_id)}</small></span>
            <span class="num ${num(s.balance) > 0.01 ? 'text-bad' : 'text-ok'}">${num(s.balance) > 0.01 ? peso(s.balance) : 'Settled'}</span></button>`).join('')
        : `<div class="empty" style="padding:1rem">No approved student matches “${esc(q)}”.</div>`;
      list.classList.remove('hidden');
    } catch (e) { toast(e.message, 'error'); }
  }, 220);
}
document.addEventListener('click', (e) => { const l = $('taList'); if (l && !e.target.closest('.ta')) l.classList.add('hidden'); });

function pickStudent(id) {
  $('taList').classList.add('hidden');
  S.acct = id;
  loadAccount(id);
}

async function loadAccount(id) {
  const box = $('acctBox');
  if (!box) return;
  box.innerHTML = '<div class="skeleton"></div>';
  try {
    const d = (S.acctData = await api(`/api/staff/students/${id}/account`));
    if ($('taInput')) $('taInput').value = `${d.student.full_name} (${d.student.student_or_emp_id})`;
    const admin = me.role === 'admin';
    box.innerHTML = `
      <section class="panel"><div class="panel-body acct-head">
        <div><h2>${esc(d.student.full_name)}</h2><p class="muted" style="margin:.2rem 0 .8rem">${esc(d.student.student_or_emp_id)} · ${esc(d.student.email)}${d.student.year_level ? ` · Year ${d.student.year_level}` : ''}</p>
          <div class="row-actions"><button class="btn primary" onclick="openIssueBill()">Issue a bill</button><button class="btn" onclick="printSOA(S.acctData)">Print statement</button></div></div>
        <div class="acct-bal"><span class="muted">Outstanding balance</span><strong class="${d.current_balance > 0.01 ? '' : 'text-ok'}">${peso(d.current_balance)}</strong></div>
      </div></section>
      <section class="panel"><div class="panel-head"><h3>Bills</h3></div><div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Due</th><th class="right">Amount</th><th class="right">Paid</th><th class="right">Balance</th><th>Status</th><th></th></tr></thead>
        <tbody>${d.bills.length ? d.bills.map((b) => { const rem = num(b.amount) - num(b.paid); return `<tr>
          <td>${esc(b.title)}${b.category ? `<small>${esc(b.category)}</small>` : ''}</td><td>${dueCell(b)}</td>
          <td class="num right">${peso(b.amount)}</td><td class="num right">${peso(b.paid)}</td><td class="num right">${peso(rem)}</td><td>${billStatus(b)}</td>
          <td class="right"><div class="row-actions" style="justify-content:flex-end">
            ${rem > 0.01 ? `<button class="btn sm primary" onclick="openCollect(${b.bill_id})">Collect</button>` : ''}
            ${admin && num(b.paid) === 0 ? `<button class="btn sm danger" onclick="cancelBill(${b.bill_id})">Cancel</button>` : ''}</div></td></tr>`; }).join('')
          : `<tr><td colspan="7" class="empty">No bills for this student.</td></tr>`}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h3>Payment history</h3></div><div class="table-wrap"><table>${paymentHead}
        <tbody>${paymentRows(d.payments, { staffActions: true, admin })}</tbody></table></div></section>`;
  } catch (e) { box.innerHTML = `<div class="panel"><div class="panel-body empty">${esc(e.message)}</div></div>`; }
}

function openCollect(billId) {
  const b = S.acctData.bills.find((x) => x.bill_id === billId);
  const rem = num(b.amount) - num(b.paid);
  openModal({
    title: 'Collect payment',
    body: `<p><strong>${esc(b.title)}</strong><br><span class="muted">Balance ${peso(rem)} · ${esc(S.acctData.student.full_name)}</span></p>
      <form onsubmit="submitForm(event, doCollect)"><input type="hidden" name="bill_id" value="${b.bill_id}" /><input type="hidden" name="rem" value="${rem.toFixed(2)}" />
        <label class="field"><span>Amount received (₱)</span><input name="amount_paid" type="number" step="0.01" min="0.01" max="${rem.toFixed(2)}" value="${rem.toFixed(2)}" required /></label>
        <label class="field"><span>Payment mode</span><select name="payment_method"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank transfer</option></select></label>
        <label class="field"><span>Reference number <small>(optional)</small></span><input name="reference_no" /></label>
        ${formFoot('Record payment')}</form>`
  });
}
async function doCollect(fd) {
  if (num(fd.get('amount_paid')) > num(fd.get('rem')) + 0.01) throw new Error(`The amount is more than the balance of ${peso(fd.get('rem'))}.`);
  const r = await post('/api/payments', { bill_id: fd.get('bill_id'), amount_paid: fd.get('amount_paid'), payment_method: fd.get('payment_method'), reference_no: fd.get('reference_no') });
  toast(r.message);
  showReceiptObj(r.receipt);
  loadAccount(S.acct);
  refreshBadges();
}

async function openIssueBill() {
  S.meta = (await api('/api/meta'));
  const t = S.meta.term;
  openModal({
    title: 'Issue a bill',
    body: `<p class="muted" style="margin-bottom:1rem">For ${esc(S.acctData.student.full_name)}</p>
      <form onsubmit="submitForm(event, doIssueBill)"><input type="hidden" name="user_id" value="${S.acct}" />
        <label class="field"><span>Fee type</span><select name="fee_type_id" onchange="feePick(this)" required>
          <option value="">Choose a fee type</option>${S.meta.fee_types.map((f) => `<option value="${f.fee_type_id}" data-amt="${f.default_amount ?? ''}" data-name="${esc(f.name)}">${esc(f.name)}${f.description ? ' — ' + esc(f.description) : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Description</span><input name="title" id="ibTitle" placeholder="e.g. Late library return" required /></label>
        <label class="field"><span>Amount (₱)</span><input name="amount" id="ibAmount" type="number" step="0.01" min="0.01" required /></label>
        <label class="field"><span>Due at</span><select name="due_period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === 'finals' ? 'selected' : ''}>${v}${t ? ' — ' + fmtDate(t[k]) : ''}</option>`).join('')}</select>
          <small>${t ? esc(t.label) : 'No active semester is set, so this bill will have no due date.'}</small></label>
        ${formFoot('Issue bill')}</form>`
  });
}
function feePick(sel) {
  const o = sel.options[sel.selectedIndex];
  if (!o || !o.value) return;
  if (!$('ibTitle').value) $('ibTitle').value = o.dataset.name;
  if (o.dataset.amt) $('ibAmount').value = o.dataset.amt;
}
async function doIssueBill(fd) {
  const r = await post('/api/staff/bills', Object.fromEntries(fd));
  closeModal();
  toast(r.message);
  loadAccount(S.acct);
}

async function cancelBill(id) {
  if (!(await ask('Cancel bill', 'Cancel this bill? It will no longer count toward the student’s balance.', 'Cancel bill', true))) return;
  try { toast((await post(`/api/admin/bills/${id}/cancel`)).message); loadAccount(S.acct); }
  catch (e) { toast(e.message, 'error'); }
}
function openVoid(id) {
  openModal({
    title: 'Void payment',
    body: `<p class="muted">This reverses the payment and puts the amount back on the student’s balance. The action is recorded in the audit log.</p>
      <form onsubmit="submitForm(event, doVoid)"><input type="hidden" name="id" value="${id}" />
        <label class="field"><span>Reason</span><input name="reason" placeholder="e.g. Wrong amount entered" required /></label>${formFoot('Void payment')}</form>`
  });
}
async function doVoid(fd) {
  const r = await post(`/api/admin/payments/${fd.get('id')}/void`, { reason: fd.get('reason') });
  closeModal();
  toast(r.message);
  afterPaymentChange();
}

// ---------- transactions ----------
VIEWS.transactions = function () {
  setView(`<section class="panel">
    <form class="filters" onsubmit="event.preventDefault();loadTransactions()">
      <label class="field"><span>From</span><input type="date" id="fFrom" /></label>
      <label class="field"><span>To</span><input type="date" id="fTo" /></label>
      <label class="field"><span>Status</span><select id="fStatus"><option value="">All</option><option value="confirmed">Confirmed</option><option value="pending">Awaiting verification</option><option value="rejected">Rejected</option><option value="voided">Voided</option></select></label>
      <label class="field" style="flex:2"><span>Search</span><input id="fQ" placeholder="Student name, ID or reference no." /></label>
      <button class="btn primary" type="submit">Apply</button><button class="btn" type="button" onclick="exportCSV()">Export CSV</button>
    </form><div id="txnBody"></div></section>`);
  loadTransactions();
};
const fv = (id) => ($(id) ? $(id).value : '');
const txnQuery = () => new URLSearchParams({ from: fv('fFrom'), to: fv('fTo'), status: fv('fStatus'), q: fv('fQ') }).toString();

async function loadTransactions() {
  const box = $('txnBody');
  if (!box) return;
  try {
    const r = await api('/api/staff/payments?' + txnQuery());
    const admin = me.role === 'admin';
    box.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Student</th><th>Item</th><th>Method</th><th class="right">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.payments.length ? r.payments.map((p) => `<tr>
        <td>${fmtDT(p.payment_date)}${p.status === 'confirmed' ? `<small>${orNo(p.payment_id)}</small>` : ''}</td>
        <td>${esc(p.full_name)}<small>${esc(p.student_or_emp_id)}</small></td><td>${esc(p.title)}</td>
        <td>${esc(methodLabel(p.payment_method))}${p.reference_no ? `<small>Ref. ${esc(p.reference_no)}</small>` : ''}</td>
        <td class="num right">${peso(p.amount_paid)}</td><td>${chip(p.status)}</td>
        <td class="right"><div class="row-actions" style="justify-content:flex-end">
          ${p.status === 'confirmed' ? `<button class="btn sm" onclick="showReceipt(${p.payment_id})">Receipt</button>` : ''}
          ${p.status === 'pending' ? `<button class="btn sm primary" onclick="confirmPending(${p.payment_id})">Confirm</button><button class="btn sm danger" onclick="rejectPending(${p.payment_id})">Reject</button>` : ''}
          ${admin && p.status === 'confirmed' ? `<button class="btn sm danger" onclick="openVoid(${p.payment_id})">Void</button>` : ''}</div></td></tr>`).join('')
        : `<tr><td colspan="7" class="empty">No payments match these filters.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4">Confirmed total (${r.confirmed_count} payment${r.confirmed_count === 1 ? '' : 's'})</td><td class="num right">${peso(r.total)}</td><td colspan="2"></td></tr></tfoot></table></div>`;
  } catch (e) { box.innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
}

async function exportCSV() {
  try {
    const res = await fetch('/api/staff/payments.csv?' + txnQuery(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('The export failed. Try again.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `payments-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- registrations ----------
VIEWS.registrations = async function () {
  const r = await api('/api/staff/registrations');
  S.badges.reg = r.users.length; renderNav();
  setView(`<section class="panel"><div class="panel-head"><div><h3>Pending registrations</h3><p>Verify the student is enrolled before approving.</p></div><button class="btn sm" onclick="refresh()">Refresh</button></div>
    <div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Year</th><th>Registered</th><th></th></tr></thead>
    <tbody>${r.users.length ? r.users.map((u) => `<tr><td>${esc(u.student_or_emp_id)}</td><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${u.year_level || '—'}</td><td>${fmtDT(u.created_at)}</td>
      <td class="right"><div class="row-actions" style="justify-content:flex-end"><button class="btn sm primary" onclick="setReg(${u.user_id},'approved')">Approve</button><button class="btn sm danger" onclick="setReg(${u.user_id},'rejected')">Reject</button></div></td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No pending registrations.</td></tr>`}</tbody></table></div></section>`);
};
async function setReg(id, status) {
  if (status === 'rejected' && !(await ask('Reject registration', 'Reject this registration?', 'Reject', true))) return;
  try { toast((await post(`/api/staff/registrations/${id}`, { status })).message); refresh(); refreshBadges(); }
  catch (e) { toast(e.message, 'error'); }
}

// ---------- admin: users & staff ----------
const userChip = (s) => ({ approved: '<span class="chip ok">Active</span>', pending: '<span class="chip warn">Pending</span>', rejected: '<span class="chip mute">Deactivated</span>' }[s] || chip(s));

VIEWS.users = function () {
  setView(`<section class="panel">
    <div class="panel-head"><div><h3>Users & staff</h3><p>Create cashier or admin accounts, reset passwords, and deactivate accounts.</p></div><button class="btn primary" onclick="openStaffForm()">Add staff account</button></div>
    <form class="filters" onsubmit="event.preventDefault();loadUsers()">
      <label class="field"><span>Role</span><select id="uRole" onchange="loadUsers()"><option value="">Everyone</option><option value="student">Students</option><option value="cashier">Cashiers</option><option value="admin">Admins</option></select></label>
      <label class="field" style="flex:2"><span>Search</span><input id="uQ" placeholder="Name, ID or email" /></label>
      <button class="btn" type="submit">Search</button></form>
    <div id="usersBody"></div></section>`);
  loadUsers();
};
async function loadUsers() {
  const box = $('usersBody');
  if (!box) return;
  const r = await api('/api/admin/users?' + new URLSearchParams({ role: $('uRole').value, q: $('uQ').value }));
  S.users = r.users;
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
    <tbody>${r.users.length ? r.users.map((u) => `<tr><td>${esc(u.student_or_emp_id)}</td><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${cap(u.role)}</td><td>${userChip(u.status)}</td>
      <td class="right"><div class="row-actions" style="justify-content:flex-end">
        <button class="btn sm" onclick="openResetPw(${u.user_id})">Reset password</button>
        ${u.user_id !== me.user_id && u.status === 'approved' ? `<button class="btn sm danger" onclick="setUserStatus(${u.user_id},'rejected')">Deactivate</button>` : ''}
        ${u.user_id !== me.user_id && u.status === 'rejected' ? `<button class="btn sm" onclick="setUserStatus(${u.user_id},'approved')">Activate</button>` : ''}</div></td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No users found.</td></tr>`}</tbody></table></div>`;
}
function openStaffForm() {
  openModal({
    title: 'Add staff account',
    body: `<form onsubmit="submitForm(event, doStaff)">
      <label class="field"><span>Full name</span><input name="full_name" required /></label>
      <div class="grid2"><label class="field"><span>Employee ID</span><input name="emp_id" required /></label>
        <label class="field"><span>Role</span><select name="role"><option value="cashier">Cashier</option><option value="admin">Admin</option></select></label></div>
      <label class="field"><span>Email</span><input name="email" type="email" required /></label>
      <label class="field"><span>Temporary password</span><input name="password" type="text" minlength="6" required /><small>Ask them to change it after signing in.</small></label>
      ${formFoot('Create account')}</form>`
  });
}
async function doStaff(fd) { const r = await post('/api/admin/users', Object.fromEntries(fd)); closeModal(); toast(r.message); loadUsers(); }
function openResetPw(id) {
  const u = S.users.find((x) => x.user_id === id);
  openModal({
    title: 'Reset password',
    body: `<p class="muted">New password for <strong>${esc(u.full_name)}</strong></p><form onsubmit="submitForm(event, doResetPw)"><input type="hidden" name="id" value="${id}" />
      <label class="field"><input name="password" type="text" minlength="6" placeholder="At least 6 characters" required /></label>${formFoot('Reset password')}</form>`
  });
}
async function doResetPw(fd) { const r = await post(`/api/admin/users/${fd.get('id')}/password`, { password: fd.get('password') }); closeModal(); toast(r.message); }
async function setUserStatus(id, status) {
  const u = S.users.find((x) => x.user_id === id);
  if (status === 'rejected' && !(await ask('Deactivate account', `${u.full_name} will no longer be able to sign in.`, 'Deactivate', true))) return;
  try { toast((await post(`/api/admin/users/${id}/status`, { status })).message); loadUsers(); }
  catch (e) { toast(e.message, 'error'); }
}

// ---------- admin: billing setup ----------
VIEWS.setup = async function () {
  const [t, m] = await Promise.all([api('/api/terms'), api('/api/meta')]);
  S.terms = t.terms; S.meta = m;
  const active = t.terms.find((x) => x.is_active);
  setView(`
    <section class="panel"><div class="panel-head"><div><h3>Semester calendar</h3><p>Bills are due at an exam period, not on a typed-in date. Changing a date here moves the due date of every bill tied to that semester.</p></div>
      <button class="btn primary" onclick="openTermForm()">Add semester</button></div>
      <div class="table-wrap"><table><thead><tr><th>Semester</th><th>Prelims</th><th>Midterms</th><th>Pre-Finals</th><th>Finals</th><th></th></tr></thead>
      <tbody>${t.terms.length ? t.terms.map((x) => `<tr><td>${esc(x.label)} ${x.is_active ? '<span class="chip ok">Active</span>' : ''}</td>
        <td>${fmtDate(x.prelim)}</td><td>${fmtDate(x.midterm)}</td><td>${fmtDate(x.prefinal)}</td><td>${fmtDate(x.finals)}</td>
        <td class="right"><div class="row-actions" style="justify-content:flex-end"><button class="btn sm" onclick="openTermForm(${x.term_id})">Edit</button>
        ${x.is_active ? '' : `<button class="btn sm" onclick="activateTerm(${x.term_id})">Make active</button>`}</div></td></tr>`).join('')
        : `<tr><td colspan="6" class="empty">No semesters yet. Add one so new bills get a due date.</td></tr>`}</tbody></table></div></section>

    <section class="panel"><div class="panel-head"><div><h3>Fee types</h3><p>The default amount fills in automatically when a cashier issues a bill.</p></div><button class="btn primary" onclick="openFeeForm()">Add fee type</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th class="right">Default amount</th><th></th></tr></thead>
      <tbody>${m.fee_types.length ? m.fee_types.map((f) => `<tr><td>${esc(f.name)}${f.description ? `<small>${esc(f.description)}</small>` : ''}</td><td class="num right">${f.default_amount != null ? peso(f.default_amount) : '—'}</td>
        <td class="right"><div class="row-actions" style="justify-content:flex-end"><button class="btn sm" onclick="openFeeForm(${f.fee_type_id})">Edit</button><button class="btn sm danger" onclick="deleteFee(${f.fee_type_id})">Delete</button></div></td></tr>`).join('')
        : `<tr><td colspan="3" class="empty">No fee types yet.</td></tr>`}</tbody></table></div></section>

    <section class="panel"><div class="panel-head"><div><h3>Bill many students at once</h3><p>Use this for fees every student owes, like a lab or miscellaneous fee. Only approved students are billed.</p></div></div>
      <div class="panel-body"><form onsubmit="submitForm(event, doBulk)"><div class="form-grid">
        <label class="field"><span>Fee type</span><select name="fee_type_id" required><option value="">Choose a fee type</option>${m.fee_types.map((f) => `<option value="${f.fee_type_id}">${esc(f.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Description</span><input name="title" placeholder="e.g. Laboratory fee" required /></label>
        <label class="field"><span>Amount each (₱)</span><input name="amount" type="number" step="0.01" min="0.01" required /></label>
        <label class="field"><span>Due at</span><select name="due_period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === 'finals' ? 'selected' : ''}>${v}${active ? ' — ' + fmtDate(active[k]) : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Who</span><select name="year_level"><option value="all">All students</option><option value="1">1st year</option><option value="2">2nd year</option><option value="3">3rd year</option><option value="4">4th year</option></select></label>
      </div><button class="btn primary" type="submit">Bill students</button></form></div></section>`);
};

function openTermForm(id) {
  const t = id ? S.terms.find((x) => x.term_id === id) : { label: '', prelim: '', midterm: '', prefinal: '', finals: '' };
  openModal({
    title: id ? 'Edit semester' : 'Add semester',
    body: `<form onsubmit="submitForm(event, doTerm)"><input type="hidden" name="id" value="${id || ''}" />
      <label class="field"><span>Name</span><input name="label" value="${esc(t.label)}" placeholder="1st Semester, A.Y. 2026-2027" required /></label>
      <div class="grid2">
        <label class="field"><span>Prelims due</span><input type="date" name="prelim" value="${t.prelim}" required /></label>
        <label class="field"><span>Midterms due</span><input type="date" name="midterm" value="${t.midterm}" required /></label>
        <label class="field"><span>Pre-Finals due</span><input type="date" name="prefinal" value="${t.prefinal}" required /></label>
        <label class="field"><span>Finals due</span><input type="date" name="finals" value="${t.finals}" required /></label></div>
      ${id ? '' : `<label style="display:flex;gap:.5rem;align-items:center;margin-bottom:1rem"><input type="checkbox" name="activate" value="1" style="width:auto" checked /> Make this the active semester</label>`}
      ${formFoot(id ? 'Save changes' : 'Add semester')}</form>`
  });
}
async function doTerm(fd) {
  const body = { label: fd.get('label'), prelim: fd.get('prelim'), midterm: fd.get('midterm'), prefinal: fd.get('prefinal'), finals: fd.get('finals'), activate: fd.get('activate') === '1' };
  const id = fd.get('id');
  const r = id ? await api(`/api/admin/terms/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : await post('/api/admin/terms', body);
  closeModal(); toast(r.message); refresh();
}
async function activateTerm(id) {
  try { toast((await post(`/api/admin/terms/${id}/activate`)).message); refresh(); } catch (e) { toast(e.message, 'error'); }
}

function openFeeForm(id) {
  const f = id ? S.meta.fee_types.find((x) => x.fee_type_id === id) : { name: '', default_amount: '', description: '' };
  openModal({
    title: id ? 'Edit fee type' : 'Add fee type',
    body: `<form onsubmit="submitForm(event, doFee)"><input type="hidden" name="id" value="${id || ''}" />
      <label class="field"><span>Name</span><input name="name" value="${esc(f.name)}" placeholder="e.g. Laboratory" required /></label>
      <label class="field"><span>Description <small>(optional)</small></span><input name="description" value="${esc(f.description || '')}" placeholder="e.g. Lab and library usage" /></label>
      <label class="field"><span>Default amount (₱) <small>(optional)</small></span><input name="default_amount" type="number" step="0.01" min="0" value="${f.default_amount ?? ''}" /></label>
      ${formFoot('Save')}</form>`
  });
}
async function doFee(fd) {
  const body = { name: fd.get('name'), default_amount: fd.get('default_amount'), description: fd.get('description') };
  const id = fd.get('id');
  const r = id ? await api(`/api/admin/fee-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }) : await post('/api/admin/fee-types', body);
  closeModal(); toast(r.message); refresh();
}
async function deleteFee(id) {
  if (!(await ask('Delete fee type', 'Delete this fee type? This only works if no bill uses it.', 'Delete', true))) return;
  try { toast((await api(`/api/admin/fee-types/${id}`, { method: 'DELETE' })).message); refresh(); }
  catch (e) { toast(e.message, 'error'); }
}
async function doBulk(fd, form) {
  const who = form.querySelector('[name=year_level]').selectedOptions[0].text.toLowerCase();
  if (!(await ask('Bill students', `Bill ${peso(fd.get('amount'))} to ${who}? Each student gets their own bill.`, 'Bill students'))) return;
  const r = await post('/api/admin/bulk-bill', Object.fromEntries(fd));
  toast(r.message);
  form.reset();
}

// ---------- admin: audit log ----------
VIEWS.audit = async function () {
  const r = await api('/api/admin/audit');
  setView(`<section class="panel"><div class="panel-head"><div><h3>Audit log</h3><p>The last 200 actions by staff: payments, bills, accounts and settings.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
    <tbody>${r.logs.length ? r.logs.map((l) => `<tr><td>${fmtDT(l.created_at)}</td><td>${esc(l.actor || 'System')}</td><td><span class="chip mute">${esc(l.action)}</span></td><td>${esc(l.detail || '')}</td></tr>`).join('')
      : `<tr><td colspan="4" class="empty">Nothing recorded yet.</td></tr>`}</tbody></table></div></section>`);
};