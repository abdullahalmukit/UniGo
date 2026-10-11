const express = require('express');
const prisma = require('../config/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { safeUser } = require('../utils/token');

const router = express.Router();

// Every route below needs a logged-in ADMIN
router.use(authenticate, requireRole('ADMIN'));

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ users: users.map(safeUser) });
});

module.exports = router;
