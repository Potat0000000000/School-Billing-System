// Replace with your Supabase Credentials
const SUPABASE_URL = 'https://nioslrneolhxabagfg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xbrggnfb6ib-tEtWPZT7Mw_TuBHtZCu';

// FIX: Access createClient from the global supabase object loaded via CDN
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentStudent = null;

// DOM Elements
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const accountSection = document.getElementById('accountSection');
const paymentForm = document.getElementById('paymentForm');

// 1. Search Student
searchBtn.addEventListener('click', async () => {
  const query = searchInput.value.trim();
  if (!query) return alert('Please enter a Student ID');

  const { data, error } = await supabaseClient
    .from('students')
    .select('*')
    .eq('student_id', query)
    .single();

  if (error || !data) {
    console.error('Database Error:', error);
    alert('Student not found! Check console for details.');
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

  // Update Student Paid Balance
  const { error: updateErr } = await supabaseClient
    .from('students')
    .update({ total_paid: newTotalPaid })
    .eq('student_id', currentStudent.student_id);

  if (updateErr) return alert('Failed to update payment record.');

  // Log Transaction
  await supabaseClient.from('transactions').insert([{
    or_number: generatedOR,
    student_id: currentStudent.student_id,
    amount_paid: payAmount,
    payment_method: payMethod
  }]);

  // Update Local State & UI
  currentStudent.total_paid = newTotalPaid;
  displayAccountDetails();
  
  // Show Receipt Modal
  showReceipt(generatedOR, payAmount, payMethod);
});

// 4. Show Receipt Modal
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