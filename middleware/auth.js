// Authentication middleware
exports.isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error_msg', 'Please login to continue');
  res.redirect('/login');
};

exports.isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error_msg', 'Access denied. Administrator login required.');
  res.redirect('/login/admin');
};

exports.isTeacher = (req, res, next) => {
  if (req.session.user && (req.session.user.role === 'teacher' || req.session.user.role === 'admin')) return next();
  req.flash('error_msg', 'Access denied. Teacher login required.');
  res.redirect('/login/teacher');
};

exports.isStudent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'student') return next();
  req.flash('error_msg', 'Access denied. Student login required.');
  res.redirect('/login/student');
};

