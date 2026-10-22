const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { clearSessionCookies } = require('../middleware/auth');

/**
 * Returns structured notice object for session expiration or logout reason
 */
function getReasonNotice(reason, role) {
  if (!reason) return null;
  const inactMins = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES, 10) || 15;
  const adminHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_ADMIN_HOURS) || 8;
  const otherHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_TEACHER_HOURS) || 12;

  if (reason === 'inactivity') {
    return {
      type: 'warning',
      title: 'Session Expired',
      message: `Your session has expired due to ${inactMins} minutes of inactivity. Please log in again to continue.`
    };
  }
  if (reason === 'absolute') {
    const hours = (role === 'admin') ? adminHours : otherHours;
    return {
      type: 'warning',
      title: 'Session Lifetime Expired',
      message: (role === 'admin')
        ? `Your administrator session has reached its ${hours}-hour maximum lifetime limit. Please log in again for security.`
        : `Your session has reached its maximum allowable duration (${hours} hours). Please log in again to continue.`
    };
  }
  if (reason === 'logout') {
    return {
      type: 'success',
      title: 'Signed Out',
      message: 'You have been successfully logged out.'
    };
  }
  if (reason === 'expired') {
    return {
      type: 'warning',
      title: 'Session Expired',
      message: 'Your session has expired. Please log in again to continue.'
    };
  }
  return null;
}

// Helper function for login logic
async function handleLogin(req, res, expectedRole = null) {
  const roleFromForm = (req.body.role || '').trim();
  const targetRole = expectedRole || (['admin', 'teacher', 'student'].includes(roleFromForm) ? roleFromForm : null);
  const identifier = (req.body.email || req.body.identifier || '').trim();
  const password = (req.body.password || '').trim();

  const redirectUrl = targetRole ? `/login/${targetRole}` : '/login';

  if (!identifier || !password) {
    req.flash('error_msg', 'Please enter both your identifier and password.');
    return res.redirect(redirectUrl);
  }

  try {
    let rows = [];

    if (targetRole === 'teacher') {
      // Teachers MUST log in using Teacher ID (employee_id) or Email only.
      // Mobile number cannot be used as login ID.

      // 1. Try finding teacher by email
      const [emailRows] = await db.query(`
        SELECT u.*, t.employee_id
        FROM teachers t
        JOIN users u ON t.user_id = u.id
        WHERE u.email = ? AND u.is_active = 1
      `, [identifier]);
      if (emailRows.length) rows = emailRows;

      // 2. Try finding teacher by Employee ID
      if (!rows.length) {
        const [empRows] = await db.query(`
          SELECT u.*, t.employee_id
          FROM teachers t
          JOIN users u ON t.user_id = u.id
          WHERE (t.employee_id = ? OR UPPER(t.employee_id) = UPPER(?)) AND u.is_active = 1
        `, [identifier, identifier]);
        if (empRows.length) rows = empRows;
      }

      // 3. If teacher entered phone number as identifier, give specific helpful error
      if (!rows.length) {
        const [phoneCheck] = await db.query(
          'SELECT u.* FROM users u WHERE u.phone = ? AND u.role = "teacher" AND u.is_active = 1',
          [identifier]
        );
        if (phoneCheck.length) {
          req.flash('error_msg', 'Mobile number cannot be used as Login ID for teachers. Please log in with your Teacher ID or Email.');
          return res.redirect(redirectUrl);
        }
      }

      if (!rows.length) {
        req.flash('error_msg', 'Teacher account not found. Please verify your Teacher Employee ID or Email.');
        return res.redirect(redirectUrl);
      }
    } else if (targetRole === 'student') {
      // Students log in using Admission Number or Email / Mobile No
      // 1. Try finding student by admission_no
      const [studentRows] = await db.query(`
        SELECT u.*, s.admission_no, s.emergency_contact, s.guardian_phone
        FROM students s 
        JOIN users u ON s.user_id = u.id 
        WHERE (s.admission_no = ? OR UPPER(s.admission_no) = UPPER(?)) AND u.is_active = 1
      `, [identifier, identifier]);
      if (studentRows.length) rows = studentRows;

      // 2. Try finding by email
      if (!rows.length) {
        const [emailRows] = await db.query(`
          SELECT u.*, s.admission_no, s.emergency_contact, s.guardian_phone
          FROM students s 
          JOIN users u ON s.user_id = u.id 
          WHERE u.email = ? AND u.role = 'student' AND u.is_active = 1
        `, [identifier]);
        if (emailRows.length) rows = emailRows;
      }

      // 3. Try finding by registered mobile number
      if (!rows.length) {
        const [phoneRows] = await db.query(`
          SELECT u.*, s.admission_no, s.emergency_contact, s.guardian_phone
          FROM students s 
          JOIN users u ON s.user_id = u.id 
          WHERE (u.phone = ? OR s.guardian_phone = ? OR s.emergency_contact = ?) AND u.is_active = 1
        `, [identifier, identifier, identifier]);
        if (phoneRows.length) rows = phoneRows;
      }

      if (!rows.length) {
        req.flash('error_msg', 'Student account not found. Please verify your Admission Number or registered details.');
        return res.redirect(redirectUrl);
      }
    } else {
      // General or Admin
      // 1. Try finding by email
      const [emailRows] = await db.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [identifier]);
      if (emailRows.length) rows = emailRows;

      // 2. Try finding student by admission_no
      if (!rows.length) {
        const [studentRows] = await db.query(`
          SELECT u.*, s.admission_no, s.emergency_contact, s.guardian_phone
          FROM students s 
          JOIN users u ON s.user_id = u.id 
          WHERE (s.admission_no = ? OR UPPER(s.admission_no) = UPPER(?)) AND u.is_active = 1
        `, [identifier, identifier]);
        if (studentRows.length) rows = studentRows;
      }

      // 3. Try finding teacher by employee_id
      if (!rows.length) {
        const [teacherRows] = await db.query(`
          SELECT u.*, t.employee_id
          FROM teachers t 
          JOIN users u ON t.user_id = u.id 
          WHERE (t.employee_id = ? OR UPPER(t.employee_id) = UPPER(?)) AND u.is_active = 1
        `, [identifier, identifier]);
        if (teacherRows.length) rows = teacherRows;
      }

      // 4. Try finding by registered phone number (students only - teachers cannot use phone as ID)
      if (!rows.length) {
        const [phoneRows] = await db.query('SELECT * FROM users WHERE phone = ? AND is_active = 1', [identifier]);
        if (phoneRows.length) {
          if (phoneRows[0].role === 'teacher') {
            req.flash('error_msg', 'Mobile number cannot be used as Login ID for teachers. Please log in with your Teacher ID or Email.');
            return res.redirect(redirectUrl);
          }
          rows = phoneRows;
        }
      }

      if (!rows.length) {
        req.flash('error_msg', 'Account not found. Please verify your Login ID and password.');
        return res.redirect(redirectUrl);
      }
    }

    const user = rows[0];

    // If logging into a specific role portal, check role match
    if (targetRole && user.role !== targetRole) {
      const roleLabels = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' };
      const currentPortalLabel = roleLabels[targetRole] || targetRole;
      const userRoleLabel = roleLabels[user.role] || user.role;
      req.flash('error_msg', `This is the ${currentPortalLabel} portal. Your account is registered as ${userRoleLabel}. Please use the ${userRoleLabel} tab.`);
      return res.redirect(redirectUrl);
    }

    // Password verification:
    // 1. Try bcrypt against stored password hash
    let isMatch = await bcrypt.compare(password, user.password);

    // 2. For teachers: their registered mobile number is their password
    if (!isMatch && user.role === 'teacher') {
      const userPhone = (user.phone || '').trim();
      const rawPass = password.trim();
      const cleanPhone = userPhone.replace(/\D/g, '');
      const cleanPass = rawPass.replace(/\D/g, '');
      if (
        (userPhone && userPhone === rawPass) ||
        (cleanPhone && cleanPass && (cleanPhone === cleanPass || cleanPhone.endsWith(cleanPass) || cleanPass.endsWith(cleanPhone)))
      ) {
        isMatch = true;
      }
    }

    // 3. For students: registered mobile number, emergency contact, or guardian phone is password
    if (!isMatch && user.role === 'student') {
      const userPhone = (user.phone || '').trim();
      const emergencyPhone = (user.emergency_contact || '').trim();
      const guardianPhone = (user.guardian_phone || '').trim();
      const rawPass = password.trim();
      const cleanPass = rawPass.replace(/\D/g, '');

      const phones = [userPhone, emergencyPhone, guardianPhone].filter(Boolean);
      for (const ph of phones) {
        const cleanPh = ph.replace(/\D/g, '');
        if (
          ph === rawPass ||
          (cleanPh && cleanPass && (cleanPh === cleanPass || cleanPh.endsWith(cleanPass) || cleanPass.endsWith(cleanPh)))
        ) {
          isMatch = true;
          break;
        }
      }
    }

    if (!isMatch) {
      req.flash('error_msg', 'Invalid password. Please check your password and try again.');
      return res.redirect(redirectUrl);
    }

    // Regenerate session ID upon successful login to prevent session fixation attacks
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('Session regeneration error:', regenErr);
        req.flash('error_msg', 'Unable to initiate a secure session. Please try again.');
        return res.redirect(redirectUrl);
      }

      const now = Date.now();
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        photo: user.profile_photo
      };
      req.session.createdAt = now;
      req.session.lastActivity = now;

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save error:', saveErr);
          req.flash('error_msg', 'Session error. Please try again.');
          return res.redirect(redirectUrl);
        }
        res.redirect(`/${user.role}`);
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error_msg', 'Database/Server error: ' + (err.message || 'Please try again.'));
    res.redirect(redirectUrl);
  }
}

// GET /login
router.get('/login', (req, res) => {
  if (req.query.clear) {
    clearSessionCookies(res);
    return req.session.destroy(() => {
      res.render('auth/login', {
        layout: 'layouts/auth',
        title: 'Login - School ERP',
        activeRole: req.query.role || 'student',
        sessionNotice: null
      });
    });
  }
  if (req.session && req.session.user) {
    return res.redirect(`/${req.session.user.role}`);
  }

  const activeRole = req.query.role || 'student';
  const sessionNotice = getReasonNotice(req.query.reason, activeRole);

  res.render('auth/login', {
    layout: 'layouts/auth',
    title: 'Login - School ERP',
    activeRole,
    sessionNotice
  });
});

// Role-specific login pages
router.get('/login/:role', (req, res) => {
  const validRoles = ['admin', 'teacher', 'student'];
  const role = req.params.role.toLowerCase();
  if (!validRoles.includes(role)) {
    return res.redirect('/login');
  }
  if (req.session && req.session.user) {
    return res.redirect(`/${req.session.user.role}`);
  }

  const roleTitles = {
    admin: 'Admin Login - School ERP',
    teacher: 'Teacher Login - School ERP',
    student: 'Student Login - School ERP'
  };

  const sessionNotice = getReasonNotice(req.query.reason, role);

  res.render('auth/login', {
    layout: 'layouts/auth',
    title: roleTitles[role] || 'Login - School ERP',
    activeRole: role,
    sessionNotice
  });
});

// Aliases for direct role entry
router.get('/admin/login', (req, res) => res.redirect('/login/admin'));
router.get('/teacher/login', (req, res) => res.redirect('/login/teacher'));
router.get('/student/login', (req, res) => res.redirect('/login/student'));

// POST /login
router.post('/login', async (req, res) => {
  await handleLogin(req, res);
});

// POST /login/:role
router.post('/login/:role', async (req, res) => {
  const validRoles = ['admin', 'teacher', 'student'];
  const role = req.params.role.toLowerCase();
  if (!validRoles.includes(role)) {
    return res.redirect('/login');
  }
  await handleLogin(req, res, role);
});

// ==================== ADMIN PASSWORD RESET ====================
// GET /admin/reset-password & /login/admin/reset
router.get(['/admin/reset-password', '/login/admin/reset'], (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') {
    return res.redirect('/admin');
  }
  res.render('auth/reset-password', {
    layout: 'layouts/auth',
    title: 'Reset Admin Password - School ERP'
  });
});

// POST /admin/reset-password & /login/admin/reset
router.post(['/admin/reset-password', '/login/admin/reset'], async (req, res) => {
  const email = (req.body.email || '').trim();
  const security_pin = (req.body.security_pin || '').trim();
  const new_password = (req.body.new_password || '').trim();
  const confirm_password = (req.body.confirm_password || '').trim();

  try {
    if (!email || !security_pin || !new_password || !confirm_password) {
      req.flash('error_msg', 'Please fill in all required fields.');
      return res.redirect('/admin/reset-password');
    }

    if (new_password.length < 6) {
      req.flash('error_msg', 'New password must be at least 6 characters long.');
      return res.redirect('/admin/reset-password');
    }

    if (new_password !== confirm_password) {
      req.flash('error_msg', 'New password and confirm password do not match.');
      return res.redirect('/admin/reset-password');
    }

    // Verify master security recovery key (configurable via ADMIN_RESET_PIN in .env, default: admin1234)
    const configuredPin = (process.env.ADMIN_RESET_PIN || 'admin1234').trim();
    if (security_pin !== configuredPin) {
      req.flash('error_msg', 'Invalid Master Security Recovery Key. Please provide the correct recovery key.');
      return res.redirect('/admin/reset-password');
    }

    // Find admin user
    const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND role = "admin" AND is_active = 1', [email]);
    if (!rows.length) {
      req.flash('error_msg', 'No administrator account found with this email address.');
      return res.redirect('/admin/reset-password');
    }

    const adminUser = rows[0];
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ? AND role = "admin"', [hashed, adminUser.id]);

    req.flash('success_msg', 'Admin password reset successfully! You can now log in with your new password.');
    res.redirect('/login/admin');
  } catch (err) {
    console.error('Admin password reset error:', err);
    req.flash('error_msg', 'Error resetting password: ' + err.message);
    res.redirect('/admin/reset-password');
  }
});

// GET / - redirect to role dashboard or login
router.get('/', (req, res) => {
  if (req.session.user) return res.redirect(`/${req.session.user.role}`);
  res.redirect('/login');
});

// Public Photo Gallery (accessible without login)
router.get('/gallery', async (req, res) => {
  try {
    const category = req.query.category || '';
    let query = `SELECT * FROM gallery`;
    const params = [];
    if (category) {
      query += ` WHERE category=?`;
      params.push(category);
    }
    query += ` ORDER BY created_at DESC`;
    const [images] = await db.query(query, params);
    const [categories] = await db.query(`SELECT DISTINCT category FROM gallery WHERE category IS NOT NULL AND category != ''`);

    res.render('public-gallery', {
      layout: 'layouts/auth',
      title: 'School Photo Gallery - ' + (res.locals.schoolName || 'School ERP'),
      images,
      categories: categories.map(c => c.category),
      selectedCategory: category
    });
  } catch (err) {
    console.error('Public gallery error:', err);
    res.redirect('/login');
  }
});

// ==================== SESSION KEEPALIVE & STATUS API ====================
router.get('/api/session-ping', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      authenticated: false,
      expired: true,
      message: 'No active session found.'
    });
  }

  // checkSessionExpiry has already refreshed req.session.lastActivity
  res.json({
    authenticated: true,
    user: {
      id: req.session.user.id,
      name: req.session.user.name,
      role: req.session.user.role
    },
    lastActivity: req.session.lastActivity,
    createdAt: req.session.createdAt
  });
});

// ==================== LOGOUT ====================
function handleLogout(req, res) {
  const role = req.session && req.session.user ? req.session.user.role : null;
  const redirectTarget = role ? `/login/${role}?reason=logout` : '/login?reason=logout';

  // Explicitly clear browser session cookies
  clearSessionCookies(res);

  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error('Logout session destruction error:', err);
      res.redirect(redirectTarget);
    });
  } else {
    res.redirect(redirectTarget);
  }
}

router.post('/logout', handleLogout);
router.get('/logout', handleLogout);

module.exports = router;
