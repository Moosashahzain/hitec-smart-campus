// Auth + role middleware. Roles: super_admin, principal, attendance_admin, teacher, student, parent
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.session && req.session.user;
    if (!u) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
      return res.redirect('/login');
    }
    if (u.status !== 'active') return res.status(403).send('Account is not active.');
    if (!roles.includes(u.role)) return res.status(403).send('Not authorized for this area.');
    next();
  };
}

const MANAGEMENT = ['super_admin', 'principal', 'attendance_admin'];
const requireManagement = requireRole(...MANAGEMENT);

// Scope helpers — enforce ownership at the data layer (never rely on UI alone)
function studentScope(req) {
  // returns the student.id the logged-in student may access, or null
  const u = req.session.user;
  if (u.role !== 'student') return null;
  return u.student_id || null;
}

module.exports = { requireLogin, requireRole, requireManagement, MANAGEMENT, studentScope };
