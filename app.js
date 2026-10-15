// Local Database State (Mock + Supabase Ready)
let students = [
  { student_id: '2024-0001', full_name: 'Juan Dela Cruz', course: 'BSIT', year_level: '2nd Year', tuition_fee: 12000, misc_fee: 3500, total_paid: 5000 },
  { student_id: '2024-0002', full_name: 'Maria Santos', course: 'BSIT', year_level: '2nd Year', tuition_fee: 12000, misc_fee: 3500, total_paid: 15500 }
];

let transactions = [
  { or_number: 'OR-892341', student_id: '2024-0001', method: 'Cash (BO Counter)', amount_paid: 5000, timestamp: '10/15/2026, 10:30 AM' }
];

let currentStudent = null;

// --- Role Switcher ---
function switchRole(role) {
  document.querySelectorAll('.portal-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.role-nav button').forEach(b => b.classList.remove('active-role'));

  if (role === 'student') {
    document.getElementById('roleStudent').classList.remove('hidden');
    document.getElementById('navStudent').classList.add('active-role');
  } else if (role === 'cashier') {
    document.getElementById('roleCashier').classList.remove('hidden');
    document.getElementById('navCashier').classList.add('active-role');
    updateCashierTable();
  } else if (role === 'admin') {
    document.getElementById('roleAdmin').classList.remove('hidden');
    document.getElementById('navAdmin').classList.add('active-role');
    updateAdminTable();
  }
}

// --- 1. Student Portal Functions ---
function searchStudentPortal() {
  const query = document.getElementById('studentSearchInput').value.trim();
  const found = students.find(s => s.student_id === query);

  if (!found) {
    alert('Student ID not found. Try searching: 2024-0001 or 2024-0002');
    document.getElementById('studentDashboardContent').classList.add('hidden');
    return;
  }

  currentStudent = found;
  renderStudentDashboard();
  document.getElementById('studentDashboardContent').classList.remove('hidden');
}

function renderStudentDashboard() {
  const s = currentStudent;
  const totalAssessment = s.tuition_fee + s.misc_fee;
  const balance = totalAssessment - s.total_paid;

  document.getElementById('sId').innerText = s.student_id;
  document.getElementById('sName').innerText = s.full_name;
  document.getElementById('sCourse').innerText = `${s.course} - ${s.year_level}`;
  document.getElementById('sTuition').innerText = `₱${s.tuition_fee.toLocaleString()}`;
  document.getElementById('sMisc').innerText = `₱${s.misc_fee.toLocaleString()}`;
  document.getElementById('sTotal').innerText = `₱${totalAssessment.toLocaleString()}`;
  document.getElementById('sPaid').innerText = `₱${s.total_paid.toLocaleString()}`;
  document.getElementById('sBalance').innerText = `₱${balance.toLocaleString()}`;

  // Render History
  const studentTx = transactions.filter(t => t.student_id === s.student_id);
  const table = document.getElementById('studentHistoryTable');
  if (studentTx.length === 0) {
    table.innerHTML = `<tr><th>Date</th><th>OR / Ref No.</th><th>Channel</th><th>Amount Paid</th></tr><tr><td colspan="4" style="text-align: center; color: #64748b;">No payment history found.</td></tr>`;
  } else {
    let html = `<tr><th>Date</th><th>OR / Ref No.</th><th>Channel</th><th>Amount Paid</th></tr>`;
    studentTx.forEach(t => {
      html += `<tr><td>${t.timestamp}</td><td>${t.or_number}</td><td>${t.method}</td><td>₱${t.amount_paid.toLocaleString()}</td></tr>`;
    });
    table.innerHTML = html;
  }
}

function submitStudentPayment(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('spAmount').value);
  const channel = document.getElementById('spChannel').value;
  const refNo = document.getElementById('spRef').value;

  if (amount <= 0) return alert('Enter a valid amount');

  currentStudent.total_paid += amount;
  const orNum = 'REF-' + Math.floor(100000 + Math.random() * 900000);
  const timestamp = new Date().toLocaleString();

  transactions.unshift({ or_number: `${orNum} (${channel}: ${refNo})`, student_id: currentStudent.student_id, method: channel, amount_paid: amount, timestamp });

  renderStudentDashboard();
  showReceipt(orNum, amount, `${channel} - Ref: ${refNo}`);
  document.getElementById('studentPaymentForm').reset();
  alert('Payment reference submitted successfully!');
}

function printSOA() {
  window.print();
}

// --- 2. Cashier Dashboard Functions ---
function processCashierPayment(e) {
  e.preventDefault();
  const studentId = document.getElementById('cStudentId').value.trim();
  const amount = parseFloat(document.getElementById('cAmount').value);
  const method = document.getElementById('cMethod').value;

  const targetStudent = students.find(s => s.student_id === studentId);
  if (!targetStudent) return alert('Student ID not registered in the system!');

  targetStudent.total_paid += amount;
  const orNum = 'OR-' + Math.floor(100000 + Math.random() * 900000);
  const timestamp = new Date().toLocaleString();

  transactions.unshift({ or_number: orNum, student_id: studentId, method, amount_paid: amount, timestamp });

  currentStudent = targetStudent;
  showReceipt(orNum, amount, method);
  document.getElementById('cashierForm').reset();
  updateCashierTable();
}

function updateCashierTable() {
  const table = document.getElementById('cashierTransactionsTable');
  if (transactions.length === 0) return;

  let html = `<tr><th>OR / Ref No.</th><th>Student ID</th><th>Method</th><th>Amount</th><th>Timestamp</th></tr>`;
  transactions.forEach(t => {
    html += `<tr><td>${t.or_number}</td><td>${t.student_id}</td><td>${t.method}</td><td>₱${t.amount_paid.toLocaleString()}</td><td>${t.timestamp}</td></tr>`;
  });
  table.innerHTML = html;
}

// --- 3. Admin Panel Functions ---
function addNewStudent(e) {
  e.preventDefault();
  const student_id = document.getElementById('aId').value.trim();
  const full_name = document.getElementById('aName').value.trim();
  const course = document.getElementById('aCourse').Value || 'BSIT';
  const year_level = document.getElementById('aYear').value.trim();
  const tuition_fee = parseFloat(document.getElementById('aTuition').value);
  const misc_fee = parseFloat(document.getElementById('aMisc').value);

  if (students.some(s => s.student_id === student_id)) {
    return alert('Student ID already exists!');
  }

  students.push({ student_id, full_name, course, year_level, tuition_fee, misc_fee, total_paid: 0 });
  alert(`Student ${full_name} registered successfully with billing assessment!`);
  document.getElementById('adminAddStudentForm').reset();
  updateAdminTable();
}

function updateAdminTable() {
  const table = document.getElementById('adminStudentTable');
  let html = `<tr><th>Student ID</th><th>Name</th><th>Course</th><th>Total Assessment</th><th>Total Paid</th><th>Balance</th></tr>`;
  students.forEach(s => {
    const total = s.tuition_fee + s.misc_fee;
    const balance = total - s.total_paid;
    html += `<tr><td>${s.student_id}</td><td>${s.full_name}</td><td>${s.course}</td><td>₱${total.toLocaleString()}</td><td>₱${s.total_paid.toLocaleString()}</td><td>₱${balance.toLocaleString()}</td></tr>`;
  });
  table.innerHTML = html;
}

// --- Receipt Modal ---
function showReceipt(orNum, amount, method) {
  const totalAssessment = currentStudent.tuition_fee + currentStudent.misc_fee;
  const remaining = totalAssessment - currentStudent.total_paid;

  document.getElementById('rcptOR').innerText = orNum;
  document.getElementById('rcptDate').innerText = new Date().toLocaleString();
  document.getElementById('rcptName').innerText = currentStudent.full_name;
  document.getElementById('rcptId').innerText = currentStudent.student_id;
  document.getElementById('rcptAmount').innerText = `₱${amount.toLocaleString()}`;
  document.getElementById('rcptMethod').innerText = method;
  document.getElementById('rcptBalance').innerText = `₱${remaining.toLocaleString()}`;

  document.getElementById('receiptModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('receiptModal').classList.add('hidden');
}