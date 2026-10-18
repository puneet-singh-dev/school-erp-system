const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

const app = express();

// EJS + layouts
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Method override
app.use(methodOverride('_method'));

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'schoolerp_secret',
  resave: true,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true
  }
}));

// Flash
app.use(flash());

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  // School branding — available in all views
  res.locals.schoolName = (process.env.SCHOOL_NAME && process.env.SCHOOL_NAME !== 'School ERP')
    ? process.env.SCHOOL_NAME
    : 'Shri Amrit Lal Smarak School And College';
  res.locals.schoolAddress = process.env.SCHOOL_ADDRESS || 'Vijay Nagar, Karma Bazar, Prayagraj (U.P)';
  res.locals.schoolPhone = process.env.SCHOOL_PHONE || '9129914501';
  res.locals.developedBy = process.env.DEVELOPED_BY || 'Er. Puneet Singh';
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/teacher', require('./routes/teacher'));
app.use('/student', require('./routes/student'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { layout: 'layouts/main', title: '404 - Page Not Found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏫 School ERP running at http://localhost:${PORT}`);
  console.log(`📧 Admin login: admin@school.com | Password: admin123\n`);
});
