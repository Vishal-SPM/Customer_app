const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

// POST /api/outlets
router.post('/', requirePermission('outlets:create'), async (req, res) => {
  const { site_id, vendor_id, name, terminal_type, terminal_name, gate_type, direction, amenities, requires_boarding_pass, service_ids } = req.body;
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = uuid();
    const { rows } = await client.query(`
      INSERT INTO outlets (id, site_id, vendor_id, name, terminal_type, terminal_name, gate_type, direction, amenities, requires_boarding_pass)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
    `, [id, site_id, vendor_id || null, name, terminal_type || null, terminal_name || null, gate_type || null, direction || null, amenities || [], !!requires_boarding_pass]);

    if (service_ids && service_ids.length > 0) {
      for (const sid of service_ids) {
        await client.query(
          'INSERT INTO outlet_services (outlet_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, sid]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], service_ids: service_ids || [] });
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
    SELECT o.*, s.name AS site_name, s.iata_code,
           COALESCE(json_agg(sv.name) FILTER (WHERE sv.id IS NOT NULL), '[]') AS services
    FROM outlets o
    JOIN sites s ON s.id = o.site_id
    LEFT JOIN outlet_services os ON os.outlet_id = o.id
    LEFT JOIN services sv ON sv.id = os.service_id
    ${site_id ? 'WHERE o.site_id = $1' : ''}
    GROUP BY o.id, s.name, s.iata_code
    ORDER BY s.name, o.name
  `, site_id ? [site_id] : []);
  res.json(rows);
});

// GET /api/outlets/:id
router.get('/:id', requirePermission('outlets:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT o.*, s.name AS site_name, s.iata_code,
           COALESCE(json_agg(json_build_object('id', sv.id, 'name', sv.name)) FILTER (WHERE sv.id IS NOT NULL), '[]') AS services
    FROM outlets o
    JOIN sites s ON s.id = o.site_id
    LEFT JOIN outlet_services os ON os.outlet_id = o.id
    LEFT JOIN services sv ON sv.id = os.service_id
    WHERE o.id = $1
    GROUP BY o.id, s.name, s.iata_code
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Outlet not found' });
  res.json(rows[0]);
});

// POST /api/outlets/:id/services  — map a service to outlet
router.post('/:id/services', requirePermission('outlets:edit'), async (req, res) => {
  const { service_id } = req.body;
  if (!service_id) return res.status(400).json({ error: 'service_id is required' });
  await pool.query(
    'INSERT INTO outlet_services (outlet_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.id, service_id]
  );
  res.status(201).json({ message: 'Service mapped to outlet' });
});

// DELETE /api/outlets/:id/services/:service_id
router.delete('/:id/services/:service_id', requirePermission('outlets:edit'), async (req, res) => {
  await pool.query('DELETE FROM outlet_services WHERE outlet_id=$1 AND service_id=$2', [req.params.id, req.params.service_id]);
  res.json({ message: 'Service removed from outlet' });
});

module.exports = router;
