let authToken = localStorage.getItem('token') || '';
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let studentBills = [];
let studentPayments = [];
let cashierBills = [];

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const orNo = (id) => 'OR-' + String(id).padStart(5, '0');

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {})
    }
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && authToken) {
    handleLogout();
    throw new Error(data.error || 'Session expired. Please log in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  if (authToken && currentUser) showApp();
  else showAuth();
});

// ---------- auth ----------
function switchAuthTab(tab) {
  const login = tab === 'login';
  $('loginForm').classList.toggle('hidden', !login);
  $('registerForm').classList.toggle('hidden', login);
  $('tabLoginBtn').classList.toggle('active-tab', login);
  $('tabRegisterBtn').classList.toggle('active-tab', !login);
}

async function handleLogin(e) {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: $('loginIdentifier').value.trim(), password: $('loginPassword').value })
    });
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(currentUser));
    $('loginForm').reset();
    showApp();
  } catch (err) {
    alert(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        student_id: $('regStudentId').value.trim(),
        full_name: $('regFullName').value.trim(),
        email: $('regEmail').value.trim(),
        year_level: $('regYearLevel').value,
        password: $('regPassword').value
      })
    });
    alert(data.message);
    $('registerForm').reset();
    switchAuthTab('login');
  } catch (err) {
    alert(err.message);
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  authToken = '';
  currentUser = null;
  showAuth();
}

function showAuth() {
  $('authContainer').classList.remove('hidden');
  $('appContainer').classList.add('hidden');
}

function showApp() {
  $('authContainer').classList.add('hidden');
  $('appContainer').classList.remove('hidden');
  $('userInfoDisplay').innerText = `${currentUser.full_name} (${currentUser.role.toUpperCase()})`;

  const nav = $('roleNav');
  if (currentUser.role === 'student') {
    nav.innerHTML = `<button onclick="switchRole('student')" id="navStudent">👤 Student Portal</button>`;
    switchRole('student');
  } else if (currentUser.role === 'cashier') {
    nav.innerHTML = `<button onclick="switchRole('cashier')" id="navCashier">💵 Cashier Dashboard</button>`;
    switchRole('cashier');
  } else if (currentUser.role === 'admin') {
    nav.innerHTML = `
      <button onclick="switchRole('admin')" id="navAdmin">⚙️ Admin Panel</button>
      <button onclick="switchRole('cashier')" id="navCashier">💵 Cashier</button>`;
    switchRole('admin');
  }
}

function switchRole(role) {
  document.querySelectorAll('.portal-section').forEach((s) => s.classList.add('hidden'));
  document.querySelectorAll('.role-nav button').forEach((b) => b.classList.remove('active-role'));

  if (role === 'student') {
    $('roleStudent').classList.remove('hidden');
    loadStudentData(currentUser.user_id);
  } else if (role === 'cashier') {
    $('roleCashier').classList.remove('hidden');
    loadPending();
  } else if (role === 'admin') {
    $('roleAdmin').classList.remove('hidden');
    loadAdminUsers();
  }
  const navBtn = $('nav' + role.charAt(0).toUpperCase() + role.slice(1));
  if (navBtn) navBtn.classList.add('active-role');
}

// ---------- student ----------
function statusLabel(s) {
  const map = {
    paid: ['Paid', 'text-success'],
    confirmed: ['Confirmed', 'text-success'],
    partially_paid: ['Partial', 'text-warning'],
    pending: ['Pending', 'text-warning'],
    unpaid: ['Unpaid', 'text-danger'],
    rejected: ['Rejected', 'text-danger']
  };
  const [label, cls] = map[s] || [s, ''];
  return `<span class="${cls}">${esc(label)}</span>`;
}

async function loadStudentData(studentId) {
  try {
    const data = await api(`/api/student/${studentId}/summary`);
    studentBills = data.bills;
    studentPayments = data.payments;

    $('sId').innerText = currentUser.student_or_emp_id || studentId;
    $('sName').innerText = currentUser.full_name;
    $('sBalance').innerText = peso(data.current_balance);

    $('sBillsTableBody').innerHTML = data.bills.length
      ? data.bills.map((b) => `<tr>
          <td>${esc(b.title)}</td><td>${peso(b.amount)}</td><td>${peso(b.paid)}</td>
          <td>${statusLabel(b.status)}</td>
          <td>${b.due_date ? new Date(b.due_date).toLocaleDateString('en-PH') : 'N/A'}</td></tr>`).join('')
      : `<tr><td colspan="5" class="empty">No bills yet.</td></tr>`;

    const sel = $('spBillSelect');
    sel.innerHTML = '<option value="">-- Choose Unpaid Bill --</option>';
    data.bills.filter((b) => b.status !== 'paid').forEach((b) => {
      const remaining = Number(b.amount) - Number(b.paid);
      sel.innerHTML += `<option value="${b.bill_id}">${esc(b.title)} (balance ${peso(remaining)})</option>`;
    });

    $('studentHistoryBody').innerHTML = data.payments.length
      ? data.payments.map((p) => `<tr>
          <td>${new Date(p.payment_date).toLocaleString('en-PH')}</td>
          <td>${esc(p.bill_title)}</td>
          <td>${esc(String(p.payment_method).toUpperCase())}</td>
          <td>${peso(p.amount_paid)}</td>
          <td>${statusLabel(p.status)}</td>
          <td class="no-print">${p.status === 'confirmed' ? `<button class="btn-small" onclick="viewReceipt(${p.payment_id})">Receipt</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No payment history found.</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

function fillStudentAmount() {
  const b = studentBills.find((x) => String(x.bill_id) === $('spBillSelect').value);
  $('spAmount').value = b ? (Number(b.amount) - Number(b.paid)).toFixed(2) : '';
}

async function submitStudentPayment(e) {
  e.preventDefault();
  try {
    const data = await api('/api/student/payments', {
      method: 'POST',
      body: JSON.stringify({
        bill_id: $('spBillSelect').value,
        amount_paid: $('spAmount').value,
        payment_method: $('spChannel').value,
        reference_no: $('spReference').value
      })
    });
    alert(data.message);
    $('studentPaymentForm').reset();
    loadStudentData(currentUser.user_id);
  } catch (err) {
    alert(err.message);
  }
}

function viewReceipt(paymentId) {
  const p = studentPayments.find((x) => x.payment_id === paymentId);
  if (!p) return;
  showReceipt({
    or_no: orNo(p.payment_id),
    date: p.payment_date,
    amount: p.amount_paid,
    method: p.payment_method,
    student_name: currentUser.full_name,
    bill_title: p.bill_title
  });
}

// ---------- cashier ----------
async function lookupStudent() {
  const no = $('cStudentNo').value.trim();
  try {
    const data = await api(`/api/cashier/lookup?student_no=${encodeURIComponent(no)}`);
    cashierBills = data.bills;
    $('cStudentName').innerHTML = `Student: <strong>${esc(data.student.full_name)}</strong> (${esc(data.student.student_or_emp_id)})`;
    const sel = $('cBillSelect');
    sel.innerHTML = data.bills.length
      ? '<option value="">-- Choose Bill --</option>' +
        data.bills.map((b) => `<option value="${b.bill_id}">${esc(b.title)} (balance ${peso(b.remaining)})</option>`).join('')
      : '<option value="">No unpaid bills</option>';
  } catch (err) {
    cashierBills = [];
    $('cStudentName').innerText = '';
    $('cBillSelect').innerHTML = '<option value="">-- Find a student first --</option>';
    alert(err.message);
  }
}

function fillCashierAmount() {
  const b = cashierBills.find((x) => String(x.bill_id) === $('cBillSelect').value);
  $('cAmount').value = b ? Number(b.remaining).toFixed(2) : '';
}

async function processCashierPayment(e) {
  e.preventDefault();
  try {
    const data = await api('/api/payments', {
      method: 'POST',
      body: JSON.stringify({
        bill_id: $('cBillSelect').value,
        amount_paid: $('cAmount').value,
        payment_method: $('cMethod').value
      })
    });
    alert(data.message);
    showReceipt(data.receipt);
    $('cashierForm').reset();
    $('cStudentName').innerText = '';
    $('cBillSelect').innerHTML = '<option value="">-- Find a student first --</option>';
    cashierBills = [];
  } catch (err) {
    alert(err.message);
  }
}

async function loadPending() {
  try {
    const data = await api('/api/cashier/pending-payments');
    $('pendingBody').innerHTML = data.payments.length
      ? data.payments.map((p) => `<tr>
          <td>${esc(p.full_name)}<br><small>${esc(p.student_or_emp_id)}</small></td>
          <td>${esc(p.title)}</td>
          <td>${esc(String(p.payment_method).toUpperCase())}</td>
          <td>${esc(p.reference_no || '-')}</td>
          <td>${peso(p.amount_paid)}</td>
          <td class="actions">
            <button class="btn-small btn-print" onclick="confirmPending(${p.payment_id})">Confirm</button>
            <button class="btn-small btn-close" onclick="rejectPending(${p.payment_id})">Reject</button>
          </td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">No pending payments.</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

async function confirmPending(id) {
  if (!confirm('Confirm this payment and send the receipt?')) return;
  try {
    const data = await api(`/api/cashier/payments/${id}/confirm`, { method: 'POST' });
    showReceipt(data.receipt);
    loadPending();
  } catch (err) {
    alert(err.message);
  }
}

async function rejectPending(id) {
  if (!confirm('Reject this payment?')) return;
  try {
    await api(`/api/cashier/payments/${id}/reject`, { method: 'POST' });
    loadPending();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- admin ----------
async function loadAdminUsers() {
  try {
    const data = await api('/api/admin/users?status=pending');
    $('pendingUsersBody').innerHTML = data.users.length
      ? data.users.map((u) => `<tr>
          <td>${esc(u.student_or_emp_id)}</td><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td>
          <td class="actions">
            <button class="btn-small btn-print" onclick="setUserStatus(${u.user_id}, 'approved')">Approve</button>
            <button class="btn-small btn-close" onclick="setUserStatus(${u.user_id}, 'rejected')">Reject</button>
          </td></tr>`).join('')
      : `<tr><td colspan="4" class="empty">No pending registrations.</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

async function setUserStatus(id, status) {
  try {
    await api(`/api/admin/users/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    loadAdminUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function addNewBill(e) {
  e.preventDefault();
  try {
    const data = await api('/api/cashier/add-bill', {
      method: 'POST',
      body: JSON.stringify({
        student_id: $('abStudentId').value.trim(),
        title: $('abTitle').value.trim(),
        amount: $('abAmount').value,
        due_date: $('abDueDate').value
      })
    });
    alert(data.message);
    $('adminAddBillForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

// ---------- receipt ----------
function showReceipt(r) {
  $('rcptOR').innerText = r.or_no;
  $('rcptDate').innerText = new Date(r.date).toLocaleString('en-PH');
  $('rcptName').innerText = r.student_name || '';
  $('rcptBill').innerText = r.bill_title || '';
  $('rcptAmount').innerText = peso(r.amount);
  $('rcptMethod').innerText = String(r.method).toUpperCase();
  $('receiptModal').classList.remove('hidden');
}

function closeModal() {
  $('receiptModal').classList.add('hidden');
}