const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

// GET /api/outlet-groups
router.get('/', requirePermission('outlets:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT og.*, COUNT(ogm.outlet_id)::int AS outlet_count
    FROM outlet_groups og
    LEFT JOIN outlet_group_members ogm ON ogm.outlet_group_id = og.id
    GROUP BY og.id
    ORDER BY og.name
  `);
  res.json(rows);
});

// POST /api/outlet-groups
router.post('/', requirePermission('outlets:create'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuid();
  const { rows } = await pool.query(
    'INSERT INTO outlet_groups (id, name, description) VALUES ($1,$2,$3) RETURNING *',
    [id, name, description || null]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/outlet-groups/:id
router.patch('/:id', requirePermission('outlets:edit'), async (req, res) => {
  const { name, description } = req.body;
  const { rows } = await pool.query(
    `UPDATE outlet_groups SET
       name        = COALESCE($1, name),
       description = COALESCE($2, description)
     WHERE id=$3 RETURNING *`,
    [name || null, description !== undefined ? description : null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE /api/outlet-groups/:id
router.delete('/:id', requirePermission('outlets:delete'), async (req, res) => {
  await pool.query('DELETE FROM outlet_groups WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// GET /api/outlet-groups/:id/outlets
router.get('/:id/outlets', requirePermission('outlets:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.id, o.name, s.name AS site_name, s.iata_code, v.name AS vendor_name,
           COALESCE(
             json_agg(
               json_build_object('service_id', sv.id, 'service_name', sv.name, 'walking_price', os.walking_price)
             ) FILTER (WHERE sv.id IS NOT NULL), '[]'
           ) AS services
    FROM outlet_group_members ogm
    JOIN outlets o ON o.id = ogm.outlet_id
    JOIN sites s   ON s.id = o.site_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    LEFT JOIN outlet_services os ON os.outlet_id = o.id
    LEFT JOIN services sv ON sv.id = os.service_id
    WHERE ogm.outlet_group_id = $1
    GROUP BY o.id, o.name, s.name, s.iata_code, v.name
    ORDER BY o.name
  `, [req.params.id]);
  res.json(rows);
});

// POST /api/outlet-groups/:id/outlets
router.post('/:id/outlets', requirePermission('outlets:edit'), async (req, res) => {
  const { outlet_id } = req.body;
  if (!outlet_id) return res.status(400).json({ error: 'outlet_id required' });
  await pool.query(
    'INSERT INTO outlet_group_members (outlet_group_id, outlet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, outlet_id]
  );
  res.json({ success: true });
});

// DELETE /api/outlet-groups/:id/outlets/:outlet_id
router.delete('/:id/outlets/:outlet_id', requirePermission('outlets:edit'), async (req, res) => {
  await pool.query(
    'DELETE FROM outlet_group_members WHERE outlet_group_id=$1 AND outlet_id=$2',
    [req.params.id, req.params.outlet_id]
  );
  res.json({ success: true });
});

module.exports = router;
