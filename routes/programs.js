const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { requirePermission } = require('../middleware/auth');

function genApiKey() { return 'eats_' + uuid().replace(/-/g, ''); }

// Returns the set of program IDs the requesting user can access.
// Returns null if the user has access to all programs (superadmin or all_programs=true).
async function accessibleProgramIds(user) {
  if (user.is_superadmin || user.all_programs) return null;
  const { rows } = await pool.query('SELECT program_id FROM user_programs WHERE user_id=$1', [user.id]);
  return rows.map(r => r.program_id);
}

async function assertProgramAccess(user, programId) {
  if (user.is_superadmin || user.all_programs) return;
  const { rows } = await pool.query(
    'SELECT 1 FROM user_programs WHERE user_id=$1 AND program_id=$2', [user.id, programId]
  );
  if (!rows.length) throw Object.assign(new Error('No access to this program'), { status: 403 });
}

// POST /api/programs
router.post('/', requirePermission('programs:create'), async (req, res) => {
  const { client_id, name, code_prefix, validity_days, restriction_level } = req.body;
  if (!client_id || !name || !code_prefix) {
    return res.status(400).json({ error: 'client_id, name, and code_prefix are required' });
  }

  const prefix = code_prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { rows } = await pool.query(`
    INSERT INTO programs (id, client_id, name, code_prefix, validity_days, restriction_level, api_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
  `, [uuid(), client_id, name, prefix, validity_days || 30, restriction_level || 'program', genApiKey()]);

  res.status(201).json({ ...rows[0], _note: 'Save api_key — used as x-api-key header for voucher APIs' });
});

// GET /api/programs
router.get('/', requirePermission('programs:view'), async (req, res) => {
  const ids = await accessibleProgramIds(req.user);
  const { rows } = ids === null
    ? await pool.query(`SELECT p.*, c.name AS client_name FROM programs p JOIN clients c ON c.id=p.client_id ORDER BY p.created_at DESC`)
    : await pool.query(`SELECT p.*, c.name AS client_name FROM programs p JOIN clients c ON c.id=p.client_id WHERE p.id=ANY($1::text[]) ORDER BY p.created_at DESC`, [ids]);
  res.json(rows);
});

// GET /api/programs/:id
router.get('/:id', requirePermission('programs:view'), async (req, res) => {
  try { await assertProgramAccess(req.user, req.params.id); } catch (e) { return res.status(e.status||403).json({ error: e.message }); }
  const { rows } = await pool.query(`SELECT p.*, c.name AS client_name FROM programs p JOIN clients c ON c.id=p.client_id WHERE p.id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Program not found' });
  res.json(rows[0]);
});

// PATCH /api/programs/:id  — update restriction_level, validity_days
router.patch('/:id', requirePermission('programs:edit'), async (req, res) => {
  try { await assertProgramAccess(req.user, req.params.id); } catch (e) { return res.status(e.status||403).json({ error: e.message }); }
  const { restriction_level, validity_days, name } = req.body;
  const { rows } = await pool.query(`
    UPDATE programs SET
      restriction_level = COALESCE($1, restriction_level),
      validity_days     = COALESCE($2, validity_days),
      name              = COALESCE($3, name)
    WHERE id=$4 RETURNING *
  `, [restriction_level || null, validity_days || null, name || null, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Program not found' });
  res.json(rows[0]);
});

// ── Program ↔ Services ────────────────────────────────────────────────────────

// POST /api/programs/:id/services
router.post('/:id/services', requirePermission('programs:edit'), async (req, res) => {
  const { service_id, discount_value } = req.body;
  if (!service_id) return res.status(400).json({ error: 'service_id is required' });

  // Look up service type to auto-derive billing_model
  const { rows: svcRows } = await pool.query('SELECT service_type FROM services WHERE id=$1', [service_id]);
  if (!svcRows.length) return res.status(404).json({ error: 'Service not found' });
  const stype = svcRows[0].service_type;

  const svcTypeToModel = { qr: 'redemption', booking: 'issuance', discount_voucher: 'discount' };
  const billing_model = svcTypeToModel[stype] || 'issuance';

  if (stype === 'discount_voucher' && (discount_value === undefined || discount_value === null)) {
    return res.status(400).json({ error: 'discount_value is required for Discount Voucher services' });
  }

  await pool.query(`
    INSERT INTO program_services (program_id, service_id, billing_model, unit_price, discount_value)
    VALUES ($1,$2,$3,0,$4)
    ON CONFLICT (program_id, service_id) DO UPDATE
      SET billing_model  = EXCLUDED.billing_model,
          unit_price     = 0,
          discount_value = EXCLUDED.discount_value
  `, [req.params.id, service_id, billing_model,
      stype === 'discount_voucher' ? parseFloat(discount_value) : null]);

  res.status(201).json({ message: 'Service mapped to program' });
});

// GET /api/programs/:id/services
router.get('/:id/services', requirePermission('programs:view'), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sv.id, sv.name, sv.description, sv.service_type,
           ps.billing_model, ps.discount_value
    FROM services sv
    JOIN program_services ps ON ps.service_id = sv.id AND ps.program_id = $1
    WHERE ps.program_id = $1 ORDER BY sv.name
  `, [req.params.id]);
  res.json(rows);
});

// DELETE /api/programs/:id/services/:service_id
router.delete('/:id/services/:service_id', requirePermission('programs:edit'), async (req, res) => {
  await pool.query('DELETE FROM program_services WHERE program_id=$1 AND service_id=$2', [req.params.id, req.params.service_id]);
  res.json({ message: 'Service removed from program' });
});

module.exports = router;
