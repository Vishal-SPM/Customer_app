const express  = require('express');
const router   = express.Router();
const pool     = require('../db/pool');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { JWT_SECRET, requireLogin } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

  const user = rows[0];
  if (!user.is_active) return res.status(403).json({ error: 'Account is inactive' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid email or password' });

  const { rows: permRows } = await pool.query(
    'SELECT permission FROM user_permissions WHERE user_id=$1', [user.id]
  );

  const payload = {
    id:            user.id,
    name:          user.name,
    email:         user.email,
    is_superadmin: user.is_superadmin,
    user_type:     user.user_type     || 'internal',
    all_programs:  user.is_superadmin ? true : (user.all_programs !== false),
    permissions:   user.is_superadmin ? ['*'] : permRows.map(r => r.permission)
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, user: payload });
});

// GET /api/auth/me
router.get('/me', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, email, is_superadmin, is_active, user_type, all_programs FROM users WHERE id=$1', [req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'User not found' });

  const user = rows[0];
  const { rows: permRows } = await pool.query(
    'SELECT permission FROM user_permissions WHERE user_id=$1', [user.id]
  );
  const permissions = user.is_superadmin ? ['*'] : permRows.map(r => r.permission);
  res.json({ ...user, permissions });
});

module.exports = router;
