const prisma = require('../config/prisma');
const { verifyToken } = require('../utils/token');

// Checks the Bearer token and loads the user from the database
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');

    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Please log in to continue' });
    }

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });

    if (!user) {
      return res.status(401).json({ message: 'Account no longer exists' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Your session is invalid or has expired' });
  }
}

// Usage: requireRole('ADMIN')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
