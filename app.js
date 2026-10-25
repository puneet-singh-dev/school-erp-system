const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

const db = require('./config/db');
const { checkSessionExpiry, setNoCacheHeaders } = require('./middleware/auth');

const app = express();

// Trust reverse proxy (Render.com, AWS, Nginx) so HTTPS and cookies work properly in production
app.set('trust proxy', 1);

// EJS + layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Self-Healing Image Restoration Middleware
// Ensures uploaded gallery photos and student photos persist permanently across cloud container redeployments
app.get('/uploads/gallery/:filename', async (req, res, next) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public/uploads/gallery', filename);

  if (fs.existsSync(filePath)) {
    return next();
  }

  try {
    const [rows] = await db.query('SELECT image_data, mime_type FROM gallery WHERE image_path = ?', [filename]);
    if (rows.length && rows[0].image_data) {
      const buffer = Buffer.from(rows[0].image_data, 'base64');
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, buffer);
      } catch (wErr) {}
      res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.end(buffer);
    }
  } catch (err) {
    console.error('Self-healing gallery image error:', err.message);
  }
  next();
});

app.get('/uploads/students/:filename', async (req, res, next) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public/uploads/students', filename);

  if (fs.existsSync(filePath)) {
    return next();
  }

  try {
    const [rows] = await db.query('SELECT photo_data, photo_mime FROM users WHERE profile_photo = ?', [filename]);
    if (rows.length && rows[0].photo_data) {
      const buffer = Buffer.from(rows[0].photo_data, 'base64');
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, buffer);
      } catch (wErr) {}
      res.setHeader('Content-Type', rows[0].photo_mime || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.end(buffer);
    }
  } catch (err) {
    console.error('Self-healing student photo error:', err.message);
  }
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override
app.use(methodOverride('_method'));

// Session Security Configuration
const SESSION_NAME = process.env.SESSION_NAME || 'schoolerp.sid';
const maxCookieHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_TEACHER_HOURS) || 12;

app.use(session({
  name: SESSION_NAME,
  secret: process.env.SESSION_SECRET || 'schoolerp_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax',
    maxAge: maxCookieHours * 60 * 60 * 1000
  }
}));

// Flash
app.use(flash());

// Global Server-Side Session Expiry Check (Inactivity & Absolute Limits)
app.use(checkSessionExpiry);

const { getSettingsSync } = require('./utils/settingsHelper');

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.session ? (req.session.user || null) : null;
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.sessionTimeoutMinutes = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES, 10) || 15;

  // School branding & settings — dynamic from database with fallbacks
  const settings = getSettingsSync();
  res.locals.schoolSettings = settings;
  res.locals.schoolName = settings.school_name || (process.env.SCHOOL_NAME && process.env.SCHOOL_NAME !== 'School ERP' ? process.env.SCHOOL_NAME : 'Shri Amrit Lal Smarak School And College');
  res.locals.schoolAddress = settings.school_address || process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  res.locals.schoolPhone = settings.school_phone || process.env.SCHOOL_PHONE || '9129914501';
  res.locals.academicYear = settings.academic_year || '2026-27';
  res.locals.currencySymbol = settings.currency_symbol || 'Rs.';
  res.locals.developedBy = (process.env.DEVELOPED_BY && process.env.DEVELOPED_BY.replace(/^Developed by\s+/i, '').replace(/^Er\.\s*/i, '').trim()) || 'Puneet Singh';
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/admin', setNoCacheHeaders, require('./routes/admin'));
app.use('/teacher', setNoCacheHeaders, require('./routes/teacher'));
app.use('/student', setNoCacheHeaders, require('./routes/student'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { layout: 'layouts/main', title: '404 - Page Not Found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏫 School ERP running at http://localhost:${PORT}\n`);
});
