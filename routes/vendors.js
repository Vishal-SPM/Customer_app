const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

function genVendorKey() { return 'vnd_' + uuid().replace(/-/g, ''); }

// GET /api/vendors
router.get('/', requirePermission('vendors:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*,
           COUNT(o.id)::int AS outlet_count
    FROM vendors v
    LEFT JOIN outlets o ON o.vendor_id = v.id
    GROUP BY v.id
    ORDER BY v.name
  `);
  res.json(rows);
});

// POST /api/vendors
router.post('/', requirePermission('vendors:create'), async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const { rows } = await pool.query(`
    INSERT INTO vendors (id, name, email, phone, api_key)
    VALUES ($1,$2,$3,$4,$5) RETURNING *
  `, [uuid(), name, email || null, phone || null, genVendorKey()]);
  res.status(201).json({ ...rows[0], _note: 'Save api_key — used as x-api-key for validate/redeem endpoints' });
});

// PATCH /api/vendors/:id
router.patch('/:id', requirePermission('vendors:edit'), async (req, res) => {
  const { name, email, phone, is_active } = req.body;
  const { rows } = await pool.query(`
    UPDATE vendors SET
      name      = COALESCE($1, name),
      email     = COALESCE($2, email),
      phone     = COALESCE($3, phone),
      is_active = COALESCE($4, is_active)
    WHERE id=$5 RETURNING *
  `, [name || null, email || null, phone || null, is_active !== undefined ? is_active : null, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Vendor not found' });
  res.json(rows[0]);
});

// POST /api/vendors/:id/regenerate-key  — issue a fresh API key
router.post('/:id/regenerate-key', requirePermission('vendors:edit'), async (req, res) => {
  const newKey = genVendorKey();
  const { rows } = await pool.query(
    'UPDATE vendors SET api_key=$1 WHERE id=$2 RETURNING id, name, api_key',
    [newKey, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Vendor not found' });
  res.json({ message: 'API key regenerated', ...rows[0] });
});

// GET /api/vendors/:id/outlets  — outlets assigned to this vendor
router.get('/:id/outlets', requirePermission('vendors:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, s.name AS site_name, s.iata_code
    FROM outlets o
    JOIN sites s ON s.id = o.site_id
    WHERE o.vendor_id = $1
    ORDER BY s.name, o.name
  `, [req.params.id]);
  res.json(rows);
});

module.exports = router;
