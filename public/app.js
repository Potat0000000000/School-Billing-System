let authToken = localStorage.getItem('token') || '';

function switchRole(role) {
  document.querySelectorAll('.portal-section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.role-nav button').forEach(b => b.classList.remove('active-role'));

  if (role === 'student') {
    document.getElementById('roleStudent').classList.remove('hidden');
    document.getElementById('navStudent').classList.add('active-role');
  } else if (role === 'cashier') {
    document.getElementById('roleCashier').classList.remove('hidden');
    document.getElementById('navCashier').classList.add('active-role');
  } else if (role === 'admin') {
    document.getElementById('roleAdmin').classList.remove('hidden');
    document.getElementById('navAdmin').classList.add('active-role');
  }
}

async function searchStudentPortal() {
  const studentId = document.getElementById('studentSearchInput').value.trim();
  if (!studentId) return alert('Please enter a student user ID.');

  try {
    const res = await fetch(`/api/student/${studentId}/summary`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load student summary');

    document.getElementById('sId').innerText = studentId;
    document.getElementById('sName').innerText = 'Enrolled Student';
    document.getElementById('sCourse').innerText = 'BSIT - 2nd Year';
    document.getElementById('sBalance').innerText = `₱${Number(data.current_balance).toLocaleString()}`;

    // Populate Bills table & dropdown
    const billsBody = document.getElementById('sBillsTableBody');
    const billSelect = document.getElementById('spBillSelect');
    billsBody.innerHTML = '';
    billSelect.innerHTML = '<option value="">-- Choose Bill --</option>';

    data.bills.forEach(b => {
      billsBody.innerHTML += `<tr><td>${b.title}</td><td>₱${Number(b.amount).toLocaleString()}</td><td><span class="text-${b.status === 'paid' ? 'success' : 'danger'}">${b.status}</span></td></tr>`;
      if (b.status !== 'paid') {
        billSelect.innerHTML += `<option value="${b.bill_id}">${b.title} (₱${b.amount})</option>`;
      }
    });

    // Populate Payment History
    const historyTable = document.getElementById('studentHistoryTable');
    if (data.payments.length === 0) {
      historyTable.innerHTML = `<tr><th>Date</th><th>Method</th><th>Amount Paid</th></tr><tr><td colspan="3" style="text-align: center; color: #64748b;">No payment history found.</td></tr>`;
    } else {
      historyTable.innerHTML = `<tr><th>Date</th><th>Method</th><th>Amount Paid</th></tr>`;
      data.payments.forEach(p => {
        historyTable.innerHTML += `<tr><td>${new Date(p.payment_date).toLocaleString()}</td><td>${p.payment_method.toUpperCase()}</td><td>₱${Number(p.amount_paid).toLocaleString()}</td></tr>`;
      });
    }

    document.getElementById('studentDashboardContent').classList.remove('hidden');
  } catch (err) {
    alert(err.message);
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
      body: JSON.stringify({ bill_id, amount_paid, payment_method })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(data.message);
    showReceipt('OR-' + data.payment_id, amount_paid, payment_method);
    searchStudentPortal();
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
    showReceipt('OR-' + data.payment_id, amount_paid, payment_method);
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
  document.getElementById('rcptAmount').innerText = `₱${Number(amount).toLocaleString()}`;
  document.getElementById('rcptMethod').innerText = method.toUpperCase();
  document.getElementById('receiptModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('receiptModal').classList.add('hidden');
}

function printSOA() {
  window.print();
}