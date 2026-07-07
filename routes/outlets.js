const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

// POST /api/outlets
router.post('/', requirePermission('outlets:create'), async (req, res) => {
  const { site_id, vendor_id, name, terminal_type, terminal_name, gate_type,
          direction, amenities, requires_boarding_pass, services } = req.body;
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = uuid();
    const { rows } = await client.query(`
      INSERT INTO outlets (id, site_id, vendor_id, name, terminal_type, terminal_name, gate_type, direction, amenities, requires_boarding_pass)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [id, site_id, vendor_id || null, name, terminal_type || null, terminal_name || null,
        gate_type || null, direction || null, amenities || [], !!requires_boarding_pass]);

    // services: [{ service_id, walking_price }]
    if (services?.length) {
      for (const s of services) {
        await client.query(
          `INSERT INTO outlet_services (outlet_id, service_id, walking_price)
           VALUES ($1,$2,$3) ON CONFLICT (outlet_id, service_id) DO UPDATE SET walking_price = EXCLUDED.walking_price`,
          [id, s.service_id, s.walking_price ?? 0]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// GET /api/outlets
router.get('/', requirePermission('outlets:view'), async (req, res) => {
  const { site_id } = req.query;
  const { rows } = await pool.query(`
    SELECT o.*, s.name AS site_name, s.iata_code, v.name AS vendor_name,
           COALESCE(
             json_agg(
               json_build_object('id', sv.id, 'name', sv.name, 'walking_price', os.walking_price)
             ) FILTER (WHERE sv.id IS NOT NULL), '[]'
           ) AS services
    FROM outlets o
    JOIN sites s ON s.id = o.site_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    LEFT JOIN outlet_services os ON os.outlet_id = o.id
    LEFT JOIN services sv ON sv.id = os.service_id
    ${site_id ? 'WHERE o.site_id = $1' : ''}
    GROUP BY o.id, s.name, s.iata_code, v.name
    ORDER BY s.name, o.name
  `, site_id ? [site_id] : []);
  res.json(rows);
});

// GET /api/outlets/:id
router.get('/:id', requirePermission('outlets:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, s.name AS site_name, s.iata_code, v.name AS vendor_name,
           COALESCE(
             json_agg(
               json_build_object('id', sv.id, 'name', sv.name, 'walking_price', os.walking_price)
             ) FILTER (WHERE sv.id IS NOT NULL), '[]'
           ) AS services
    FROM outlets o
    JOIN sites s ON s.id = o.site_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    LEFT JOIN outlet_services os ON os.outlet_id = o.id
    LEFT JOIN services sv ON sv.id = os.service_id
    WHERE o.id = $1
    GROUP BY o.id, s.name, s.iata_code, v.name
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Outlet not found' });
  res.json(rows[0]);
});

// PATCH /api/outlets/:id
router.patch('/:id', requirePermission('outlets:edit'), async (req, res) => {
  const { name, vendor_id, terminal_type, terminal_name, gate_type,
          direction, amenities, requires_boarding_pass } = req.body;
  const { rows } = await pool.query(`
    UPDATE outlets SET
      name                   = COALESCE($1, name),
      vendor_id              = COALESCE($2, vendor_id),
      terminal_type          = COALESCE($3, terminal_type),
      terminal_name          = COALESCE($4, terminal_name),
      gate_type              = COALESCE($5, gate_type),
      direction              = COALESCE($6, direction),
      amenities              = COALESCE($7, amenities),
      requires_boarding_pass = COALESCE($8, requires_boarding_pass)
    WHERE id=$9 RETURNING *
  `, [name||null, vendor_id||null, terminal_type||null, terminal_name||null,
      gate_type||null, direction||null,
      amenities !== undefined ? amenities : null,
      requires_boarding_pass !== undefined ? requires_boarding_pass : null,
      req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Outlet not found' });
  res.json(rows[0]);
});

// GET /api/outlets/:id/services
router.get('/:id/services', requirePermission('outlets:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sv.id AS service_id, sv.name AS service_name, os.walking_price
    FROM outlet_services os
    JOIN services sv ON sv.id = os.service_id
    WHERE os.outlet_id = $1
    ORDER BY sv.name
  `, [req.params.id]);
  res.json(rows);
});

// PUT /api/outlets/:id/services — full replace
router.put('/:id/services', requirePermission('outlets:edit'), async (req, res) => {
  const { services } = req.body; // [{ service_id, walking_price }]
  if (!Array.isArray(services)) return res.status(400).json({ error: 'services[] required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM outlet_services WHERE outlet_id=$1', [req.params.id]);
    for (const s of services) {
      await client.query(
        `INSERT INTO outlet_services (outlet_id, service_id, walking_price) VALUES ($1,$2,$3)`,
        [req.params.id, s.service_id, s.walking_price ?? 0]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, count: services.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
