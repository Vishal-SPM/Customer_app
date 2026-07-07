const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { requirePermission } = require('../middleware/auth');

function buildFilters(query) {
  const { program_id, client_id, service_id, billing_model, date_from, date_to } = query;
  const filters = [];
  const params  = [];

  if (program_id)    { params.push(program_id);    filters.push(`be.program_id = $${params.length}`); }
  if (client_id)     { params.push(client_id);     filters.push(`p.client_id   = $${params.length}`); }
  if (service_id)    { params.push(service_id);    filters.push(`be.service_id = $${params.length}`); }
  if (billing_model) { params.push(billing_model); filters.push(`be.billing_model = $${params.length}`); }
  if (date_from)     { params.push(date_from);     filters.push(`be.event_at::date >= $${params.length}`); }
  if (date_to)       { params.push(date_to);       filters.push(`be.event_at::date <= $${params.length}`); }

  return { filters, params, where: filters.length ? `WHERE ${filters.join(' AND ')}` : '' };
}

const BASE_QUERY = `
  FROM billing_events be
  JOIN vouchers  v  ON v.id  = be.voucher_id
  JOIN programs  p  ON p.id  = be.program_id
  JOIN clients   c  ON c.id  = p.client_id
  JOIN services  sv ON sv.id = be.service_id
  LEFT JOIN outlets o ON o.id = be.outlet_id
  LEFT JOIN sites   s ON s.id = o.site_id
`;

const SELECT_COLS = `
  be.id              AS billing_event_id,
  be.event_at,
  be.event_type,
  be.billing_model,
  be.unit_price,
  be.actual_bill_amount,
  be.billed_amount,
  v.code             AS voucher_code,
  v.passenger_name,
  p.id               AS program_id,
  p.name             AS program_name,
  c.id               AS client_id,
  c.name             AS client_name,
  sv.id              AS service_id,
  sv.name            AS service_name,
  o.name             AS outlet_name,
  s.name             AS site_name,
  s.iata_code
`;

// GET /api/billing/transactions
router.get('/transactions', requirePermission('reports:view'), async (req, res) => {
  const { limit = 200, offset = 0 } = req.query;
  const { params, where } = buildFilters(req.query);

  const dataParams = [...params, parseInt(limit), parseInt(offset)];
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} ${BASE_QUERY} ${where}
     ORDER BY be.event_at DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams
  );

  const { rows: totals } = await pool.query(
    `SELECT COUNT(*)::int AS total_events,
            COALESCE(SUM(be.billed_amount), 0)::numeric AS total_billed
     ${BASE_QUERY} ${where}`, params
  );

  res.json({ total: totals[0].total_events, total_billed: totals[0].total_billed, rows });
});

// GET /api/billing/transactions/csv
router.get('/transactions/csv', requirePermission('reports:view'), async (req, res) => {
  const { params, where } = buildFilters(req.query);

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS} ${BASE_QUERY} ${where} ORDER BY be.event_at DESC`,
    params
  );

  const headers = [
    'Date/Time', 'Event Type', 'Billing Model', 'Voucher Code', 'Passenger',
    'Program', 'Client', 'Service', 'Outlet', 'Site',
    'Unit Price (INR)', 'Actual Bill (INR)', 'Billed to Client (INR)'
  ];

  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csvRows = rows.map(r => [
    r.event_at ? new Date(r.event_at).toISOString() : '',
    r.event_type,
    r.billing_model,
    r.voucher_code,
    r.passenger_name,
    r.program_name,
    r.client_name,
    r.service_name,
    r.outlet_name || '',
    r.iata_code   || '',
    r.unit_price  ?? '',
    r.actual_bill_amount ?? '',
    r.billed_amount
  ].map(escape).join(','));

  const csv = [headers.join(','), ...csvRows].join('\r\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="billing_transactions_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

module.exports = router;
