const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

// GET /login
router.get('/login', (req, res) => {
  // Loop-breaker: if ?clear=1, destroy session and show login fresh
  if (req.query.clear) {
    return req.session.destroy(() => {
      res.render('auth/login', { layout: 'layouts/auth', title: 'Login - School ERP' });
    });
  }
  if (req.session.user) {
    return res.redirect(`/${req.session.user.role}`);
  }
  res.render('auth/login', { layout: 'layouts/auth', title: 'Login - School ERP' });
});

// POST /login
router.post('/login', async (req, res) => {
  const identifier = (req.body.email || req.body.identifier || '').trim();
  const password = (req.body.password || '').trim();

  try {
    // 1. Try finding by email
    let [rows] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [identifier]);

    // 2. If not found by email, try finding student by admission_no
    if (!rows.length) {
      const [studentRows] = await db.query(`
        SELECT u.*, s.admission_no, s.emergency_contact, s.guardian_phone
        FROM students s 
        JOIN users u ON s.user_id = u.id 
        WHERE (s.admission_no = ? OR UPPER(s.admission_no) = UPPER(?)) AND u.is_active = 1
      `, [identifier, identifier]);
      if (studentRows.length) {
        rows = studentRows;
      }
    }

    // 3. If still not found, try finding by registered phone number
    if (!rows.length) {
      const [phoneRows] = await db.query('SELECT * FROM users WHERE phone = ? AND is_active = 1', [identifier]);
      if (phoneRows.length) {
        rows = phoneRows;
      }
    }

    if (!rows.length) {
      req.flash('error_msg', 'Invalid Email / Admission Number or Password');
      return res.redirect('/login');
    }

    const user = rows[0];

    // Password verification:
    // First try bcrypt compare against stored hash
    let isMatch = await bcrypt.compare(password, user.password);

    // If student, also allow login with their registered mobile number as password
    if (!isMatch && user.role === 'student') {
      const userPhone = (user.phone || '').trim();
      const emergencyPhone = (user.emergency_contact || '').trim();
      const guardianPhone = (user.guardian_phone || '').trim();
      if (
        (userPhone && userPhone === password) ||
        (emergencyPhone && emergencyPhone === password) ||
        (guardianPhone && guardianPhone === password)
      ) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      req.flash('error_msg', 'Invalid Email / Admission Number or Password');
      return res.redirect('/login');
    }

    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, photo: user.profile_photo };
    // Explicitly save session before redirect to prevent race condition / redirect loop
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        req.flash('error_msg', 'Session error. Try again.');
        return res.redirect('/login');
      }
      res.redirect(`/${user.role}`);
    });
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error_msg', 'Database/Server error: ' + (err.message || 'Please check database connection.'));
    res.redirect('/login');
  }
});

// GET / - redirect to login or dashboard
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect(`/${req.session.user.role}`);
  res.redirect('/login');
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
