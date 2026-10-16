require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
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
const fail = (res, err, code = 500) => res.status(code).json({ success: false, error: err && err.message ? err.message : String(err) });

// ---- Fee schedule (our own numbers) ----
// Total per year level: 1st year pays the most, then it goes down by 2,000 each year.
const YEAR_TOTALS = { 1: 20000, 2: 18000, 3: 16000, 4: 14000 };

// Flat fees every student pays, whatever the year level (adds up to 2,980.00)
const FLAT = { registration: 1500, tinagong: 150, cyber: 150, subsidy: 250, system: 600, prisaa: 180, gptca: 150 };

// The rest of the total (total - flat fees) is split by share. Tuition takes whatever is left,
// so the items ALWAYS add up to exactly the year's total. Violations/penalties are NOT added here.
const SHARE = { misc: 0.15, lab: 0.18, internet: 0.07 }; // tuition = the remaining 60%
const r2 = (n) => Math.round(n * 100) / 100;

function buildSchedule(total) {
  const rest = total - Object.values(FLAT).reduce((a, b) => a + b, 0);
  const misc = r2(rest * SHARE.misc);
  const lab = r2(rest * SHARE.lab);
  const internet = r2(rest * SHARE.internet);
  const tuition = r2(rest - misc - lab - internet);
  return [
    ['Beginning Balance', 0],
    ['Registration Fee', FLAT.registration],
    ['Tuition Fee', tuition],
    ['Misc. Fees', misc],
    ['BSIT Computer Laboratory', lab],
    ['Internet', internet],
    ['Tinagong Kinaadman Fee', FLAT.tinagong],
    ['Cyber Views Fee', FLAT.cyber],
    ["Teacher's Subsidy", FLAT.subsidy],
    ['School System', FLAT.system],
    ['PRISAA Fee', FLAT.prisaa],
    ['GPTCA Charge', FLAT.gptca]
  ];
}
const FEE_SCHEDULE = Object.fromEntries(Object.entries(YEAR_TOTALS).map(([yr, total]) => [yr, buildSchedule(total)]));

// Bills are due at exam periods of the active semester, not on a free-form date.
const PERIODS = { prelim: 'Prelims', midterm: 'Midterms', prefinal: 'Pre-Finals', finals: 'Finals' };
const MANILA_TODAY = `(now() AT TIME ZONE 'Asia/Manila')::date`;
const pDay = `(p.payment_date AT TIME ZONE 'Asia/Manila')::date`;

const TERM_COLS = `term_id, label, is_active,
  to_char(prelim_date,'YYYY-MM-DD') AS prelim, to_char(midterm_date,'YYYY-MM-DD') AS midterm,
  to_char(prefinal_date,'YYYY-MM-DD') AS prefinal, to_char(finals_date,'YYYY-MM-DD') AS finals`;

async function activeTerm() {
  try {
    const r = await db.query(`SELECT ${TERM_COLS} FROM academic_terms WHERE is_active = true LIMIT 1`);
    return r.rows[0] || null;
  } catch (e) {
    return null; // migration not run yet
  }
}

async function audit(actorId, action, detail) {
  try {
    await db.query(`INSERT INTO audit_logs (actor_id, action, detail) VALUES ($1, $2, $3)`, [actorId || null, action, detail || null]);
  } catch (e) {
    console.error('Audit error:', e.message);
  }
}

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
  await db.query(`UPDATE bills SET status = $1 WHERE bill_id = $2 AND status <> 'cancelled'`, [status, billId]);
}

// Creates one "Assessment of Fees" bill plus its line items (bills.amount = total charges - discount)
async function createAssessment(client, { studentId, yearLevel, feeTypeId, issuerId, term }) {
  const items = FEE_SCHEDULE[yearLevel] || FEE_SCHEDULE[1];
  const total = Math.round(items.reduce((sum, i) => sum + i[1], 0) * 100) / 100;
  const bill = await client.query(
    `INSERT INTO bills (student_id, fee_type_id, title, amount, discount, status, due_date, issued_by, term_id, due_period)
     VALUES ($1, $2, 'Assessment of Fees', $3, 0, 'unpaid', $4, $5, $6, 'finals') RETURNING bill_id`,
    [studentId, feeTypeId, total, term ? term.finals : null, issuerId, term ? term.term_id : null]
  );
  const billId = bill.rows[0].bill_id;
  await client.query(
    `INSERT INTO bill_items (bill_id, description, amount, sort_order)
     SELECT $1, t.d, t.a, t.o FROM unnest($2::text[], $3::numeric[], $4::int[]) AS t(d, a, o)`,
    [billId, items.map((i) => i[0]), items.map((i) => i[1]), items.map((_, idx) => idx)]
  );
  return { billId, total };
}

async function studentSummary(studentId) {
  const s = (await db.query(
    `SELECT user_id, student_or_emp_id, full_name, email, status, year_level FROM users WHERE user_id = $1`,
    [studentId]
  )).rows[0];
  if (!s) return null;

  const bills = await db.query(
    `SELECT b.bill_id, b.title, b.amount, b.discount, b.status, b.due_period, to_char(b.due_date,'YYYY-MM-DD') AS due_date, f.name AS category,
            t.label AS term_label,
            CASE WHEN iu.role IN ('cashier', 'admin') THEN iu.full_name END AS assessed_by,
            CASE WHEN iu.role IN ('cashier', 'admin') THEN iu.student_or_emp_id END AS assessed_by_id,
            COALESCE((SELECT SUM(p.amount_paid) FROM payments p WHERE p.bill_id = b.bill_id AND p.status = 'confirmed'), 0) AS paid
     FROM bills b LEFT JOIN fee_types f ON b.fee_type_id = f.fee_type_id
     LEFT JOIN academic_terms t ON t.term_id = b.term_id
     LEFT JOIN users iu ON iu.user_id = b.issued_by
     WHERE b.student_id = $1 AND b.status <> 'cancelled' ORDER BY b.bill_id`,
    [studentId]
  );
  const items = await db.query(
    `SELECT bi.bill_id, bi.description, bi.amount FROM bill_items bi JOIN bills b ON b.bill_id = bi.bill_id
     WHERE b.student_id = $1 AND b.status <> 'cancelled' ORDER BY bi.bill_id, bi.sort_order, bi.item_id`,
    [studentId]
  );
  bills.rows.forEach((b) => { b.items = items.rows.filter((i) => i.bill_id === b.bill_id); });
  const payments = await db.query(
    `SELECT p.payment_id, p.bill_id, p.amount_paid, p.payment_method, p.payment_date, p.status, p.reference_no, b.title AS bill_title
     FROM payments p JOIN bills b ON b.bill_id = p.bill_id
     WHERE p.student_id = $1 ORDER BY p.payment_date DESC`,
    [studentId]
  );
  const balance = bills.rows.reduce((sum, b) => sum + (parseFloat(b.amount) - parseFloat(b.paid)), 0);
  return { student: s, current_balance: balance, bills: bills.rows, payments: payments.rows };
}

// ==========================================
// EMAIL + RECEIPTS
// ==========================================
const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      })
    : null;

async function buildReceipt(paymentId) {
  const r = await db.query(
    `SELECT p.payment_id, p.student_id, p.amount_paid, p.payment_method, p.payment_date, p.reference_no, p.status,
            s.email, s.full_name, s.student_or_emp_id, b.bill_id, b.title, b.amount AS bill_amount,
            f.name AS category, c.full_name AS cashier_name, c.student_or_emp_id AS cashier_no
     FROM payments p
     JOIN users s ON s.user_id = p.student_id
     JOIN bills b ON b.bill_id = p.bill_id
     LEFT JOIN fee_types f ON f.fee_type_id = b.fee_type_id
     LEFT JOIN users c ON c.user_id = p.cashier_id
     WHERE p.payment_id = $1`,
    [paymentId]
  );
  const p = r.rows[0];
  if (!p) return null;
  const paid = await getPaidTotal(p.bill_id);
  return {
    payment_id: p.payment_id,
    student_id: p.student_id,
    status: p.status,
    email: p.email,
    or_no: orNo(p.payment_id),
    date: p.payment_date,
    amount: parseFloat(p.amount_paid),
    method: p.payment_method,
    reference_no: p.reference_no,
    student_name: p.full_name,
    student_no: p.student_or_emp_id,
    bill_title: p.title,
    category: p.category,
    bill_amount: parseFloat(p.bill_amount),
    bill_balance: Math.max(0, parseFloat(p.bill_amount) - paid),
    received_by: p.cashier_name ? p.cashier_name + (p.cashier_no ? ` (${p.cashier_no})` : '') : 'Business Office'
  };
}

async function sendReceiptEmail(to, r) {
  if (!transporter || !to) return;
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#64707f">${k}</td><td style="padding:6px 0;text-align:right"><strong>${v}</strong></td></tr>`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden">
      <div style="background:#0e2238;color:#fff;padding:20px 24px">
        <div style="font-size:18px;font-weight:bold">Torres Capitol College</div>
        <div style="font-size:13px;opacity:.8">Business Office · Official Receipt</div>
      </div>
      <div style="padding:24px">
        <p>Dear <strong>${esc(r.student_name)}</strong>, your payment has been confirmed.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${row('Receipt no.', esc(r.or_no))}
          ${row('Date', esc(new Date(r.date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })))}
          ${row('Item', esc(r.bill_title))}
          ${row('Payment method', esc(String(r.method).toUpperCase()))}
          ${r.reference_no ? row('Reference no.', esc(r.reference_no)) : ''}
          ${row('Remaining on this item', '₱' + peso(r.bill_balance))}
        </table>
        <p style="font-size:20px;color:#1f7a5a;margin:18px 0 0"><strong>Amount paid: ₱${peso(r.amount)}</strong></p>
        <p style="font-size:12px;color:#64707f;margin-top:24px">This is an automated receipt. You can also view or download it from your student portal.</p>
      </div>
    </div>`;
  try {
    await transporter.sendMail({
      from: `"TCC Billing Office" <${process.env.EMAIL_USER}>`,
      to,
      subject: `Official Receipt ${r.or_no} - Payment confirmed`,
      html
    });
  } catch (err) {
    console.error('Email error:', err.message);
  }
}

// Awaited so Vercel doesn't cut the email off
async function finalizePayment(paymentId) {
  const receipt = await buildReceipt(paymentId);
  if (receipt) await sendReceiptEmail(receipt.email, receipt);
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

const staff = [authenticateToken, requireRole('cashier', 'admin')];
const adminOnly = [authenticateToken, requireRole('admin')];

// Light brute-force protection (per server instance)
const attempts = new Map();
const tooMany = (key) => {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 8;
};
const noteFail = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);

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
  if (password !== req.body.confirm_password) {
    return res.status(400).json({ success: false, error: 'Passwords do not match. Please re-enter them.' });
  }

  const term = await activeTerm();
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
      `SELECT fee_type_id FROM fee_types ORDER BY (name ILIKE 'tuition%') DESC, fee_type_id LIMIT 1`
    );
    if (!feeTypes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, error: 'No fee type exists yet. Ask the admin to add one.' });
    }

    const yl = FEE_SCHEDULE[parseInt(year_level)] ? parseInt(year_level) : 1;
    const hashedPassword = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (student_or_emp_id, full_name, email, password, role, status, year_level)
       VALUES ($1, $2, $3, $4, 'student', 'pending', $5) RETURNING user_id`,
      [student_id.trim(), full_name.trim(), email.trim(), hashedPassword, yl]
    );
    const newUserId = userResult.rows[0].user_id;

    const issuers = await client.query(`SELECT user_id FROM users WHERE role IN ('admin', 'cashier') LIMIT 1`);
    const issuerId = issuers.rows.length ? issuers.rows[0].user_id : newUserId;

    // Itemized assessment (no violations or penalties are added at registration)
    await createAssessment(client, { studentId: newUserId, yearLevel: yl, feeTypeId: feeTypes.rows[0].fee_type_id, issuerId, term });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Registration submitted. You can sign in once the business office approves your account.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Registration error:', err);
    fail(res, 'Server error creating account: ' + err.message);
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { identifier, email, password } = req.body;
  const loginId = (identifier || email || '').trim();

  if (!loginId || !password) {
    return res.status(400).json({ success: false, error: 'Enter your email or Student ID and your password.' });
  }
  const key = `${req.ip}|${loginId.toLowerCase()}`;
  if (tooMany(key)) {
    return res.status(429).json({ success: false, error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  try {
    const result = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, password, role, status
       FROM users WHERE LOWER(email) = LOWER($1) OR student_or_emp_id = $1`,
      [loginId]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      noteFail(key);
      return res.status(401).json({ success: false, error: 'Incorrect email/Student ID or password.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ success: false, error: 'Your registration is still waiting for approval.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ success: false, error: 'This account is not active. Contact the business office.' });
    }

    attempts.delete(key);
    const token = jwt.sign(
      { user_id: user.user_id, student_or_emp_id: user.student_or_emp_id, full_name: user.full_name, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({
      success: true,
      token,
      user: { user_id: user.user_id, student_or_emp_id: user.student_or_emp_id, full_name: user.full_name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    fail(res, err);
  }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
  }
  try {
    const u = (await db.query(`SELECT password FROM users WHERE user_id = $1`, [req.user.user_id])).rows[0];
    if (!u || !(await bcrypt.compare(current_password || '', u.password))) {
      return res.status(400).json({ success: false, error: 'Your current password is incorrect.' });
    }
    await db.query(`UPDATE users SET password = $1 WHERE user_id = $2`, [await bcrypt.hash(new_password, 10), req.user.user_id]);
    await audit(req.user.user_id, 'password.change', 'Changed own password');
    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    fail(res, err);
  }
});

// ==========================================
// FORGOT / RESET PASSWORD (email link, 30 minutes, single use)
// ==========================================
const RESET_MINUTES = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const RESET_SENT_MSG = 'If that Student ID or email matches an account, a reset link has been sent to the email on file. Check your inbox and spam folder.';

// Never build the link from the Host header (a forged Host would send the token to an attacker).
// Set APP_URL in Vercel (e.g. https://your-app.vercel.app). Vercel's own production URL is the fallback.
const appBase = () =>
  (process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${process.env.PORT || 3000}`)
  ).replace(/\/$/, '');

async function sendResetEmail(to, name, link) {
  if (!transporter || !to) return false;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden">
      <div style="background:#0e2238;color:#fff;padding:20px 24px">
        <div style="font-size:18px;font-weight:bold">Torres Capitol College</div>
        <div style="font-size:13px;opacity:.8">Billing & Payments · Password reset</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.5;color:#1a2533">
        <p>Hi <strong>${esc(name)}</strong>,</p>
        <p>We received a request to reset your password. Click the button below to choose a new one. This link works once and expires in ${RESET_MINUTES} minutes.</p>
        <p style="margin:24px 0"><a href="${esc(link)}" style="background:#0e2238;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block">Reset my password</a></p>
        <p style="font-size:12px;color:#64707f">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>
        <p style="font-size:12px;color:#64707f">If you did not ask for this, ignore this email. Your password stays the same.</p>
      </div>
    </div>`;
  try {
    await transporter.sendMail({ from: `"TCC Billing Office" <${process.env.EMAIL_USER}>`, to, subject: 'Reset your TCC Billing password', html });
    return true;
  } catch (err) {
    console.error('Reset email error:', err.message);
    return false;
  }
}

// Tells a new student whether the Business Office approved or rejected their registration
async function sendAccountDecisionEmail(to, name, studentNo, approved) {
  if (!transporter || !to) return false;
  const link = appBase();
  const body = approved
    ? `<p>Hi <strong>${esc(name)}</strong>,</p>
       <p>Good news! Your Torres Capitol College Billing account has been <strong style="color:#16794a">approved</strong>.</p>
       <p>You can now sign in with your Student ID <strong>${esc(studentNo)}</strong> (or this email) and the password you created. Inside you can see your assessment of fees, your balance, submit payments and download official receipts.</p>
       <p style="margin:24px 0"><a href="${esc(link)}" style="background:#0e2238;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;display:inline-block">Sign in to view my bills</a></p>
       <p style="font-size:12px;color:#64707f">If the button does not work, copy this link into your browser:<br>${esc(link)}</p>`
    : `<p>Hi <strong>${esc(name)}</strong>,</p>
       <p>Your registration for the Torres Capitol College Billing System was <strong style="color:#b3261e">not approved</strong>.</p>
       <p>Please visit the Business Office (Mon–Fri, 8:00 AM–5:00 PM) with your school ID so they can check your details. You can register again afterwards.</p>`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e3e6eb;border-radius:8px;overflow:hidden">
      <div style="background:#0e2238;color:#fff;padding:20px 24px">
        <div style="font-size:18px;font-weight:bold">Torres Capitol College</div>
        <div style="font-size:13px;opacity:.8">Billing & Payments · Account ${approved ? 'approved' : 'update'}</div>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.5;color:#1a2533">${body}</div>
    </div>`;
  try {
    await transporter.sendMail({
      from: `"TCC Billing Office" <${process.env.EMAIL_USER}>`,
      to,
      subject: approved ? 'Your TCC Billing account is approved' : 'Update on your TCC Billing registration',
      html
    });
    return true;
  } catch (err) {
    console.error('Account decision email error:', err.message);
    return false;
  }
}

app.post('/api/auth/forgot-password', async (req, res) => {
  const loginId = String(req.body.identifier || '').trim();
  if (!loginId) return res.status(400).json({ success: false, error: 'Enter your Student ID or email.' });
  if (!transporter) {
    return res.status(503).json({ success: false, error: 'Password reset by email is not set up yet. Please ask the Business Office to reset your password.' });
  }
  const key = `forgot|${req.ip}`;
  if (tooMany(key)) return res.status(429).json({ success: false, error: 'Too many requests. Try again in 15 minutes.' });
  noteFail(key);

  try {
    const u = (await db.query(
      `SELECT user_id, full_name, email FROM users WHERE (LOWER(email) = LOWER($1) OR student_or_emp_id = $1) AND status = 'approved'`,
      [loginId]
    )).rows[0];
    if (u) {
      const recent = await db.query(
        `SELECT COUNT(*) AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '15 minutes'`,
        [u.user_id]
      );
      if (parseInt(recent.rows[0].n) < 3) {
        const raw = crypto.randomBytes(32).toString('hex');
        await db.query(
          `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '${RESET_MINUTES} minutes')`,
          [u.user_id, sha256(raw)]
        );
        const sent = await sendResetEmail(u.email, u.full_name, `${appBase()}/?reset=${raw}`);
        if (!sent) console.error(`Reset email was NOT delivered to ${u.email}. Check EMAIL_USER / EMAIL_PASS.`);
        await audit(u.user_id, 'password.reset_request', 'Requested a password reset link');
      }
    } else {
      console.log('Forgot password: no approved account matches that Student ID / email.');
    }
    // Same answer whether or not the account exists, so this can't be used to find valid IDs.
    res.json({ success: true, message: RESET_SENT_MSG });
  } catch (err) {
    console.error('Forgot password error:', err);
    fail(res, err);
  }
});

// Admin check that Gmail sending works. Shows the real error so setup problems are easy to find.
app.post('/api/admin/test-email', ...adminOnly, async (req, res) => {
  if (!transporter) {
    return res.status(400).json({ success: false, error: 'EMAIL_USER and EMAIL_PASS are not set for Production in Vercel. Add them, then redeploy.' });
  }
  try {
    let to = String(req.body.to || '').trim();
    if (!to) to = (await db.query(`SELECT email FROM users WHERE user_id = $1`, [req.user.user_id])).rows[0]?.email;
    if (!to) return res.status(400).json({ success: false, error: 'Enter an email address to send the test to.' });
    await transporter.sendMail({
      from: `"TCC Billing Office" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'TCC Billing test email',
      text: 'This is a test email from the TCC Billing System. Email sending works.'
    });
    res.json({ success: true, message: `Test email sent to ${to}. Check the inbox and the spam folder.` });
  } catch (err) {
    console.error('Test email error:', err.message);
    res.status(500).json({ success: false, error: 'Email failed: ' + err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, new_password } = req.body;
  if (!token || typeof token !== 'string') return res.status(400).json({ success: false, error: 'This reset link is not valid.' });
  if (!new_password || new_password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  const key = `reset|${req.ip}`;
  if (tooMany(key)) return res.status(429).json({ success: false, error: 'Too many attempts. Try again in 15 minutes.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Claim the token atomically so it can only be used once.
    const claim = (await client.query(
      `UPDATE password_resets SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(token)]
    )).rows[0];
    if (!claim) {
      await client.query('ROLLBACK');
      noteFail(key);
      return res.status(400).json({ success: false, error: 'This reset link is invalid or has expired. Request a new one.' });
    }
    await client.query(`UPDATE users SET password = $1 WHERE user_id = $2`, [await bcrypt.hash(new_password, 10), claim.user_id]);
    await client.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [claim.user_id]);
    await client.query('COMMIT');
    await audit(claim.user_id, 'password.reset', 'Password reset using an emailed link');
    res.json({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Reset password error:', err);
    fail(res, err);
  } finally {
    client.release();
  }
});

// Fee types, active term and due periods for forms
app.get('/api/meta', authenticateToken, async (req, res) => {
  try {
    const ft = await db.query('SELECT * FROM fee_types ORDER BY fee_type_id');
    res.json({ success: true, fee_types: ft.rows, term: await activeTerm(), periods: PERIODS });
  } catch (err) {
    fail(res, err);
  }
});

// ==========================================
// STUDENT ROUTES
// ==========================================
app.get('/api/student/:id/summary', authenticateToken, async (req, res) => {
  const studentId = parseInt(req.params.id);
  if (req.user.role === 'student' && parseInt(req.user.user_id) !== studentId) {
    return res.status(403).json({ success: false, error: 'Access denied to this student summary.' });
  }
  try {
    const s = await studentSummary(studentId);
    if (!s) return res.status(404).json({ success: false, error: 'Student not found.' });
    res.json({ success: true, ...s, term: await activeTerm() });
  } catch (err) {
    fail(res, err);
  }
});

// Student submits a payment reference -> stays PENDING until a cashier confirms it
app.post('/api/student/payments', authenticateToken, requireRole('student'), async (req, res) => {
  const { bill_id, amount_paid, payment_method, reference_no } = req.body;
  const amt = parseFloat(amount_paid);
  if (!bill_id || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Choose a bill and enter a valid amount.' });
  }
  // Online payments only. In-person payments are recorded by the cashier at the counter.
  if (!['GCash', 'Bank Transfer'].includes(payment_method)) {
    return res.status(400).json({ success: false, error: 'Choose GCash or Bank Transfer. To pay in person, go to the cashier.' });
  }
  if (!(reference_no || '').trim()) {
    return res.status(400).json({ success: false, error: 'Enter the reference number from your GCash or bank receipt.' });
  }

  try {
    const b = (await db.query(
      `SELECT bill_id, amount FROM bills WHERE bill_id = $1 AND student_id = $2 AND status <> 'cancelled'`,
      [bill_id, req.user.user_id]
    )).rows[0];
    if (!b) return res.status(404).json({ success: false, error: 'Bill not found.' });

    const remaining = parseFloat(b.amount) - (await getPaidTotal(b.bill_id));
    if (remaining <= 0.01) return res.status(400).json({ success: false, error: 'This bill is already fully paid.' });
    if (amt > remaining + 0.01) {
      return res.status(400).json({ success: false, error: `Amount exceeds the remaining balance of ₱${peso(remaining)}.` });
    }

    await db.query(
      `INSERT INTO payments (bill_id, student_id, cashier_id, amount_paid, payment_method, status, reference_no)
       VALUES ($1, $2, NULL, $3, $4, 'pending', $5)`,
      [b.bill_id, req.user.user_id, amt, payment_method || 'GCash', (reference_no || '').trim() || null]
    );
    res.json({ success: true, message: 'Payment submitted. A cashier will verify it and send your receipt.' });
  } catch (err) {
    console.error('Student payment error:', err);
    fail(res, err);
  }
});

// Receipt for one confirmed payment (students can only open their own)
app.get('/api/payments/:id/receipt', authenticateToken, async (req, res) => {
  try {
    const r = await buildReceipt(parseInt(req.params.id));
    if (!r) return res.status(404).json({ success: false, error: 'Receipt not found.' });
    if (req.user.role === 'student' && r.student_id !== parseInt(req.user.user_id)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }
    if (r.status !== 'confirmed') return res.status(400).json({ success: false, error: 'Only confirmed payments have a receipt.' });
    delete r.email;
    res.json({ success: true, receipt: r });
  } catch (err) {
    fail(res, err);
  }
});

// ==========================================
// CASHIER / ADMIN: STUDENT ACCOUNTS
// ==========================================
app.get('/api/staff/students', ...staff, async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  try {
    const r = await db.query(
      `SELECT u.user_id, u.student_or_emp_id, u.full_name, u.email, u.year_level,
         (SELECT COALESCE(SUM(b.amount), 0) FROM bills b WHERE b.student_id = u.user_id AND b.status <> 'cancelled')
         - (SELECT COALESCE(SUM(p.amount_paid), 0) FROM payments p JOIN bills b ON b.bill_id = p.bill_id
            WHERE p.student_id = u.user_id AND p.status = 'confirmed' AND b.status <> 'cancelled') AS balance
       FROM users u
       WHERE u.role = 'student' AND u.status = 'approved' AND (u.full_name ILIKE $1 OR u.student_or_emp_id ILIKE $1)
       ORDER BY u.full_name LIMIT 15`,
      [q]
    );
    res.json({ success: true, students: r.rows });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/staff/students/:id/account', ...staff, async (req, res) => {
  try {
    const s = await studentSummary(parseInt(req.params.id));
    if (!s) return res.status(404).json({ success: false, error: 'Student not found.' });
    res.json({ success: true, ...s });
  } catch (err) {
    fail(res, err);
  }
});

// Issue a bill. Due date comes from the active semester's exam period.
app.post('/api/staff/bills', ...staff, async (req, res) => {
  const { user_id, fee_type_id, title, amount, due_period } = req.body;
  const amt = parseFloat(amount);
  const period = PERIODS[due_period] ? due_period : 'finals';
  if (!user_id || !title || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Student, title and a valid amount are required.' });
  }
  try {
    const u = (await db.query(`SELECT user_id, full_name FROM users WHERE user_id = $1 AND role = 'student'`, [user_id])).rows[0];
    if (!u) return res.status(404).json({ success: false, error: 'Student not found.' });

    let feeTypeId = fee_type_id;
    if (!feeTypeId) {
      const ft = await db.query(`SELECT fee_type_id FROM fee_types ORDER BY fee_type_id LIMIT 1`);
      if (!ft.rows.length) return res.status(400).json({ success: false, error: 'Add a fee type first.' });
      feeTypeId = ft.rows[0].fee_type_id;
    }
    const term = await activeTerm();
    await db.query(
      `INSERT INTO bills (student_id, fee_type_id, title, amount, status, due_date, issued_by, term_id, due_period)
       VALUES ($1, $2, $3, $4, 'unpaid', $5, $6, $7, $8)`,
      [u.user_id, feeTypeId, title.trim(), amt, term ? term[period] : null, req.user.user_id, term ? term.term_id : null, period]
    );
    await audit(req.user.user_id, 'bill.issue', `${title.trim()} ₱${peso(amt)} → ${u.full_name} (due ${PERIODS[period]})`);
    res.json({ success: true, message: `Billed ₱${peso(amt)} for "${title.trim()}".` });
  } catch (err) {
    fail(res, err);
  }
});

// Give an existing student the itemized assessment (new semester, or after cancelling an old lump-sum bill)
app.post('/api/staff/students/:id/assessment', ...staff, async (req, res) => {
  const client = await db.connect();
  try {
    const u = (await client.query(`SELECT user_id, full_name, year_level FROM users WHERE user_id = $1 AND role = 'student'`, [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ success: false, error: 'Student not found.' });

    const term = await activeTerm();
    const dup = await client.query(
      `SELECT 1 FROM bills WHERE student_id = $1 AND status <> 'cancelled' AND title = 'Assessment of Fees' AND term_id IS NOT DISTINCT FROM $2::int`,
      [u.user_id, term ? term.term_id : null]
    );
    if (dup.rows.length) return res.status(400).json({ success: false, error: 'This student already has an assessment for this semester.' });

    const ft = await client.query(`SELECT fee_type_id FROM fee_types ORDER BY (name ILIKE 'tuition%') DESC, fee_type_id LIMIT 1`);
    if (!ft.rows.length) return res.status(400).json({ success: false, error: 'Add a fee type first.' });

    await client.query('BEGIN');
    const yl = FEE_SCHEDULE[u.year_level] ? u.year_level : 1;
    const a = await createAssessment(client, { studentId: u.user_id, yearLevel: yl, feeTypeId: ft.rows[0].fee_type_id, issuerId: req.user.user_id, term });
    await client.query('COMMIT');
    await audit(req.user.user_id, 'assessment.generate', `₱${peso(a.total)} → ${u.full_name}`);
    res.json({ success: true, message: `Assessment of ₱${peso(a.total)} added to ${u.full_name}.` });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    fail(res, err);
  } finally {
    client.release();
  }
});

// Admin sets the total discount on an itemized assessment (replaces any earlier discount)
app.post('/api/staff/bills/:id/discount', ...adminOnly, async (req, res) => {
  const disc = parseFloat(req.body.discount);
  if (isNaN(disc) || disc < 0) return res.status(400).json({ success: false, error: 'Enter a valid discount amount.' });
  try {
    const b = (await db.query(
      `SELECT b.bill_id, b.status, u.full_name,
              COALESCE((SELECT SUM(i.amount) FROM bill_items i WHERE i.bill_id = b.bill_id), 0) AS charges
       FROM bills b JOIN users u ON u.user_id = b.student_id WHERE b.bill_id = $1`,
      [req.params.id]
    )).rows[0];
    if (!b || b.status === 'cancelled') return res.status(404).json({ success: false, error: 'Bill not found.' });
    const charges = parseFloat(b.charges);
    if (charges <= 0) return res.status(400).json({ success: false, error: 'Discounts can only be applied to an itemized assessment.' });
    if (disc > charges + 0.001) return res.status(400).json({ success: false, error: `The discount cannot be more than the total charges of ₱${peso(charges)}.` });

    const net = Math.round((charges - disc) * 100) / 100;
    const paid = await getPaidTotal(b.bill_id);
    if (net < paid - 0.01) return res.status(400).json({ success: false, error: `That discount is too large. The student has already paid ₱${peso(paid)}.` });

    await db.query(`UPDATE bills SET discount = $1, amount = $2 WHERE bill_id = $3`, [disc, net, b.bill_id]);
    await refreshBillStatus(b.bill_id, net);
    await audit(req.user.user_id, 'bill.discount', `₱${peso(disc)} → ${b.full_name}`);
    res.json({ success: true, message: `Discount of ₱${peso(disc)} saved.` });
  } catch (err) {
    fail(res, err);
  }
});

// Counter payment (cash received by the cashier), confirmed immediately
app.post('/api/payments', ...staff, async (req, res) => {
  const { bill_id, amount_paid } = req.body;
  const amt = parseFloat(amount_paid);
  if (!bill_id || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Valid bill and payment amount are required.' });
  }
  try {
    const b = (await db.query(`SELECT bill_id, student_id, amount, status FROM bills WHERE bill_id = $1`, [bill_id])).rows[0];
    if (!b || b.status === 'cancelled') return res.status(404).json({ success: false, error: 'Bill not found.' });

    const remaining = parseFloat(b.amount) - (await getPaidTotal(b.bill_id));
    if (remaining <= 0.01) return res.status(400).json({ success: false, error: 'This bill is already fully paid.' });
    if (amt > remaining + 0.01) {
      return res.status(400).json({ success: false, error: `Payment exceeds the remaining balance of ₱${peso(remaining)}.` });
    }

    const ins = await db.query(
      `INSERT INTO payments (bill_id, student_id, cashier_id, amount_paid, payment_method, status, reference_no)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6) RETURNING payment_id`,
      [b.bill_id, b.student_id, req.user.user_id, amt, 'cash', null]
    );
    await refreshBillStatus(b.bill_id, parseFloat(b.amount));
    const receipt = await finalizePayment(ins.rows[0].payment_id);
    await audit(req.user.user_id, 'payment.record', `${receipt.or_no} ₱${peso(amt)} from ${receipt.student_name}`);
    delete receipt.email;
    res.json({ success: true, message: `Payment of ₱${peso(amt)} recorded.`, receipt });
  } catch (err) {
    console.error('Payment error:', err);
    fail(res, err);
  }
});

app.get('/api/cashier/pending-payments', ...staff, async (req, res) => {
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
    fail(res, err);
  }
});

app.post('/api/cashier/payments/:id/confirm', ...staff, async (req, res) => {
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
    await audit(req.user.user_id, 'payment.confirm', `${receipt.or_no} ₱${peso(receipt.amount)} from ${receipt.student_name}`);
    delete receipt.email;
    res.json({ success: true, message: 'Payment confirmed and receipt emailed.', receipt });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/cashier/payments/:id/reject', ...staff, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE payments SET status = 'rejected', cashier_id = $1 WHERE payment_id = $2 AND status = 'pending' RETURNING payment_id`,
      [req.user.user_id, req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Payment not found or already processed.' });
    await audit(req.user.user_id, 'payment.reject', `Payment #${req.params.id} rejected`);
    res.json({ success: true, message: 'Payment rejected.' });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Transactions list + CSV export ----
function paymentFilter(q) {
  const where = ['1=1'];
  const vals = [];
  const add = (sql, v) => { vals.push(v); where.push(sql.replace('?', `$${vals.length}`)); };
  if (q.from) add(`${pDay} >= ?::date`, q.from);
  if (q.to) add(`${pDay} <= ?::date`, q.to);
  if (q.status) add(`p.status = ?`, q.status);
  if (q.q) {
    vals.push(`%${q.q.trim()}%`);
    const n = `$${vals.length}`;
    where.push(`(s.full_name ILIKE ${n} OR s.student_or_emp_id ILIKE ${n} OR p.reference_no ILIKE ${n})`);
  }
  return { where: where.join(' AND '), vals };
}
const PAY_FROM = `FROM payments p JOIN users s ON s.user_id = p.student_id JOIN bills b ON b.bill_id = p.bill_id
                  LEFT JOIN users c ON c.user_id = p.cashier_id`;

app.get('/api/staff/payments', ...staff, async (req, res) => {
  try {
    const { where, vals } = paymentFilter(req.query);
    const rows = await db.query(
      `SELECT p.payment_id, p.amount_paid, p.payment_method, p.payment_date, p.status, p.reference_no,
              s.full_name, s.student_or_emp_id, b.title, c.full_name AS cashier_name
       ${PAY_FROM} WHERE ${where} ORDER BY p.payment_date DESC LIMIT 300`,
      vals
    );
    const tot = await db.query(
      `SELECT COALESCE(SUM(p.amount_paid) FILTER (WHERE p.status = 'confirmed'), 0) AS total,
              COUNT(*) FILTER (WHERE p.status = 'confirmed') AS confirmed_count
       ${PAY_FROM} WHERE ${where}`,
      vals
    );
    res.json({ success: true, payments: rows.rows, total: parseFloat(tot.rows[0].total), confirmed_count: parseInt(tot.rows[0].confirmed_count) });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/staff/payments.csv', ...staff, async (req, res) => {
  try {
    const { where, vals } = paymentFilter(req.query);
    const rows = await db.query(
      `SELECT p.payment_id, p.payment_date, s.student_or_emp_id, s.full_name, b.title, p.payment_method,
              p.reference_no, p.amount_paid, p.status, c.full_name AS cashier_name
       ${PAY_FROM} WHERE ${where} ORDER BY p.payment_date DESC`,
      vals
    );
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Receipt No', 'Date', 'Student ID', 'Student', 'Bill', 'Method', 'Reference', 'Amount', 'Status', 'Received by'].join(',')];
    rows.rows.forEach((r) =>
      lines.push([
        orNo(r.payment_id),
        new Date(r.payment_date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }),
        r.student_or_emp_id, r.full_name, r.title, r.payment_method, r.reference_no, r.amount_paid, r.status, r.cashier_name
      ].map(cell).join(','))
    );
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="payments.csv"');
    res.send('\ufeff' + lines.join('\n'));
  } catch (err) {
    fail(res, err);
  }
});

// ---- Dashboard numbers ----
app.get('/api/staff/stats', ...staff, async (req, res) => {
  try {
    const q = async (sql) => (await db.query(sql)).rows[0];
    const today = await q(
      `SELECT COALESCE(SUM(p.amount_paid), 0) AS total, COUNT(*) AS n FROM payments p
       WHERE p.status = 'confirmed' AND ${pDay} = ${MANILA_TODAY}`
    );
    const open = await q(
      `SELECT COALESCE(SUM(b.amount - COALESCE(x.paid, 0)), 0) AS outstanding,
              COUNT(*) FILTER (WHERE b.due_date < ${MANILA_TODAY}) AS overdue
       FROM bills b JOIN users u ON u.user_id = b.student_id AND u.status = 'approved'
       LEFT JOIN (SELECT bill_id, SUM(amount_paid) AS paid FROM payments WHERE status = 'confirmed' GROUP BY bill_id) x ON x.bill_id = b.bill_id
       WHERE b.status NOT IN ('paid', 'cancelled')`
    );
    const pend = await q(`SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'`);
    const regs = await q(`SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND status = 'pending'`);
    res.json({
      success: true,
      collected_today: parseFloat(today.total),
      transactions_today: parseInt(today.n),
      outstanding: parseFloat(open.outstanding),
      overdue_bills: parseInt(open.overdue),
      pending_payments: parseInt(pend.n),
      pending_registrations: parseInt(regs.n)
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Registrations (admin only) ----
app.get('/api/staff/registrations', ...adminOnly, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, year_level, created_at
       FROM users WHERE role = 'student' AND status = 'pending' ORDER BY created_at`
    );
    res.json({ success: true, users: r.rows });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/staff/registrations/:id', ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });
  try {
    const r = await db.query(
      `UPDATE users SET status = $1 WHERE user_id = $2 AND role = 'student' AND status = 'pending' RETURNING full_name, email, student_or_emp_id`,
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Registration not found or already handled.' });
    if (status === 'approved') {
      // The staff member who approves the account is the one who assessed the student's fees
      await db.query(
        `UPDATE bills SET issued_by = $1 WHERE student_id = $2 AND title = 'Assessment of Fees' AND status <> 'cancelled'`,
        [req.user.user_id, req.params.id]
      );
    }
    await audit(req.user.user_id, `registration.${status}`, r.rows[0].full_name);
    const u = r.rows[0];
    const emailed = await sendAccountDecisionEmail(u.email, u.full_name, u.student_or_emp_id, status === 'approved');
    res.json({
      success: true,
      message: `Registration ${status}. ` + (emailed ? `An email was sent to ${u.email}.` : 'No email was sent (email is not set up or failed).')
    });
  } catch (err) {
    fail(res, err);
  }
});

// ==========================================
// ADMIN
// ==========================================
app.get('/api/admin/overview', ...adminOnly, async (req, res) => {
  try {
    const series = await db.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(p.amount_paid), 0) AS total
       FROM generate_series(${MANILA_TODAY} - 13, ${MANILA_TODAY}, interval '1 day') d
       LEFT JOIN payments p ON p.status = 'confirmed' AND ${pDay} = d::date
       GROUP BY d ORDER BY d`
    );
    const methods = await db.query(
      `SELECT LOWER(payment_method) AS method, SUM(amount_paid) AS total, COUNT(*) AS n
       FROM payments WHERE status = 'confirmed' GROUP BY 1 ORDER BY total DESC`
    );
    const categories = await db.query(
      `SELECT COALESCE(f.name, 'Uncategorized') AS category, SUM(p.amount_paid) AS total
       FROM payments p JOIN bills b ON b.bill_id = p.bill_id LEFT JOIN fee_types f ON f.fee_type_id = b.fee_type_id
       WHERE p.status = 'confirmed' GROUP BY 1 ORDER BY total DESC`
    );
    const debtors = await db.query(
      `SELECT u.user_id, u.full_name, u.student_or_emp_id,
              SUM(b.amount - COALESCE(x.paid, 0)) AS owed
       FROM bills b JOIN users u ON u.user_id = b.student_id AND u.status = 'approved'
       LEFT JOIN (SELECT bill_id, SUM(amount_paid) AS paid FROM payments WHERE status = 'confirmed' GROUP BY bill_id) x ON x.bill_id = b.bill_id
       WHERE b.status NOT IN ('paid', 'cancelled')
       GROUP BY u.user_id, u.full_name, u.student_or_emp_id HAVING SUM(b.amount - COALESCE(x.paid, 0)) > 0
       ORDER BY owed DESC LIMIT 6`
    );
    const allTime = await db.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total FROM payments WHERE status = 'confirmed'`);
    const counts = await db.query(`SELECT role, status, COUNT(*) AS n FROM users GROUP BY role, status`);
    res.json({
      success: true,
      series: series.rows.map((r) => ({ day: r.day, total: parseFloat(r.total) })),
      methods: methods.rows.map((r) => ({ method: r.method, total: parseFloat(r.total), n: parseInt(r.n) })),
      categories: categories.rows.map((r) => ({ category: r.category, total: parseFloat(r.total) })),
      debtors: debtors.rows.map((r) => ({ ...r, owed: parseFloat(r.owed) })),
      collected_total: parseFloat(allTime.rows[0].total),
      users: counts.rows.map((r) => ({ role: r.role, status: r.status, n: parseInt(r.n) }))
    });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Users & staff ----
app.get('/api/admin/users', ...adminOnly, async (req, res) => {
  const vals = [];
  const where = ['1=1'];
  if (req.query.role) { vals.push(req.query.role); where.push(`role = $${vals.length}`); }
  if (req.query.status) { vals.push(req.query.status); where.push(`status = $${vals.length}`); }
  if (req.query.q) { vals.push(`%${req.query.q.trim()}%`); where.push(`(full_name ILIKE $${vals.length} OR student_or_emp_id ILIKE $${vals.length} OR email ILIKE $${vals.length})`); }
  try {
    const r = await db.query(
      `SELECT user_id, student_or_emp_id, full_name, email, role, status, year_level, created_at
       FROM users WHERE ${where.join(' AND ')} ORDER BY role, full_name LIMIT 300`,
      vals
    );
    res.json({ success: true, users: r.rows });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/users', ...adminOnly, async (req, res) => {
  const { full_name, email, emp_id, role, password } = req.body;
  if (!full_name || !email || !emp_id || !password || !['cashier', 'admin'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Name, email, employee ID, role and password are required.' });
  }
  if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  try {
    const dup = await db.query(`SELECT 1 FROM users WHERE student_or_emp_id = $1 OR LOWER(email) = LOWER($2)`, [emp_id.trim(), email.trim()]);
    if (dup.rows.length) return res.status(400).json({ success: false, error: 'That employee ID or email is already in use.' });
    await db.query(
      `INSERT INTO users (student_or_emp_id, full_name, email, password, role, status) VALUES ($1, $2, $3, $4, $5, 'approved')`,
      [emp_id.trim(), full_name.trim(), email.trim(), await bcrypt.hash(password, 10), role]
    );
    await audit(req.user.user_id, 'user.create', `${role}: ${full_name.trim()}`);
    res.json({ success: true, message: `${role === 'admin' ? 'Admin' : 'Cashier'} account created.` });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/users/:id/status', ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid status.' });
  if (parseInt(req.params.id) === parseInt(req.user.user_id)) {
    return res.status(400).json({ success: false, error: 'You cannot change your own account status.' });
  }
  try {
    const r = await db.query(`UPDATE users SET status = $1 WHERE user_id = $2 RETURNING full_name`, [status, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'User not found.' });
    await audit(req.user.user_id, status === 'approved' ? 'user.activate' : 'user.deactivate', r.rows[0].full_name);
    res.json({ success: true, message: status === 'approved' ? 'Account activated.' : 'Account deactivated.' });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/users/:id/password', ...adminOnly, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  try {
    const r = await db.query(`UPDATE users SET password = $1 WHERE user_id = $2 RETURNING full_name`, [await bcrypt.hash(password, 10), req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'User not found.' });
    await audit(req.user.user_id, 'user.password_reset', r.rows[0].full_name);
    res.json({ success: true, message: 'Password reset.' });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Fee types ----
app.post('/api/admin/fee-types', ...adminOnly, async (req, res) => {
  const { name, default_amount, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Enter a fee name.' });
  const amt = default_amount === '' || default_amount == null ? null : parseFloat(default_amount);
  try {
    await db.query(`INSERT INTO fee_types (name, default_amount, description) VALUES ($1, $2, $3)`, [name.trim(), amt, (description || '').trim() || null]);
    await audit(req.user.user_id, 'fee_type.create', name.trim());
    res.json({ success: true, message: 'Fee type added.' });
  } catch (err) {
    fail(res, err);
  }
});

app.put('/api/admin/fee-types/:id', ...adminOnly, async (req, res) => {
  const { name, default_amount, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Enter a fee name.' });
  const amt = default_amount === '' || default_amount == null ? null : parseFloat(default_amount);
  try {
    await db.query(`UPDATE fee_types SET name = $1, default_amount = $2, description = $3 WHERE fee_type_id = $4`, [name.trim(), amt, (description || '').trim() || null, req.params.id]);
    await audit(req.user.user_id, 'fee_type.update', name.trim());
    res.json({ success: true, message: 'Fee type updated.' });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/admin/fee-types/:id', ...adminOnly, async (req, res) => {
  try {
    const used = await db.query(`SELECT 1 FROM bills WHERE fee_type_id = $1 LIMIT 1`, [req.params.id]);
    if (used.rows.length) return res.status(400).json({ success: false, error: 'This fee type is used by existing bills and can’t be deleted.' });
    await db.query(`DELETE FROM fee_types WHERE fee_type_id = $1`, [req.params.id]);
    await audit(req.user.user_id, 'fee_type.delete', `#${req.params.id}`);
    res.json({ success: true, message: 'Fee type deleted.' });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Academic terms (semester calendar) ----
app.get('/api/terms', ...staff, async (req, res) => {
  try {
    const r = await db.query(`SELECT ${TERM_COLS} FROM academic_terms ORDER BY term_id DESC`);
    res.json({ success: true, terms: r.rows });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/terms', ...adminOnly, async (req, res) => {
  const { label, prelim, midterm, prefinal, finals, activate } = req.body;
  if (!label || !prelim || !midterm || !prefinal || !finals) {
    return res.status(400).json({ success: false, error: 'Enter a name and all four exam-period dates.' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (activate) await client.query(`UPDATE academic_terms SET is_active = false`);
    await client.query(
      `INSERT INTO academic_terms (label, prelim_date, midterm_date, prefinal_date, finals_date, is_active) VALUES ($1, $2, $3, $4, $5, $6)`,
      [label.trim(), prelim, midterm, prefinal, finals, !!activate]
    );
    await client.query('COMMIT');
    await audit(req.user.user_id, 'term.create', label.trim());
    res.json({ success: true, message: 'Semester added.' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    fail(res, err);
  } finally {
    client.release();
  }
});

// Editing dates also moves the due dates of every bill tied to that semester
app.put('/api/admin/terms/:id', ...adminOnly, async (req, res) => {
  const { label, prelim, midterm, prefinal, finals } = req.body;
  if (!label || !prelim || !midterm || !prefinal || !finals) {
    return res.status(400).json({ success: false, error: 'Enter a name and all four exam-period dates.' });
  }
  try {
    await db.query(
      `UPDATE academic_terms SET label = $1, prelim_date = $2, midterm_date = $3, prefinal_date = $4, finals_date = $5 WHERE term_id = $6`,
      [label.trim(), prelim, midterm, prefinal, finals, req.params.id]
    );
    const moved = await db.query(
      `UPDATE bills SET due_date = CASE due_period WHEN 'prelim' THEN $2::date WHEN 'midterm' THEN $3::date
                                                   WHEN 'prefinal' THEN $4::date WHEN 'finals' THEN $5::date END
       WHERE term_id = $1 AND due_period IN ('prelim', 'midterm', 'prefinal', 'finals')`,
      [req.params.id, prelim, midterm, prefinal, finals]
    );
    await audit(req.user.user_id, 'term.update', `${label.trim()} (${moved.rowCount} bills re-dated)`);
    res.json({ success: true, message: `Semester updated. ${moved.rowCount} bill(s) now follow the new dates.` });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/terms/:id/activate', ...adminOnly, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE academic_terms SET is_active = false`);
    const r = await client.query(`UPDATE academic_terms SET is_active = true WHERE term_id = $1 RETURNING label`, [req.params.id]);
    if (!r.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Semester not found.' }); }
    await client.query('COMMIT');
    await audit(req.user.user_id, 'term.activate', r.rows[0].label);
    res.json({ success: true, message: `${r.rows[0].label} is now the active semester.` });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    fail(res, err);
  } finally {
    client.release();
  }
});

// ---- Bulk billing ----
app.post('/api/admin/bulk-bill', ...adminOnly, async (req, res) => {
  const { fee_type_id, title, amount, due_period, year_level } = req.body;
  const amt = parseFloat(amount);
  const period = PERIODS[due_period] ? due_period : 'finals';
  const yl = year_level && year_level !== 'all' ? parseInt(year_level) : null;
  if (!fee_type_id || !title || isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Fee type, title and a valid amount are required.' });
  }
  try {
    const term = await activeTerm();
    const r = await db.query(
      `INSERT INTO bills (student_id, fee_type_id, title, amount, status, due_date, issued_by, term_id, due_period)
       SELECT user_id, $1::int, $2, $3::numeric, 'unpaid', $4::date, $5::int, $6::int, $7
       FROM users WHERE role = 'student' AND status = 'approved' AND ($8::int IS NULL OR year_level = $8::int)`,
      [fee_type_id, title.trim(), amt, term ? term[period] : null, req.user.user_id, term ? term.term_id : null, period, yl]
    );
    await audit(req.user.user_id, 'bill.bulk', `${title.trim()} ₱${peso(amt)} → ${r.rowCount} students (${yl ? yl + 'Y' : 'all'})`);
    res.json({ success: true, message: `Billed ${r.rowCount} student(s) ₱${peso(amt)} each.` });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Corrections: void a confirmed payment, cancel a bill ----
app.post('/api/admin/payments/:id/void', ...adminOnly, async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ success: false, error: 'Enter a reason for voiding this payment.' });
  try {
    const p = (await db.query(
      `SELECT p.payment_id, p.status, p.amount_paid, b.bill_id, b.amount FROM payments p JOIN bills b ON b.bill_id = p.bill_id WHERE p.payment_id = $1`,
      [req.params.id]
    )).rows[0];
    if (!p) return res.status(404).json({ success: false, error: 'Payment not found.' });
    if (p.status !== 'confirmed') return res.status(400).json({ success: false, error: 'Only confirmed payments can be voided.' });
    await db.query(`UPDATE payments SET status = 'voided', void_reason = $1, voided_by = $2 WHERE payment_id = $3`, [reason, req.user.user_id, p.payment_id]);
    await refreshBillStatus(p.bill_id, parseFloat(p.amount));
    await audit(req.user.user_id, 'payment.void', `${orNo(p.payment_id)} ₱${peso(p.amount_paid)} — ${reason}`);
    res.json({ success: true, message: `${orNo(p.payment_id)} voided.` });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/admin/bills/:id/cancel', ...adminOnly, async (req, res) => {
  try {
    const b = (await db.query(`SELECT bill_id, title, status FROM bills WHERE bill_id = $1`, [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ success: false, error: 'Bill not found.' });
    if (await getPaidTotal(b.bill_id) > 0) {
      return res.status(400).json({ success: false, error: 'This bill already has confirmed payments. Void them first.' });
    }
    await db.query(`UPDATE payments SET status = 'rejected' WHERE bill_id = $1 AND status = 'pending'`, [b.bill_id]);
    await db.query(`UPDATE bills SET status = 'cancelled' WHERE bill_id = $1`, [b.bill_id]);
    await audit(req.user.user_id, 'bill.cancel', b.title);
    res.json({ success: true, message: 'Bill cancelled.' });
  } catch (err) {
    fail(res, err);
  }
});

// ---- Audit log ----
app.get('/api/admin/audit', ...adminOnly, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT a.log_id, a.action, a.detail, a.created_at, u.full_name AS actor
       FROM audit_logs a LEFT JOIN users u ON u.user_id = a.actor_id ORDER BY a.log_id DESC LIMIT 200`
    );
    res.json({ success: true, logs: r.rows });
  } catch (err) {
    fail(res, err);
  }
});

// Local development only. On Vercel the exported app is used instead.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

module.exports = app;