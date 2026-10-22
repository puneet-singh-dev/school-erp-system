const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

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

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.session ? (req.session.user || null) : null;
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.sessionTimeoutMinutes = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES, 10) || 15;

  // School branding — available in all views
  res.locals.schoolName = (process.env.SCHOOL_NAME && process.env.SCHOOL_NAME !== 'School ERP')
    ? process.env.SCHOOL_NAME
    : 'Shri Amrit Lal Smarak School And College';
  res.locals.schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  res.locals.schoolPhone = process.env.SCHOOL_PHONE || '9129914501';
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
