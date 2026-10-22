// Session & Authentication Middleware

/**
 * Get configured session timeout limits (in milliseconds)
 */
function getTimeoutLimits(role) {
  const inactivityMinutes = parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_MINUTES, 10) || 15;
  const inactivityMs = inactivityMinutes * 60 * 1000;

  const adminHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_ADMIN_HOURS) || 8;
  const teacherHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_TEACHER_HOURS) || 12;
  const studentHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_STUDENT_HOURS) || 12;
  const defaultHours = parseFloat(process.env.SESSION_ABSOLUTE_TIMEOUT_DEFAULT_HOURS) || 8;

  let absoluteHours = defaultHours;
  if (role === 'admin') absoluteHours = adminHours;
  else if (role === 'teacher') absoluteHours = teacherHours;
  else if (role === 'student') absoluteHours = studentHours;

  const absoluteMs = absoluteHours * 60 * 60 * 1000;

  return {
    inactivityMinutes,
    inactivityMs,
    absoluteHours,
    absoluteMs
  };
}

/**
 * Helper to check whether a request is an AJAX or JSON API request
 */
function isAjaxOrApi(req) {
  return Boolean(
    req.xhr ||
    (req.path && req.path.startsWith('/api')) ||
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    req.headers['x-requested-with'] === 'XMLHttpRequest'
  );
}

/**
 * Helper to clear all session cookies from browser
 */
function clearSessionCookies(res) {
  const cookieName = process.env.SESSION_NAME || 'schoolerp.sid';
  res.clearCookie(cookieName, { path: '/' });
  res.clearCookie('connect.sid', { path: '/' });
}

/**
 * Prevent browser Back/Forward caching of protected pages
 */
function setNoCacheHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  if (next) next();
}

/**
 * Global Session Expiration Middleware
 * Enforces server-side inactivity (15 mins) and absolute lifetime (8 hrs for Admin)
 */
function checkSessionExpiry(req, res, next) {
  if (!req.session || !req.session.user) {
    return next();
  }

  const now = Date.now();
  const user = req.session.user;
  const role = user.role || 'user';
  const limits = getTimeoutLimits(role);

  // Fallbacks if not set on login
  const createdAt = req.session.createdAt || now;
  const lastActivity = req.session.lastActivity || createdAt;

  const inactiveElapsed = now - lastActivity;
  const absoluteElapsed = now - createdAt;

  const isInactiveExpired = inactiveElapsed > limits.inactivityMs;
  const isAbsoluteExpired = absoluteElapsed > limits.absoluteMs;

  if (isInactiveExpired || isAbsoluteExpired) {
    const isAbsolute = isAbsoluteExpired;
    const reason = isAbsolute ? 'absolute' : 'inactivity';

    let message;
    if (reason === 'inactivity') {
      message = `Your session has expired due to ${limits.inactivityMinutes} minutes of inactivity. Please log in again to continue.`;
    } else if (role === 'admin') {
      message = `Your administrator session has reached its ${limits.absoluteHours}-hour maximum lifetime limit. Please log in again for security.`;
    } else {
      message = `Your session has reached its maximum allowable duration of ${limits.absoluteHours} hours. Please log in again to continue.`;
    }

    const redirectPath = role ? `/login/${role}?reason=${reason}` : `/login?reason=${reason}`;

    // Clear client-side authentication cookies immediately
    clearSessionCookies(res);

    // Destroy server-side session completely
    return req.session.destroy((err) => {
      if (err) console.error('Error destroying expired session:', err);

      if (isAjaxOrApi(req)) {
        return res.status(401).json({
          success: false,
          expired: true,
          reason,
          message,
          redirectUrl: redirectPath
        });
      }

      return res.redirect(redirectPath);
    });
  }

  // Session is active and valid: update last activity timestamp
  req.session.lastActivity = now;
  next();
}

// Route Guards
exports.isAuthenticated = (req, res, next) => {
  setNoCacheHeaders(req, res);
  if (req.session && req.session.user) return next();

  if (isAjaxOrApi(req)) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please log in.',
      redirectUrl: '/login'
    });
  }

  req.flash('error_msg', 'Please login to continue.');
  res.redirect('/login');
};

exports.isAdmin = (req, res, next) => {
  setNoCacheHeaders(req, res);
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();

  if (isAjaxOrApi(req)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Administrator privileges required.',
      redirectUrl: '/login/admin'
    });
  }

  req.flash('error_msg', 'Access denied. Administrator login required.');
  res.redirect('/login/admin');
};

exports.isTeacher = (req, res, next) => {
  setNoCacheHeaders(req, res);
  if (req.session && req.session.user && (req.session.user.role === 'teacher' || req.session.user.role === 'admin')) {
    return next();
  }

  if (isAjaxOrApi(req)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Teacher login required.',
      redirectUrl: '/login/teacher'
    });
  }

  req.flash('error_msg', 'Access denied. Teacher login required.');
  res.redirect('/login/teacher');
};

exports.isStudent = (req, res, next) => {
  setNoCacheHeaders(req, res);
  if (req.session && req.session.user && req.session.user.role === 'student') return next();

  if (isAjaxOrApi(req)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Student login required.',
      redirectUrl: '/login/student'
    });
  }

  req.flash('error_msg', 'Access denied. Student login required.');
  res.redirect('/login/student');
};

// Export helper utilities and middleware
exports.checkSessionExpiry = checkSessionExpiry;
exports.setNoCacheHeaders = setNoCacheHeaders;
exports.clearSessionCookies = clearSessionCookies;
exports.getTimeoutLimits = getTimeoutLimits;
