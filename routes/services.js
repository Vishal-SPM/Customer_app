const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

const VALID_TYPES = ['qr', 'booking', 'discount_voucher'];

router.post('/', requirePermission('services:create'), async (req, res) => {
  const { name, description, service_type } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const stype = service_type || 'qr';
  if (!VALID_TYPES.includes(stype)) {
    return res.status(400).json({ error: `service_type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  const { rows } = await pool.query(
    'INSERT INTO services (id,name,description,service_type) VALUES ($1,$2,$3,$4) RETURNING *',
    [uuid(), name, description || null, stype]
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

router.patch('/:id', requirePermission('services:edit'), async (req, res) => {
  const { name, description, service_type } = req.body;
  if (service_type && !VALID_TYPES.includes(service_type)) {
    return res.status(400).json({ error: `service_type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  const { rows } = await pool.query(
    `UPDATE services SET
       name         = COALESCE($1, name),
       description  = COALESCE($2, description),
       service_type = COALESCE($3, service_type)
     WHERE id=$4 RETURNING *`,
    [name || null, description || null, service_type || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Service not found' });
  res.json(rows[0]);
});

module.exports = router;
