const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path'); // <-- Add this
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // <-- Update this line

const JWT_SECRET = process.env.JWT_SECRET || 'school_billing_super_secret_key_2026';

// Supabase PostgreSQL Connection Pool
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ==========================================
// NODEMAILER EMAIL TRANSPORTER
// ==========================================
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendReceiptEmail(studentEmail, receiptData) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️ Email credentials missing in environment variables; skipping email receipt.');
    return;
  }

  const orNo = `OR-${receiptData.payment_id.toString().padStart(5, '0')}`;
  const dateStr = new Date(receiptData.payment_date).toLocaleString();
  const amountStr = parseFloat(receiptData.amount_paid).toFixed(2);

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; text-align: center; margin-bottom: 5px;">🏫 Official Payment Receipt</h2>
      <p style="text-align: center; color: #64748b; font-size: 0.9rem; margin-top: 0;">School Billing Portal</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
      
      <p>Dear <strong>${receiptData.student_name}</strong>,</p>
      <p>Thank you! Your payment has been successfully processed.</p>
      
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>Official Receipt No:</strong> ${orNo}</p>
        <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${dateStr}</p>
        <p style="margin: 5px 0;"><strong>Item Billed:</strong> ${receiptData.bill_title}</p>
        <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${receiptData.payment_method.toUpperCase()}</p>
        <p style="margin: 5px 0; font-size: 1.1rem; color: #16a34a;"><strong>Amount Paid:</strong> ₱${amountStr}</p>
      </div>

      <p style="font-size: 0.85rem; color: #64748b; text-align: center; margin-top: 20px;">
        This is an automated system receipt. Please keep this email for your financial records.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"School Billing Office" <${process.env.EMAIL_USER}>`,
      to: studentEmail,
      subject: `Official Receipt [${orNo}] - Payment Confirmed`,
      html: htmlContent,
    });
    console.log(`✉️ Receipt email successfully sent to: ${studentEmail}`);
  } catch (err) {
    console.error(`❌ Error sending receipt email to ${studentEmail}:`, err.message);
  }
}

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. Token missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired session token.' });
    }
    req.user = user;
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions.' });
    }
    next();
  };
}

// ==========================================
// ROUTES
// ==========================================

const YEAR_LEVEL_FEES = {
  1: { amount: 5000.00, title: '1st Year Base Tuition & Unit Fees' },
  2: { amount: 5500.00, title: '2nd Year Base Tuition & Unit Fees' },
  3: { amount: 6000.00, title: '3rd Year Base Tuition & Unit Fees' },
  4: { amount: 6500.00, title: '4th Year Base Tuition & Unit Fees' }
};

// 1. REGISTER
app.post('/api/auth/register', async (req, res) => {
  const { student_id, full_name, email, password, year_level } = req.body;

  if (!student_id || !full_name || !email || !password) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT user_id FROM users WHERE student_or_emp_id = $1 OR email = $2`,
      [student_id.trim(), email.trim()]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ success: false, error: 'Student ID or Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userResult = await client.query(
      `INSERT INTO users (student_or_emp_id, full_name, email, password, role, status) 
       VALUES ($1, $2, $3, $4, 'student', 'pending') RETURNING user_id`,
      [student_id.trim(), full_name.trim(), email.trim(), hashedPassword]
    );

    const newUserId = userResult.rows[0].user_id;
    const selectedYear = parseInt(year_level) || 1;
    const feeInfo = YEAR_LEVEL_FEES[selectedYear] || YEAR_LEVEL_FEES[1];

    const feeTypes = await client.query(`SELECT fee_type_id FROM fee_types LIMIT 1`);
    const validFeeTypeId = feeTypes.rows.length > 0 ? feeTypes.rows[0].fee_type_id : 1;

    const issuers = await client.query(`SELECT user_id FROM users WHERE role IN ('admin', 'cashier') LIMIT 1`);
    const validIssuerId = issuers.rows.length > 0 ? issuers.rows[0].user_id : newUserId;

    await client.query(
      `INSERT INTO bills (student_id, fee_type_id, title, amount, status, issued_by) 
       VALUES ($1, $2, $3, $4, 'unpaid', $5)`,
      [newUserId, validFeeTypeId, feeInfo.title, feeInfo.amount, validIssuerId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Registration submitted with base bill! Awaiting admin approval.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: 'Server error creating account: ' + err.message });
  } finally {
    client.release();
  }
});

// 2. LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { identifier, email, password } = req.body;
  const loginId = (identifier || email || '').trim();

  if (!loginId || !password) {
    return res.status(400).json({ success: false, error: 'Email or Student ID and password are required.' });
  }

  try {
    const result = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, password, role, status 
       FROM users WHERE email = $1 OR student_or_emp_id = $2`,
      [loginId, loginId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid Email/Student ID or password.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid Email/Student ID or password.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ success: false, error: 'Your registration is pending admin approval.' });
    }

    if (user.status === 'rejected') {
      return res.status(403).json({ success: false, error: 'Your account request was rejected.' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, student_or_emp_id: user.student_or_emp_id, full_name: user.full_name, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      success: true,
      token,
      user: { user_id: user.user_id, student_or_emp_id: user.student_or_emp_id, full_name: user.full_name, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. STUDENT SUMMARY
app.get('/api/student/:id/summary', authenticateToken, async (req, res) => {
  const studentId = req.params.id;

  if (req.user.role === 'student' && parseInt(req.user.user_id) !== parseInt(studentId)) {
    return res.status(403).json({ error: 'Access denied to this student summary.' });
  }

  try {
    const bills = await db.query(
      `SELECT b.bill_id, b.title, b.amount, b.status, b.due_date, f.name as category 
       FROM bills b JOIN fee_types f ON b.fee_type_id = f.fee_type_id WHERE b.student_id = $1`,
      [studentId]
    );

    const payments = await db.query(
      `SELECT payment_id, bill_id, amount_paid, payment_method, payment_date FROM payments WHERE student_id = $1`,
      [studentId]
    );

    const totalBilled = bills.rows.reduce((sum, item) => sum + parseFloat(item.amount), 0);
    const totalPaid = payments.rows.reduce((sum, item) => sum + parseFloat(item.amount_paid), 0);

    res.json({ current_balance: totalBilled - totalPaid, bills: bills.rows, payments: payments.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. CASHIER: PAY BILL
const handlePayBill = async (req, res) => {
  const { bill_id, student_id, amount_paid, payment_method } = req.body;
  const cashier_id = req.user.user_id;
  const payAmount = parseFloat(amount_paid);

  if (!bill_id || isNaN(payAmount) || payAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Valid bill selection and payment amount are required.' });
  }

  try {
    const billRes = await db.query(`SELECT amount, title, status, student_id FROM bills WHERE bill_id = $1`, [bill_id]);
    if (!billRes.rows.length) return res.status(404).json({ success: false, error: 'Bill not found.' });

    const bill = billRes.rows[0];
    const targetStudentId = student_id || bill.student_id;

    const paidRes = await db.query(`SELECT SUM(amount_paid) as total_paid FROM payments WHERE bill_id = $1`, [bill_id]);
    const existingPaid = parseFloat(paidRes.rows[0].total_paid || 0);
    const remainingBalance = parseFloat(bill.amount) - existingPaid;

    if (payAmount > remainingBalance + 0.01) {
      return res.status(400).json({ success: false, error: `Payment exceeds remaining bill balance of ₱${remainingBalance.toFixed(2)}` });
    }

    const payResult = await db.query(
      `INSERT INTO payments (bill_id, student_id, cashier_id, amount_paid, payment_method) 
       VALUES ($1, $2, $3, $4, $5) RETURNING payment_id, payment_date`,
      [bill_id, targetStudentId, cashier_id, payAmount, payment_method || 'cash']
    );

    const newTotalPaid = existingPaid + payAmount;
    const newStatus = newTotalPaid >= parseFloat(bill.amount) - 0.01 ? 'paid' : 'partially_paid';

    await db.query(`UPDATE bills SET status = $1 WHERE bill_id = $2`, [newStatus, bill_id]);

    const studentRes = await db.query(`SELECT email, full_name FROM users WHERE user_id = $1`, [targetStudentId]);
    if (studentRes.rows.length && studentRes.rows[0].email) {
      sendReceiptEmail(studentRes.rows[0].email, {
        payment_id: payResult.rows[0].payment_id,
        payment_date: payResult.rows[0].payment_date,
        amount_paid: payAmount,
        payment_method: payment_method || 'cash',
        student_name: studentRes.rows[0].full_name,
        bill_title: bill.title
      });
    }

    res.json({ 
      success: true, 
      message: `Successfully processed payment of ₱${payAmount.toFixed(2)}!`,
      payment_id: payResult.rows[0].payment_id,
      remaining_bill_balance: Math.max(0, remainingBalance - payAmount)
    });
  } catch (err) {
    console.error('Payment Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/payments', authenticateToken, requireRole('cashier', 'admin'), handlePayBill);
app.post('/api/cashier/pay-bill', authenticateToken, requireRole('cashier', 'admin'), handlePayBill);

// 5. FEE TYPES ENDPOINT
app.get('/api/fee-types', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM fee_types');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fee types' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;