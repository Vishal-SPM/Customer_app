const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { requirePermission } = require('../middleware/auth');

// ── GET /api/reports/summary ──────────────────────────────────────────────────
// Overall headline numbers + per-status breakdown, optionally filtered by date range / program
router.get('/summary', requirePermission('reports:view'), async (req, res) => {
  const { program_id, date_from, date_to } = req.query;

  const filters = [];
  const params  = [];

  if (program_id) { params.push(program_id); filters.push(`v.program_id = $${params.length}`); }
  if (date_from)  { params.push(date_from);  filters.push(`v.created_at::date >= $${params.length}`); }
  if (date_to)    { params.push(date_to);    filters.push(`v.created_at::date <= $${params.length}`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows: counts } = await pool.query(`
    SELECT
      COUNT(*)                                             AS total_issued,
      COUNT(*) FILTER (WHERE v.status = 'active')         AS total_active,
      COUNT(*) FILTER (WHERE v.status = 'redeemed')       AS total_redeemed,
      COUNT(*) FILTER (WHERE v.status = 'voided')         AS total_voided,
      COUNT(*) FILTER (WHERE v.status = 'active' AND v.expiry_date < CURRENT_DATE) AS total_expired,
      COALESCE(SUM(v.pax_count) FILTER (WHERE v.status = 'redeemed'), 0) AS total_pax_redeemed
    FROM vouchers v ${where}
  `, params);

  // Per-program breakdown
  const { rows: byProgram } = await pool.query(`
    SELECT
      p.id AS program_id, p.name AS program_name, c.name AS client_name,
      COUNT(v.id)                                             AS total,
      COUNT(v.id) FILTER (WHERE v.status = 'redeemed')       AS redeemed,
      COUNT(v.id) FILTER (WHERE v.status = 'active')         AS active,
      COUNT(v.id) FILTER (WHERE v.status = 'voided')         AS voided,
      COUNT(v.id) FILTER (WHERE v.status = 'active' AND v.expiry_date < CURRENT_DATE) AS expired,
      COALESCE(SUM(v.pax_count) FILTER (WHERE v.status = 'redeemed'), 0) AS pax_redeemed
    FROM programs p
    JOIN clients c ON c.id = p.client_id
    LEFT JOIN vouchers v ON v.program_id = p.id ${where.replace('WHERE', 'AND')}
    GROUP BY p.id, p.name, c.name
    ORDER BY total DESC
  `, params);

  // Per-vendor breakdown
  const { rows: byVendor } = await pool.query(`
    SELECT
      vd.id AS vendor_id, vd.name AS vendor_name,
      COUNT(r.id)::int           AS redemption_count,
      COALESCE(SUM(r.pax_count), 0)::int AS pax_served
    FROM vendors vd
    LEFT JOIN redemptions r ON r.vendor_id = vd.id
    LEFT JOIN vouchers v ON v.id = r.voucher_id
    ${where.replace('WHERE v.', 'WHERE v.')}
    GROUP BY vd.id, vd.name
    ORDER BY redemption_count DESC
  `, params);

  res.json({ summary: counts[0], by_program: byProgram, by_vendor: byVendor });
});

// ── GET /api/reports/redemption-history ──────────────────────────────────────
// Detailed log of every redemption event, filterable
router.get('/redemption-history', requirePermission('reports:view'), async (req, res) => {
  const { program_id, vendor_id, outlet_id, date_from, date_to, limit = 100, offset = 0 } = req.query;

  const filters = [];
  const params  = [];

  if (program_id) { params.push(program_id); filters.push(`v.program_id = $${params.length}`); }
  if (vendor_id)  { params.push(vendor_id);  filters.push(`r.vendor_id  = $${params.length}`); }
  if (outlet_id)  { params.push(outlet_id);  filters.push(`r.outlet_id  = $${params.length}`); }
  if (date_from)  { params.push(date_from);  filters.push(`r.redeemed_at::date >= $${params.length}`); }
  if (date_to)    { params.push(date_to);    filters.push(`r.redeemed_at::date <= $${params.length}`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  params.push(parseInt(limit));
  params.push(parseInt(offset));

  const { rows } = await pool.query(`
    SELECT
      r.id              AS redemption_id,
      r.redeemed_at,
      r.pax_count,
      v.code            AS voucher_code,
      v.passenger_name,
      v.start_date,
      v.expiry_date,
      p.name            AS program_name,
      c.name            AS client_name,
      sv.name           AS service_name,
      vd.name           AS vendor_name,
      o.name            AS outlet_name,
      s.name            AS site_name,
      s.iata_code
    FROM redemptions r
    JOIN vouchers v   ON v.id  = r.voucher_id
    JOIN programs p   ON p.id  = v.program_id
    JOIN clients c    ON c.id  = p.client_id
    JOIN services sv  ON sv.id = v.service_id
    LEFT JOIN vendors  vd ON vd.id = r.vendor_id
    LEFT JOIN outlets  o  ON o.id  = r.outlet_id
    LEFT JOIN sites    s  ON s.id  = o.site_id
    ${where}
    ORDER BY r.redeemed_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  // total count for the same filters (without limit/offset)
  const countParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await pool.query(`
    SELECT COUNT(*)::int AS total
    FROM redemptions r
    JOIN vouchers v ON v.id = r.voucher_id
    ${where}
  `, countParams);

  res.json({ total: countRows[0].total, limit: parseInt(limit), offset: parseInt(offset), rows });
});

// ── GET /api/reports/voucher-summary ─────────────────────────────────────────
// Per-program voucher listing with current status, for a date range
router.get('/voucher-summary', requirePermission('reports:view'), async (req, res) => {
  const { program_id, status, date_from, date_to, limit = 200, offset = 0 } = req.query;

  const filters = [];
  const params  = [];

  if (program_id) { params.push(program_id); filters.push(`v.program_id = $${params.length}`); }
  if (status)     { params.push(status);     filters.push(`v.status     = $${params.length}`); }
  if (date_from)  { params.push(date_from);  filters.push(`v.created_at::date >= $${params.length}`); }
  if (date_to)    { params.push(date_to);    filters.push(`v.created_at::date <= $${params.length}`); }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  params.push(parseInt(limit));
  params.push(parseInt(offset));

  const { rows } = await pool.query(`
    SELECT
      v.code, v.passenger_name, v.pax_count, v.status,
      v.start_date, v.expiry_date, v.created_at, v.redeemed_at,
      p.name AS program_name,
      c.name AS client_name,
      sv.name AS service_name,
      o.name AS outlet_name,
      s.name AS site_name, s.iata_code,
      CASE
        WHEN v.status = 'redeemed' THEN 'Redeemed'
        WHEN v.status = 'voided'   THEN 'Voided'
        WHEN v.expiry_date < CURRENT_DATE THEN 'Expired'
        WHEN v.start_date  > CURRENT_DATE THEN 'Pending'
        ELSE 'Active'
      END AS display_status
    FROM vouchers v
    JOIN programs p  ON p.id  = v.program_id
    JOIN clients c   ON c.id  = p.client_id
    JOIN services sv ON sv.id = v.service_id
    LEFT JOIN outlets o ON o.id = v.outlet_id
    LEFT JOIN sites   s ON s.id = COALESCE(v.site_id, o.site_id)
    ${where}
    ORDER BY v.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  const countParams = params.slice(0, params.length - 2);
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vouchers v ${where}`,
    countParams
  );

  res.json({ total: countRows[0].total, limit: parseInt(limit), offset: parseInt(offset), rows });
});

module.exports = router;
