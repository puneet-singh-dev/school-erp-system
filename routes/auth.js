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
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) {
      req.flash('error_msg', 'Invalid email or password');
      return res.redirect('/login');
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      req.flash('error_msg', 'Invalid email or password');
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
    console.error(err);
    req.flash('error_msg', 'Server error. Try again.');
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
