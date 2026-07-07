const express = require('express');
const router  = express.Router({ mergeParams: true });
const pool    = require('../db/pool');
const { requirePermission } = require('../middleware/auth');

// GET /api/programs/:program_id/outlets
// Returns outlets mapped to this program, grouped by outlet, with per-service pricing
router.get('/', requirePermission('programs:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      o.id AS outlet_id, o.name AS outlet_name,
      s.name AS site_name, s.iata_code,
      v.name AS vendor_name,
      pos.service_id, svc.name AS service_name,
      os.walking_price, pos.price AS program_price
    FROM program_outlet_services pos
    JOIN outlets o   ON o.id   = pos.outlet_id
    JOIN sites s     ON s.id   = o.site_id
    LEFT JOIN vendors v ON v.id = o.vendor_id
    JOIN services svc ON svc.id = pos.service_id
    LEFT JOIN outlet_services os
      ON os.outlet_id = pos.outlet_id AND os.service_id = pos.service_id
    WHERE pos.program_id = $1
    ORDER BY o.name, svc.name
  `, [req.params.program_id]);

  // Group by outlet
  const map = {};
  for (const r of rows) {
    if (!map[r.outlet_id]) {
      map[r.outlet_id] = {
        outlet_id: r.outlet_id, outlet_name: r.outlet_name,
        site_name: r.site_name, iata_code: r.iata_code,
        vendor_name: r.vendor_name, services: []
      };
    }
    map[r.outlet_id].services.push({
      service_id: r.service_id, service_name: r.service_name,
      walking_price: parseFloat(r.walking_price) || 0,
      program_price: parseFloat(r.program_price)
    });
  }
  res.json(Object.values(map));
});

// GET /api/programs/:program_id/outlets/pricing-template?outlet_id=xxx
// Intersection of program services and outlet services, excluding already-mapped services
router.get('/pricing-template', requirePermission('programs:view'), async (req, res) => {
  const { outlet_id } = req.query;
  if (!outlet_id) return res.status(400).json({ error: 'outlet_id required' });

  const { rows: svcRows } = await pool.query(`
    SELECT svc.id AS service_id, svc.name AS service_name, os.walking_price,
           EXISTS(
             SELECT 1 FROM program_outlet_services pos
             WHERE pos.program_id=$1 AND pos.outlet_id=$2 AND pos.service_id=svc.id
           ) AS already_mapped
    FROM program_services ps
    JOIN outlet_services os ON os.service_id = ps.service_id AND os.outlet_id = $2
    JOIN services svc ON svc.id = ps.service_id
    WHERE ps.program_id = $1
    ORDER BY svc.name
  `, [req.params.program_id, outlet_id]);

  const { rows: outletRows } = await pool.query('SELECT name FROM outlets WHERE id=$1', [outlet_id]);
  res.json({
    outlet_id,
    outlet_name: outletRows[0]?.name,
    services: svcRows
  });
});

// GET /api/programs/:program_id/outlets/group-pricing-template?outlet_group_id=xxx
// For a group: returns outlets clustered by their service combination (intersection with program)
router.get('/group-pricing-template', requirePermission('programs:view'), async (req, res) => {
  const { outlet_group_id } = req.query;
  if (!outlet_group_id) return res.status(400).json({ error: 'outlet_group_id required' });

  // All outlets in the group with their intersecting services
  const { rows } = await pool.query(`
    SELECT o.id AS outlet_id, o.name AS outlet_name,
           svc.id AS service_id, svc.name AS service_name, os.walking_price
    FROM outlet_group_members ogm
    JOIN outlets o ON o.id = ogm.outlet_id
    JOIN program_services ps ON ps.program_id = $1
    JOIN outlet_services os ON os.outlet_id = o.id AND os.service_id = ps.service_id
    JOIN services svc ON svc.id = ps.service_id
    WHERE ogm.outlet_group_id = $2
      AND NOT EXISTS (
        SELECT 1 FROM program_outlet_services pos
        WHERE pos.program_id=$1 AND pos.outlet_id=o.id AND pos.service_id=ps.service_id
      )
    ORDER BY o.name, svc.name
  `, [req.params.program_id, outlet_group_id]);

  if (!rows.length) {
    return res.json({ clusters: [], already_fully_mapped: true });
  }

  // Build per-outlet service lists, then cluster outlets with identical service sets
  const outletMap = {};
  for (const r of rows) {
    if (!outletMap[r.outlet_id]) outletMap[r.outlet_id] = { outlet_id: r.outlet_id, outlet_name: r.outlet_name, services: [] };
    outletMap[r.outlet_id].services.push({ service_id: r.service_id, service_name: r.service_name, walking_price: parseFloat(r.walking_price) || 0 });
  }

  // Cluster by sorted service_id signature
  const clusterMap = {};
  for (const outlet of Object.values(outletMap)) {
    const key = outlet.services.map(s => s.service_id).sort().join(',');
    if (!clusterMap[key]) clusterMap[key] = { services: outlet.services, outlets: [] };
    clusterMap[key].outlets.push({ outlet_id: outlet.outlet_id, outlet_name: outlet.outlet_name });
  }

  res.json({ clusters: Object.values(clusterMap) });
});

// POST /api/programs/:program_id/outlets — add single outlet with per-service prices
router.post('/', requirePermission('programs:edit'), async (req, res) => {
  const { outlet_id, services } = req.body;
  // services: [{ service_id, price }]
  if (!outlet_id || !Array.isArray(services) || !services.length) {
    return res.status(400).json({ error: 'outlet_id and services[] required' });
  }
  for (const s of services) {
    if (s.price === null || s.price === undefined || s.price === '') {
      return res.status(400).json({ error: 'Price is required for every service' });
    }
  }

  // Validate services are in both program and outlet
  const { rows: valid } = await pool.query(`
    SELECT ps.service_id
    FROM program_services ps
    JOIN outlet_services os ON os.service_id = ps.service_id AND os.outlet_id = $2
    WHERE ps.program_id = $1
  `, [req.params.program_id, outlet_id]);
  const validIds = new Set(valid.map(r => r.service_id));
  const submitted = new Set(services.map(s => s.service_id));
  for (const id of validIds) {
    if (!submitted.has(id)) return res.status(400).json({ error: 'Price required for all eligible services at this outlet' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of services) {
      if (!validIds.has(s.service_id)) continue;
      await client.query(
        `INSERT INTO program_outlet_services (program_id, outlet_id, service_id, price)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (program_id, outlet_id, service_id) DO UPDATE SET price = EXCLUDED.price`,
        [req.params.program_id, outlet_id, s.service_id, s.price]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/programs/:program_id/outlets/groups — bulk add outlet group
// Body: { outlet_group_id, clusters: [{ service_ids: [], outlets: [outlet_id], prices: { service_id: price } }] }
router.post('/groups', requirePermission('programs:edit'), async (req, res) => {
  const { outlet_group_id, clusters } = req.body;
  if (!outlet_group_id || !Array.isArray(clusters)) {
    return res.status(400).json({ error: 'outlet_group_id and clusters[] required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let total = 0;
    for (const cluster of clusters) {
      for (const outlet_id of cluster.outlet_ids) {
        for (const [service_id, price] of Object.entries(cluster.prices)) {
          if (price === null || price === undefined || price === '') {
            throw new Error('Price required for all services');
          }
          await client.query(
            `INSERT INTO program_outlet_services (program_id, outlet_id, service_id, price)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (program_id, outlet_id, service_id) DO UPDATE SET price = EXCLUDED.price`,
            [req.params.program_id, outlet_id, service_id, price]
          );
          total++;
        }
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, rows_created: total });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/programs/:program_id/outlets/:outlet_id/services/:service_id — edit price
router.patch('/:outlet_id/services/:service_id', requirePermission('programs:edit'), async (req, res) => {
  const { price } = req.body;
  if (price === null || price === undefined || price === '') {
    return res.status(400).json({ error: 'price is required' });
  }
  const { rows } = await pool.query(
    `UPDATE program_outlet_services SET price=$1
     WHERE program_id=$2 AND outlet_id=$3 AND service_id=$4 RETURNING *`,
    [price, req.params.program_id, req.params.outlet_id, req.params.service_id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Mapping not found' });
  res.json(rows[0]);
});

// DELETE /api/programs/:program_id/outlets/:outlet_id — remove outlet from program
router.delete('/:outlet_id', requirePermission('programs:edit'), async (req, res) => {
  await pool.query(
    'DELETE FROM program_outlet_services WHERE program_id=$1 AND outlet_id=$2',
    [req.params.program_id, req.params.outlet_id]
  );
  res.json({ success: true });
});

module.exports = router;
