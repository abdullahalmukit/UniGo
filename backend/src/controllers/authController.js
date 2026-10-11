const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../config/prisma');
const { createToken, safeUser } = require('../utils/token');

const googleClient = new OAuth2Client();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- Manual registration ----------
async function register(req, res) {
  try {
    const { fullName, email, password, universityName } = req.body;

    // Only these four fields are read, so nobody can send a role
    if (!fullName?.trim() || !email?.trim() || !password || !universityName?.trim()) {
      return res.status(400).json({ message: 'Full name, email, password and university name are required' });
    }
    if (!emailPattern.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: cleanEmail,
        passwordHash,
        universityName: universityName.trim(),
        // role defaults to USER in the schema
      },
    });

    res.status(201).json({ token: createToken(user), user: safeUser(user) });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again' });
  }
}

// ---------- Manual login ----------
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    // Same message for "no user", "Google-only user" and "wrong password"
    const genericError = { message: 'Incorrect email or password' };

    if (!user || !user.passwordHash) {
      return res.status(401).json(genericError);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json(genericError);
    }

    res.json({ token: createToken(user), user: safeUser(user) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again' });
  }
}

// ---------- Google login / registration ----------
async function googleAuth(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: 'Google ID token is required' });
    }

    // Verify the token with Google. We never trust profile data sent by the app.
    const allowedClientIds = (process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: allowedClientIds });
      payload = ticket.getPayload();
    } catch (error) {
      return res.status(401).json({ message: 'Google sign-in could not be verified' });
    }

    // Only accept emails that Google has verified
    if (!payload.email || !payload.email_verified) {
      return res.status(401).json({ message: 'Your Google email is not verified' });
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

    // 1. Returning Google user
    let user = await prisma.user.findUnique({ where: { googleId } });

    // 2. Same verified email already registered manually -> link the accounts
    if (!user) {
      const sameEmailUser = await prisma.user.findUnique({ where: { email } });

      if (sameEmailUser) {
        user = await prisma.user.update({
          where: { id: sameEmailUser.id },
          data: {
            googleId,
            emailVerified: true,
            avatarUrl: sameEmailUser.avatarUrl || payload.picture || null,
            // Manual sign-ups never proved they own this email. If someone else
            // registered it first, removing the old password stops them from
            // keeping access. The real owner can set a new password later.
            ...(sameEmailUser.emailVerified ? {} : { passwordHash: null }),
          },
        });
      }
    }

    // 3. Brand new user
    if (!user) {
      user = await prisma.user.create({
        data: {
          fullName: payload.name || email.split('@')[0],
          email,
          googleId,
          avatarUrl: payload.picture || null,
          emailVerified: true,
          // role = USER and universityVerified = false by default
        },
      });
    }

    res.json({ token: createToken(user), user: safeUser(user) });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ message: 'Something went wrong. Please try again' });
  }
}

// ---------- Current user ----------
function me(req, res) {
  res.json({ user: safeUser(req.user) });
}

// ---------- Logout ----------
// JWTs are stateless, so the server has nothing to delete.
// The app removes the token. See README for the limitations.
function logout(req, res) {
  res.json({ message: 'Logged out. Please remove the token on your device' });
}

module.exports = { register, login, googleAuth, me, logout };
