const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('clients:create'), async (req, res) => {
  const { name, logo_url } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(
    'INSERT INTO clients (id, name, logo_url) VALUES ($1,$2,$3) RETURNING *',
    [uuid(), name, logo_url || null]
  );
  res.status(201).json(rows[0]);
});

router.get('/', requirePermission('clients:view'), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
  res.json(rows);
});

router.get('/:id', requirePermission('clients:view'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Client not found' });
  res.json(rows[0]);
});

router.patch('/:id', requirePermission('clients:edit'), async (req, res) => {
  const { name, logo_url } = req.body;
  const { rows } = await pool.query(
    'UPDATE clients SET name=COALESCE($1,name), logo_url=COALESCE($2,logo_url) WHERE id=$3 RETURNING *',
    [name || null, logo_url || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Client not found' });
  res.json(rows[0]);
});

module.exports = router;
