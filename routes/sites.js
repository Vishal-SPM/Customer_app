const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

router.post('/', requirePermission('sites:create'), async (req, res) => {
  const { name, iata_code, city, country } = req.body;
  if (!name || !iata_code) return res.status(400).json({ error: 'name and iata_code are required' });
  const { rows } = await pool.query(
    'INSERT INTO sites (id,name,iata_code,city,country) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [uuid(), name, iata_code.toUpperCase(), city || null, country || 'India']
  );
  res.status(201).json(rows[0]);
});

router.get('/', requirePermission('sites:view'), async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM sites ORDER BY name');
  res.json(rows);
});

router.get('/:id', requirePermission('sites:view'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sites WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Site not found' });
  res.json(rows[0]);
});

router.patch('/:id', requirePermission('sites:edit'), async (req, res) => {
  const { name, city, country } = req.body;
  const { rows } = await pool.query(
    'UPDATE sites SET name=COALESCE($1,name), city=COALESCE($2,city), country=COALESCE($3,country) WHERE id=$4 RETURNING *',
    [name || null, city || null, country || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Site not found' });
  res.json(rows[0]);
});

module.exports = router;
