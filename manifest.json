require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
if (!process.env.JWT_SECRET) console.warn('⚠️ JWT_SECRET is not set. Add it in Vercel environment variables.');

// Supabase PostgreSQL (use the Transaction pooler connection string, port 6543)
const db = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
  max: 3
});

// ==========================================
// HELPERS
// ==========================================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const orNo = (id) => 'OR-' + String(id).padStart(5, '0');

const YEAR_LEVEL_FEES = {
  1: { amount: 5000.0, title: '1st Year Base Tuition & Unit Fees' },
  2: { amount: 5500.0, title: '2nd Year Base Tuition & Unit Fees' },
  3: { amount: 6000.0, title: '3rd Year Base Tuition & Unit Fees' },
  4: { amount: 6500.0, title: '4th Year Base Tuition & Unit Fees' }
};

// Only CONFIRMED payments count toward a bill
async function getPaidTotal(billId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(amount_paid), 0) AS total FROM payments WHERE bill_id = $1 AND status = 'confirmed'`,
    [billId]
  );
  return parseFloat(r.rows[0].total);
}

async function refreshBillStatus(billId, billAmount) {
  const paid = await getPaidTotal(billId);
  const status = paid >= billAmount - 0.01 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';
  await db.query(`UPDATE bills SET status = $1 WHERE bill_id = $2`, [status, billId]);
}

// ==========================================
// EMAIL RECEIPTS
// ==========================================
const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      })
    : null;

async function sendReceiptEmail(to, r) {
  if (!transporter || !to) return;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; text-align: center; margin-bottom: 5px;">🏫 Official Payment Receipt</h2>
      <p style="text-align: center; color: #64748b; font-size: 0.9rem; margin-top: 0;">Torres Capitol College Billing</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
      <p>Dear <strong>${esc(r.student_name)}</strong>,</p>
      <p>Your payment has been confirmed.</p>
      <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
        <p style="margin: 5px 0;"><strong>Official Receipt No:</strong> ${esc(r.or_no)}</p>
        <p style="margin: 5px 0;"><strong>Date & Time:</strong> ${esc(new Date(r.date).toLocaleString('en-PH'))}</p>
        <p style="margin: 5px 0;"><strong>Item Billed:</strong> ${esc(r.bill_title)}</p>
        <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${esc(String(r.method).toUpperCase())}</p>
        <p style="margin: 5px 0; font-size: 1.1rem; color: #16a34a;"><strong>Amount Paid:</strong> ₱${peso(r.amount)}</p>
      </div>
      <p style="font-size: 0.85rem; color: #64748b; text-align: center;">Automated receipt. Please keep this email for your records.</p>
    </div>`;
  try {
    await transporter.sendMail({
      from: `"TCC Billing Office" <${process.env.EMAIL_USER}>`,
      to,
      subject: `Official Receipt [${r.or_no}] - Payment Confirmed`,
      html
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

// Build the receipt for a confirmed payment and email it (awaited so Vercel doesn't cut it off)
async function finalizePayment(paymentId) {
  const r = await db.query(
    `SELECT p.payment_id, p.amount_paid, p.payment_method, p.payment_date, u.email, u.full_name, b.title
     FROM payments p
     JOIN users u ON u.user_id = p.student_id
     JOIN bills b ON b.bill_id = p.bill_id
     WHERE p.payment_id = $1`,
    [paymentId]
  );
  const p = r.rows[0];
  const receipt = {
    or_no: orNo(p.payment_id),
    date: p.payment_date,
    amount: parseFloat(p.amount_paid),
    method: p.payment_method,
    student_name: p.full_name,
    bill_title: p.title
  };
  await sendReceiptEmail(p.email, receipt);
  return receipt;
}

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Access denied. Token missing.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
    req.user = user;
    next();
  });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions.' });
    }
    next();
  };
}

// ==========================================
// AUTH ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const { student_id, full_name, email, password, year_level } = req.body;

  if (!student_id || !full_name || !email || !password) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT user_id FROM users WHERE student_or_emp_id = $1 OR LOWER(email) = LOWER($2)`,
      [student_id.trim(), email.trim()]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Student ID or Email is already registered.' });
    }

    const feeTypes = await client.query(
      `SELECT fee_type_id FROM fee_types ORDER BY (name ILIKE 'tuition') DESC, fee_type_id LIMIT 1`
    );
    if (!feeTypes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, error: 'No fee type exists yet. Ask the admin to add one.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (student_or_emp_id, full_name, email, password, role, status)
       VALUES ($1, $2, $3, $4, 'student', 'pending') RETURNING user_id`,
      [student_id.trim(), full_name.trim(), email.trim(), hashedPassword]
    );
    const newUserId = userResult.rows[0].user_id;

    const feeInfo = YEAR_LEVEL_FEES[parseInt(year_level)] || YEAR_LEVEL_FEES[1];
    const issuers = await client.query(`SELECT user_id FROM users WHERE role IN ('admin', 'cashier') LIMIT 1`);
    const issuerId = issuers.rows.length ? issuers.rows[0].user_id : newUserId;

    await client.query(
      `INSERT INTO bills (student_id, fee_type_id, title, amount, status, issued_by)
       VALUES ($1, $2, $3, $4, 'unpaid', $5)`,
      [newUserId, feeTypes.rows[0].fee_type_id, feeInfo.title, feeInfo.amount, issuerId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Registration submitted! Please wait for admin approval.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: 'Server error creating account: ' + err.message });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, email, password } = req.body;
  const loginId = (identifier || email || '').trim();

  if (!loginId || !password) {
    return res.status(400).json({ success: false, error: 'Email or Student ID and password are required.' });
  }

  try {
    const result = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, password, role, status
       FROM users WHERE LOWER(email) = LOWER($1) OR student_or_emp_id = $1`,
      [loginId]
    );
    if (!result.rows.length) {
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
      user: { user_id: user.user_id, student_or_emp_id: user.student_or_emp_id, full_name: user.full_name, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// STUDENT ROUTES
// ==========================================
app.get('/api/student/:id/summary', authenticateToken, async (req, res) => {
  const studentId = parseInt(req.params.id);
  if (req.user.role === 'student' && parseInt(req.user.user_id) !== studentId) {
    return res.status(403).json({ error: 'Access denied to this student summary.' });
  }

  try {
    const bills = await db.query(
      `SELECT b.bill_id, b.title, b.amount, b.status, b.due_date, f.name AS category,
              COALESCE((SELECT SUM(p.amount_paid) FROM payments p WHERE p.bill_id = b.bill_id AND p.status = 'confirmed'), 0) AS paid
       FROM bills b LEFT JOIN fee_types f ON b.fee_type_id = f.fee_type_id
       WHERE b.student_id = $1 ORDER BY b.bill_id`,
      [studentId]
    );
    const payments = await db.query(
      `SELECT p.payment_id, p.bill_id, p.amount_paid, p.payment_method, p.payment_date, p.status, p.reference_no, b.title AS bill_title
       FROM payments p JOIN bills b ON b.bill_id = p.bill_id
       WHERE p.student_id = $1 ORDER BY p.payment_date DESC`,
      [studentId]
    );

    const balance = bills.rows.reduce((sum, b) => sum + (parseFloat(b.amount) - parseFloat(b.paid)), 0);
    res.json({ current_balance: balance, bills: bills.rows, payments: payments.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student submits a payment reference -> stays PENDING until a cashier confirms it
app.post('/api/student/payments', authenticateToken, requireRole('student'), async (req, res) => {
  const { bill_id, amount_paid, payment_method, reference_no } = req.body;
  const amt = parseFloat(amount_paid);
  if (!bill_id || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Choose a bill and enter a valid amount.' });
  }

  try {
    const b = (await db.query(`SELECT bill_id, amount FROM bills WHERE bill_id = $1 AND student_id = $2`, [bill_id, req.user.user_id])).rows[0];
    if (!b) return res.status(404).json({ success: false, error: 'Bill not found.' });

    const remaining = parseFloat(b.amount) - (await getPaidTotal(b.bill_id));
    if (remaining <= 0.01) return res.status(400).json({ success: false, error: 'This bill is already fully paid.' });
    if (amt > remaining + 0.01) {
      return res.status(400).json({ success: false, error: `Amount exceeds remaining balance of ₱${peso(remaining)}.` });
    }

    await db.query(
      `INSERT INTO payments (bill_id, student_id, cashier_id, amount_paid, payment_method, status, reference_no)
       VALUES ($1, $2, NULL, $3, $4, 'pending', $5)`,
      [b.bill_id, req.user.user_id, amt, payment_method || 'GCash', (reference_no || '').trim() || null]
    );
    res.json({ success: true, message: 'Payment submitted! A cashier will verify it and send your receipt.' });
  } catch (err) {
    console.error('Student payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// CASHIER / ADMIN ROUTES
// ==========================================
const cashierOrAdmin = [authenticateToken, requireRole('cashier', 'admin')];
const adminOnly = [authenticateToken, requireRole('admin')];

// Find a student by Student ID number and list their unpaid bills
app.get('/api/cashier/lookup', ...cashierOrAdmin, async (req, res) => {
  const studentNo = (req.query.student_no || '').trim();
  if (!studentNo) return res.status(400).json({ success: false, error: 'Enter a Student ID.' });

  try {
    const u = (await db.query(
      `SELECT user_id, student_or_emp_id, full_name FROM users WHERE student_or_emp_id = $1 AND role = 'student'`,
      [studentNo]
    )).rows[0];
    if (!u) return res.status(404).json({ success: false, error: 'No student found with that ID.' });

    const bills = await db.query(
      `SELECT b.bill_id, b.title, b.amount,
              b.amount - COALESCE((SELECT SUM(p.amount_paid) FROM payments p WHERE p.bill_id = b.bill_id AND p.status = 'confirmed'), 0) AS remaining
       FROM bills b WHERE b.student_id = $1 AND b.status <> 'paid' ORDER BY b.bill_id`,
      [u.user_id]
    );
    res.json({ success: true, student: u, bills: bills.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cashier records a counter payment (confirmed immediately)
const payBill = async (req, res) => {
  const { bill_id, amount_paid, payment_method } = req.body;
  const amt = parseFloat(amount_paid);
  if (!bill_id || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Valid bill and payment amount are required.' });
  }

  try {
    const b = (await db.query(`SELECT bill_id, student_id, amount FROM bills WHERE bill_id = $1`, [bill_id])).rows[0];
    if (!b) return res.status(404).json({ success: false, error: 'Bill not found.' });

    const remaining = parseFloat(b.amount) - (await getPaidTotal(b.bill_id));
    if (remaining <= 0.01) return res.status(400).json({ success: false, error: 'This bill is already fully paid.' });
    if (amt > remaining + 0.01) {
      return res.status(400).json({ success: false, error: `Payment exceeds remaining balance of ₱${peso(remaining)}.` });
    }

    const ins = await db.query(
      `INSERT INTO payments (bill_id, student_id, cashier_id, amount_paid, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING payment_id`,
      [b.bill_id, b.student_id, req.user.user_id, amt, payment_method || 'cash']
    );
    await refreshBillStatus(b.bill_id, parseFloat(b.amount));
    const receipt = await finalizePayment(ins.rows[0].payment_id);

    res.json({ success: true, message: `Payment of ₱${peso(amt)} recorded.`, payment_id: ins.rows[0].payment_id, receipt });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/api/payments', ...cashierOrAdmin, payBill);
app.post('/api/cashier/pay-bill', ...cashierOrAdmin, payBill);

// Pending student payments waiting for verification
app.get('/api/cashier/pending-payments', ...cashierOrAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT p.payment_id, p.amount_paid, p.payment_method, p.reference_no, p.payment_date,
              u.full_name, u.student_or_emp_id, b.title
       FROM payments p
       JOIN users u ON u.user_id = p.student_id
       JOIN bills b ON b.bill_id = p.bill_id
       WHERE p.status = 'pending' ORDER BY p.payment_date`
    );
    res.json({ success: true, payments: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cashier/payments/:id/confirm', ...cashierOrAdmin, async (req, res) => {
  try {
    const p = (await db.query(
      `SELECT p.payment_id, p.status, p.amount_paid, b.bill_id, b.amount
       FROM payments p JOIN bills b ON b.bill_id = p.bill_id WHERE p.payment_id = $1`,
      [req.params.id]
    )).rows[0];
    if (!p) return res.status(404).json({ success: false, error: 'Payment not found.' });
    if (p.status !== 'pending') return res.status(400).json({ success: false, error: 'This payment was already processed.' });

    const remaining = parseFloat(p.amount) - (await getPaidTotal(p.bill_id));
    if (parseFloat(p.amount_paid) > remaining + 0.01) {
      return res.status(400).json({ success: false, error: 'Amount exceeds the bill’s remaining balance.' });
    }

    await db.query(`UPDATE payments SET status = 'confirmed', cashier_id = $1 WHERE payment_id = $2`, [req.user.user_id, p.payment_id]);
    await refreshBillStatus(p.bill_id, parseFloat(p.amount));
    const receipt = await finalizePayment(p.payment_id);

    res.json({ success: true, message: 'Payment confirmed and receipt emailed.', receipt });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cashier/payments/:id/reject', ...cashierOrAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE payments SET status = 'rejected', cashier_id = $1 WHERE payment_id = $2 AND status = 'pending' RETURNING payment_id`,
      [req.user.user_id, req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Payment not found or already processed.' });
    res.json({ success: true, message: 'Payment rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Issue a new bill (student_id here is the Student ID NUMBER, e.g. 2024-0001)
app.post('/api/cashier/add-bill', ...cashierOrAdmin, async (req, res) => {
  const { student_id, title, amount, due_date, fee_type_id } = req.body;
  const amt = parseFloat(amount);
  if (!student_id || !title || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Student ID, title and a valid amount are required.' });
  }

  try {
    const u = (await db.query(`SELECT user_id FROM users WHERE student_or_emp_id = $1 AND role = 'student'`, [student_id.trim()])).rows[0];
    if (!u) return res.status(404).json({ success: false, error: 'No student found with that ID.' });

    let feeTypeId = fee_type_id;
    if (!feeTypeId) {
      const ft = await db.query(`SELECT fee_type_id FROM fee_types ORDER BY fee_type_id LIMIT 1`);
      if (!ft.rows.length) return res.status(400).json({ success: false, error: 'Add a fee type in Supabase first.' });
      feeTypeId = ft.rows[0].fee_type_id;
    }

    await db.query(
      `INSERT INTO bills (student_id, fee_type_id, title, amount, status, due_date, issued_by)
       VALUES ($1, $2, $3, $4, 'unpaid', $5, $6)`,
      [u.user_id, feeTypeId, title.trim(), amt, due_date || null, req.user.user_id]
    );
    res.json({ success: true, message: `Bill "${title.trim()}" issued for ₱${peso(amt)}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ADMIN: APPROVE / REJECT REGISTRATIONS
// ==========================================
app.get('/api/admin/users', ...adminOnly, async (req, res) => {
  const status = req.query.status || 'pending';
  try {
    const r = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, role, status, created_at
       FROM users WHERE status = $1 ORDER BY created_at`,
      [status]
    );
    res.json({ success: true, users: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/users/:id/status', ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status.' });
  }
  try {
    await db.query(`UPDATE users SET status = $1 WHERE user_id = $2`, [status, req.params.id]);
    res.json({ success: true, message: `User ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// FEE TYPES
app.get('/api/fee-types', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM fee_types ORDER BY fee_type_id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fee types' });
  }
});

// Local development only. On Vercel the exported app is used instead.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;