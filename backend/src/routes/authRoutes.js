const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Slows down password guessing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Too many attempts. Please try again in a few minutes' },
});

router.post('/register', loginLimiter, controller.register);
router.post('/login', loginLimiter, controller.login);
router.post('/google', loginLimiter, controller.googleAuth);
router.get('/me', authenticate, controller.me);
router.post('/logout', authenticate, controller.logout);

module.exports = router;
