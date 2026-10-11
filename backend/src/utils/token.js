const jwt = require('jsonwebtoken');

function createToken(user) {
  return jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// Only send fields that are safe for the client to see
function safeUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    universityName: user.universityName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    emailVerified: user.emailVerified,
    universityVerified: user.universityVerified,
    hasPassword: Boolean(user.passwordHash),
    hasGoogle: Boolean(user.googleId),
    createdAt: user.createdAt,
  };
}

module.exports = { createToken, verifyToken, safeUser };
