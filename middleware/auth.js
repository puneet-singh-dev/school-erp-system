// Authentication middleware
exports.isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error_msg', 'Please login to continue');
  res.redirect('/login');
};

exports.isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error_msg', 'Access denied. Admin only.');
  res.redirect('/login');
};

exports.isTeacher = (req, res, next) => {
  if (req.session.user && (req.session.user.role === 'teacher' || req.session.user.role === 'admin')) return next();
  req.flash('error_msg', 'Access denied.');
  res.redirect('/login');
};

exports.isStudent = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'student') return next();
  req.flash('error_msg', 'Access denied.');
  res.redirect('/login');
};
