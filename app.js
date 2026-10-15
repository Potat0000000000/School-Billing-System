const SUPABASE_URL = 'https://nioslrneolhxabagfg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xbrggnfb6ib-tEtWPZT7Mw_TuBHtZCu';

let supabaseClient = null;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.log('Using local fallback mode');
}

// Fallback Mock Database (Guarantees your defense works even offline!)
let mockStudents = [
  { student_id: '2024-0001', full_name: 'Juan Dela Cruz', course: 'BSIT', year_level: '2nd Year', tuition_fee: 12000, misc_fee: 3500, total_paid: 5000 },
  { student_id: '2024-0002', full_name: 'Maria Santos', course: 'BSIT', year_level: '2nd Year', tuition_fee: 12000, misc_fee: 3500, total_paid: 15500 }
];

let transactionsList = [];
let currentStudent = null;

// DOM Elements
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const accountSection = document.getElementById('accountSection');
const paymentForm = document.getElementById('paymentForm');

// 1. Search Student (With Automatic Supabase + Fallback)
searchBtn.addEventListener('click', async () => {
  const query = searchInput.value.trim();
  if (!query) return alert('Please enter a Student ID');

  let data = null;

  // Try Supabase first if configured
  if (supabaseClient) {
    try {
      const res = await supabaseClient.from('students').select('*').eq('student_id', query).single();
      if (res.data) data = res.data;
    } catch (err) {
      console.log('Supabase fetch failed, checking local mock data');
    }
  }

  // Fallback to local array if Supabase didn't return data
  if (!data) {
    data = mockStudents.find(s => s.student_id === query);
  }

  if (!data) {
    alert('Student not found! Try searching: 2024-0001');
    accountSection.classList.add('hidden');
    return;
  }

  currentStudent = data;
  displayAccountDetails();
});

// 2. Display SOA Details
function displayAccountDetails() {
  const s = currentStudent;
  const totalAssessment = Number(s.tuition_fee) + Number(s.misc_fee);
  const balance = totalAssessment - Number(s.total_paid);

  document.getElementById('lblStudentId').innerText = s.student_id;
  document.getElementById('lblName').innerText = s.full_name;
  document.getElementById('lblCourse').innerText = `${s.course} - ${s.year_level}`;
  document.getElementById('lblTuition').innerText = `₱${Number(s.tuition_fee).toLocaleString()}`;
  document.getElementById('lblMisc').innerText = `₱${Number(s.misc_fee).toLocaleString()}`;
  document.getElementById('lblTotal').innerText = `₱${totalAssessment.toLocaleString()}`;
  document.getElementById('lblPaid').innerText = `₱${Number(s.total_paid).toLocaleString()}`;
  document.getElementById('lblBalance').innerText = `₱${balance.toLocaleString()}`;

  accountSection.classList.remove('hidden');
}

// 3. Process Payment
paymentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payAmount = parseFloat(document.getElementById('payAmount').value);
  const payMethod = document.getElementById('payMethod').value;

  if (payAmount <= 0) return alert('Enter a valid payment amount');

  const newTotalPaid = Number(currentStudent.total_paid) + payAmount;
  const generatedOR = 'OR-' + Math.floor(100000 + Math.random() * 900000);

  // Update local mock state immediately for instant UI feedback
  currentStudent.total_paid = newTotalPaid;

  // Try saving to Supabase in background
  if (supabaseClient) {
    supabaseClient.from('students').update({ total_paid: newTotalPaid }).eq('student_id', currentStudent.student_id).then();
    supabaseClient.from('transactions').insert([{ or_number: generatedOR, student_id: currentStudent.student_id, amount_paid: payAmount, payment_method: payMethod }]).then();
  }

  // Add to transaction table log
  transactionsList.unshift({ or_number: generatedOR, student_id: currentStudent.student_id, amount_paid: payAmount, payment_method: payMethod });
  updateTransactionTable();

  displayAccountDetails();
  showReceipt(generatedOR, payAmount, payMethod);
});

// 4. Update Transaction Table UI
function updateTransactionTable() {
  const table = document.getElementById('transactionTable');
  if (transactionsList.length === 0) return;

  let html = `<tr><th>OR Number</th><th>Student ID</th><th>Amount</th><th>Method</th></tr>`;
  transactionsList.forEach(t => {
    html += `<tr><td>${t.or_number}</td><td>${t.student_id}</td><td>₱${t.amount_paid.toLocaleString()}</td><td>${t.payment_method}</td></tr>`;
  });
  table.innerHTML = html;
}

// 5. Show Receipt Modal
function showReceipt(orNum, amount, method) {
  const totalAssessment = Number(currentStudent.tuition_fee) + Number(currentStudent.misc_fee);
  const remaining = totalAssessment - Number(currentStudent.total_paid);

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