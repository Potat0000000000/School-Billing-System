let authToken = localStorage.getItem('token') || '';
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

document.addEventListener('DOMContentLoaded', () => {
  if (authToken && currentUser) {
    showApp();
  } else {
    showAuth();
  }
});

function switchAuthTab(tab) {
  if (tab === 'login') {
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('tabLoginBtn').classList.add('active-tab');
    document.getElementById('tabRegisterBtn').classList.remove('active-tab');
  } else {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('tabLoginBtn').classList.remove('active-tab');
    document.getElementById('tabRegisterBtn').classList.add('active-tab');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('loginIdentifier').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(currentUser));

    showApp();
  } catch (err) {
    alert(err.message);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const student_id = document.getElementById('regStudentId').value.trim();
  const full_name = document.getElementById('regFullName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const year_level = document.getElementById('regYearLevel').value;
  const password = document.getElementById('regPassword').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id, full_name, email, year_level, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    alert(data.message);
    switchAuthTab('login');
    document.getElementById('registerForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  authToken = '';
  currentUser = null;
  document.getElementById('appContainer').classList.add('hidden');
  document.getElementById('authContainer').classList.remove('hidden');
}

function showAuth() {
  document.getElementById('authContainer').classList.remove('hidden');
  document.getElementById('appContainer').classList.add('hidden');
}

function showApp() {
  document.getElementById('authContainer').classList.add('hidden');
  document.getElementById('appContainer').classList.remove('hidden');
  document.getElementById('userInfoDisplay').innerText = `${currentUser.full_name} (${currentUser.role.toUpperCase()})`;

  const roleNav = document.getElementById('roleNav');
  roleNav.innerHTML = '';

  if (currentUser.role === 'student') {
    roleNav.innerHTML = `<button onclick="switchRole('student')" id="navStudent" class="active-role">👤 Student Portal</button>`;
    switchRole('student');
    loadStudentData(currentUser.user_id);
  } else if (currentUser.role === 'cashier') {
    roleNav.innerHTML = `<button onclick="switchRole('cashier')" id="navCashier" class="active-role">💵 Cashier Dashboard</button>`;
    switchRole('cashier');
  } else if (currentUser.role === 'admin') {
    roleNav.innerHTML = `
      <button onclick="switchRole('student')" id="navStudent" class="active-role">👤 Student Portal</button>
      <button onclick="switchRole('cashier')" id="navCashier">💵 Cashier</button>
      <button onclick="switchRole('admin')" id="navAdmin">⚙️ Admin Panel</button>
    `;
    switchRole('student');
    loadStudentData(currentUser.user_id);
  }
}

function switchRole(role) {
  document.querySelectorAll('.portal-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.role-nav button').forEach(b => b.classList.remove('active-role'));

  if (role === 'student') {
    document.getElementById('roleStudent').classList.remove('hidden');
    const navBtn = document.getElementById('navStudent');
    if (navBtn) navBtn.classList.add('active-role');
    if (currentUser) loadStudentData(currentUser.user_id);
  } else if (role === 'cashier') {
    document.getElementById('roleCashier').classList.remove('hidden');
    const navBtn = document.getElementById('navCashier');
    if (navBtn) navBtn.classList.add('active-role');
  } else if (role === 'admin') {
    document.getElementById('roleAdmin').classList.remove('hidden');
    const navBtn = document.getElementById('navAdmin');
    if (navBtn) navBtn.classList.add('active-role');
  }
}

async function loadStudentData(studentId) {
  try {
    const res = await fetch(`/api/student/${studentId}/summary`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load student data');

    document.getElementById('sId').innerText = currentUser.student_or_emp_id || studentId;
    document.getElementById('sName').innerText = currentUser.full_name;
    document.getElementById('sBalance').innerText = `₱${Number(data.current_balance).toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    const billsBody = document.getElementById('sBillsTableBody');
    const billSelect = document.getElementById('spBillSelect');
    billsBody.innerHTML = '';
    billSelect.innerHTML = '<option value="">-- Choose Unpaid Bill --</option>';

    data.bills.forEach(b => {
      billsBody.innerHTML += `<tr><td>${b.title}</td><td>₱${Number(b.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}</td><td><span class="text-${b.status === 'paid' ? 'success' : 'danger'}">${b.status}</span></td><td>${b.due_date ? new Date(b.due_date).toLocaleDateString() : 'N/A'}</td></tr>`;
      if (b.status !== 'paid') {
        billSelect.innerHTML += `<option value="${b.bill_id}">${b.title} (₱${b.amount})</option>`;
      }
    });

    const historyTable = document.getElementById('studentHistoryTable');
    if (data.payments.length === 0) {
      historyTable.innerHTML = `<tr><th>Date</th><th>Method</th><th>Amount Paid</th></tr><tr><td colspan="3" style="text-align: center; color: #64748b;">No payment history found.</td></tr>`;
    } else {
      historyTable.innerHTML = `<tr><th>Date</th><th>Method</th><th>Amount Paid</th></tr>`;
      data.payments.forEach(p => {
        historyTable.innerHTML += `<tr><td>${new Date(p.payment_date).toLocaleString()}</td><td>${p.payment_method.toUpperCase()}</td><td>₱${Number(p.amount_paid).toLocaleString(undefined, {minimumFractionDigits: 2})}</td></tr>`;
      });
    }
  } catch (err) {
    console.error(err);
  }
}

async function submitStudentPayment(e) {
  e.preventDefault();
  const bill_id = document.getElementById('spBillSelect').value;
  const amount_paid = document.getElementById('spAmount').value;
  const payment_method = document.getElementById('spChannel').value;

  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ bill_id, student_id: currentUser.user_id, amount_paid, payment_method })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    showReceipt('OR-' + data.payment_id.toString().padStart(5, '0'), amount_paid, payment_method);
    loadStudentData(currentUser.user_id);
    document.getElementById('studentPaymentForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

async function processCashierPayment(e) {
  e.preventDefault();
  const student_id = document.getElementById('cStudentId').value.trim();
  const bill_id = document.getElementById('cBillId').value.trim();
  const amount_paid = document.getElementById('cAmount').value;
  const payment_method = document.getElementById('cMethod').value;

  try {
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ student_id, bill_id, amount_paid, payment_method })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    showReceipt('OR-' + data.payment_id.toString().padStart(5, '0'), amount_paid, payment_method);
    document.getElementById('cashierForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

async function addNewBill(e) {
  e.preventDefault();
  const student_id = document.getElementById('abStudentId').value.trim();
  const title = document.getElementById('abTitle').value.trim();
  const amount = document.getElementById('abAmount').value;
  const due_date = document.getElementById('abDueDate').value;

  try {
    const res = await fetch('/api/cashier/add-bill', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ student_id, title, amount, due_date, fee_type_id: 1 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    document.getElementById('adminAddBillForm').reset();
  } catch (err) {
    alert(err.message);
  }
}

function showReceipt(orNum, amount, method) {
  document.getElementById('rcptOR').innerText = orNum;
  document.getElementById('rcptDate').innerText = new Date().toLocaleString();
  document.getElementById('rcptAmount').innerText = `₱${Number(amount).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
  document.getElementById('rcptMethod').innerText = method.toUpperCase();
  document.getElementById('receiptModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('receiptModal').classList.add('hidden');
}