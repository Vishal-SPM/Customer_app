const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { requireLogin } = require('../middleware/auth');

function requireSuperadmin(req, res, next) {
  requireLogin(req, res, () => {
    if (!req.user.is_superadmin) return res.status(403).json({ error: 'Superadmin access required' });
    next();
  });
}

// GET /api/admin/users
router.get('/users', requireSuperadmin, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, email, is_superadmin, is_active, user_type, all_programs, created_at
    FROM users ORDER BY created_at ASC
  `);
  res.json(rows);
});

// POST /api/admin/users
router.post('/users', requireSuperadmin, async (req, res) => {
  const { name, email, password, user_type, all_programs, program_ids } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }

  const type        = user_type === 'external' ? 'external' : 'internal';
  const allProgs    = type === 'external' ? false : (all_programs !== false && all_programs !== 'false');
  const progIds     = Array.isArray(program_ids) ? program_ids : [];

  if (type === 'external' && progIds.length === 0) {
    return res.status(400).json({ error: 'External users must be assigned at least one program' });
  }

  const hash   = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      INSERT INTO users (id, name, email, password_hash, user_type, all_programs, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, name, email, is_superadmin, is_active, user_type, all_programs, created_at
    `, [uuid(), name, email.toLowerCase().trim(), hash, type, allProgs, req.user.id]);

    const userId = rows[0].id;
    if (!allProgs && progIds.length > 0) {
      for (const pid of progIds) {
        await client.query(
          'INSERT INTO user_programs (user_id, program_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [userId, pid]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], program_ids: allProgs ? [] : progIds });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', requireSuperadmin, async (req, res) => {
  const { name, is_active } = req.body;
  const { rows } = await pool.query(`
    UPDATE users SET
      name      = COALESCE($1, name),
      is_active = COALESCE($2, is_active)
    WHERE id=$3 AND is_superadmin=FALSE
    RETURNING id, name, email, is_superadmin, is_active, user_type, all_programs, created_at
  `, [name || null, is_active !== undefined ? is_active : null, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found or cannot modify superadmin' });
  res.json(rows[0]);
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', requireSuperadmin, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(`
    UPDATE users SET password_hash=$1 WHERE id=$2 AND is_superadmin=FALSE
    RETURNING id, name, email
  `, [hash, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found or cannot modify superadmin' });
  res.json({ message: 'Password reset successfully', user: rows[0] });
});

// GET /api/admin/users/:id/permissions
router.get('/users/:id/permissions', requireSuperadmin, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT permission FROM user_permissions WHERE user_id=$1 ORDER BY permission', [req.params.id]
  );
  res.json(rows.map(r => r.permission));
});

// PUT /api/admin/users/:id/permissions
router.put('/users/:id/permissions', requireSuperadmin, async (req, res) => {
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be an array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_permissions WHERE user_id=$1', [req.params.id]);
    for (const perm of permissions) {
      await client.query(
        'INSERT INTO user_permissions (user_id, permission) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, perm]
      );
    }
    await client.query('COMMIT');
    res.json({ message: 'Permissions updated', permissions });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/admin/users/:id/programs
router.get('/users/:id/programs', requireSuperadmin, async (req, res) => {
  const { rows: userRows } = await pool.query(
    'SELECT all_programs FROM users WHERE id=$1', [req.params.id]
  );
  if (!userRows.length) return res.status(404).json({ error: 'User not found' });

  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.code_prefix FROM programs p
    JOIN user_programs up ON up.program_id = p.id
    WHERE up.user_id=$1 ORDER BY p.name
  `, [req.params.id]);

  res.json({ all_programs: userRows[0].all_programs, programs: rows });
});

// PUT /api/admin/users/:id/programs
router.put('/users/:id/programs', requireSuperadmin, async (req, res) => {
  const { all_programs, program_ids } = req.body;
  if (typeof all_programs !== 'boolean') return res.status(400).json({ error: 'all_programs (boolean) is required' });
  if (!all_programs && (!Array.isArray(program_ids) || program_ids.length === 0)) {
    return res.status(400).json({ error: 'program_ids required when all_programs is false' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET all_programs=$1 WHERE id=$2 AND is_superadmin=FALSE', [all_programs, req.params.id]);
    await client.query('DELETE FROM user_programs WHERE user_id=$1', [req.params.id]);
    if (!all_programs) {
      for (const pid of program_ids) {
        await client.query(
          'INSERT INTO user_programs (user_id, program_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [req.params.id, pid]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ message: 'Program access updated', all_programs, program_ids: all_programs ? [] : program_ids });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
