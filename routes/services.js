const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('services:create'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO services (id,name,description) VALUES ($1,$2,$3) RETURNING *',
    [uuid(), name, description || null]
  );
  res.status(201).json(rows[0]);
});

router.get('/', requirePermission('services:view'), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM services ORDER BY name');
  res.json(rows);
});

router.get('/:id', requirePermission('services:view'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM services WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Service not found' });
  res.json(rows[0]);
});

module.exports = router;
