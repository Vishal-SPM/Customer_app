const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const { v4: uuid } = require('uuid');
const { notify } = require('../utils/notify');

// ── Helpers ───────────────────────────────────────────────────────────────────

function genCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

async function uniqueCode(prefix) {
  for (let i = 0; i < 10; i++) {
    const code = genCode(prefix);
    const { rows } = await pool.query('SELECT id FROM vouchers WHERE code=$1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not generate unique voucher code');
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Program-level auth — used by airline/client systems for voucher issuance
async function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
  const { rows } = await pool.query('SELECT * FROM programs WHERE api_key=$1', [key]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid API key' });
  req.program = rows[0];
  next();
}

// Vendor-level auth — used by outlet/vendor POS systems for redemption
async function requireVendorKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing x-api-key header' });
  const { rows } = await pool.query('SELECT * FROM vendors WHERE api_key=$1 AND is_active=TRUE', [key]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid or inactive vendor API key' });
  req.vendor = rows[0];
  next();
}

// ── GET /api/voucher/locations ────────────────────────────────────────────────
// Returns airports that have outlets mapped to this program providing this service.
router.get('/locations', requireApiKey, async (req, res) => {
  const { service_id } = req.query;
  if (!service_id) return res.status(400).json({ error: 'service_id is required' });

  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.iata_code, s.city, s.country,
           COUNT(DISTINCT o.id)::int AS outlet_count
    FROM sites s
    JOIN outlets o ON o.site_id = s.id
    JOIN program_outlets po ON po.outlet_id = o.id AND po.program_id = $1
    JOIN outlet_services os ON os.outlet_id = o.id AND os.service_id = $2
    GROUP BY s.id, s.name, s.iata_code, s.city, s.country
    ORDER BY s.name
  `, [req.program.id, service_id]);

  res.json({ program: req.program.name, service_id, locations: rows });
});

// ── POST /api/voucher/outlets ─────────────────────────────────────────────────
// Request body: { program_id, service_id, iata_code }
// Returns outlets at that airport mapped to the program providing that service.
router.post('/outlets', requireApiKey, async (req, res) => {
  const { program_id, service_id, iata_code } = req.body;

  if (!program_id)           return res.status(400).json({ error: 'program_id is required' });
  if (!service_id)           return res.status(400).json({ error: 'service_id is required' });
  if (!iata_code)            return res.status(400).json({ error: 'iata_code is required' });
  if (program_id !== req.program.id) return res.status(403).json({ error: 'program_id does not match API key' });

  const { rows } = await pool.query(`
    SELECT o.id, o.name, o.terminal_type, o.terminal_name, o.gate_type,
           o.direction, o.amenities, o.requires_boarding_pass,
           s.id AS site_id, s.name AS site_name, s.iata_code,
           po.price AS program_price
    FROM outlets o
    JOIN sites s            ON s.id = o.site_id
    JOIN program_outlets po ON po.outlet_id = o.id  AND po.program_id = $1
    JOIN outlet_services os ON os.outlet_id = o.id  AND os.service_id = $2
    WHERE s.iata_code = $3
    ORDER BY o.name
  `, [program_id, service_id, iata_code.toUpperCase()]);

  res.json({
    program_id,
    iata_code:    iata_code.toUpperCase(),
    outlet_count: rows.length,
    outlets:      rows
  });
});

// ── POST /api/voucher/create ──────────────────────────────────────────────────
// Request body: { program_id, service_id, passenger_name, pax_count, start_date, outlet_id? }
router.post('/create', requireApiKey, async (req, res) => {
  const { program_id, service_id, passenger_name, passenger_email, passenger_phone, pax_count, start_date, outlet_id, site_id } = req.body;
  const program = req.program;

  if (!program_id)               return res.status(400).json({ error: 'program_id is required' });
  if (!service_id)               return res.status(400).json({ error: 'service_id is required' });
  if (!passenger_name)           return res.status(400).json({ error: 'passenger_name is required' });
  if (!start_date)               return res.status(400).json({ error: 'start_date is required' });
  if (program_id !== program.id) return res.status(403).json({ error: 'program_id does not match API key' });

  // Validate restriction-level requirements
  if (program.restriction_level === 'outlet' && !outlet_id) {
    return res.status(400).json({ error: 'outlet_id is required — this program uses outlet-level restriction' });
  }
  if (program.restriction_level === 'site' && !site_id) {
    return res.status(400).json({ error: 'site_id is required — this program uses site-level restriction' });
  }

  // Verify service is mapped to this program and get billing config
  const { rows: svcCheck } = await pool.query(
    'SELECT billing_model, unit_price, discount_value FROM program_services WHERE program_id=$1 AND service_id=$2',
    [program.id, service_id]
  );
  if (!svcCheck.length) {
    return res.status(400).json({ error: 'This service is not configured for this program' });
  }
  const billing = svcCheck[0];

  const code        = await uniqueCode(program.code_prefix);
  const expiry_date = addDays(start_date, program.validity_days);

  const { rows } = await pool.query(`
    INSERT INTO vouchers (id, program_id, service_id, outlet_id, site_id, code, passenger_name, passenger_email, passenger_phone, pax_count, start_date, expiry_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
  `, [uuid(), program.id, service_id, outlet_id || null, site_id || null,
      code, passenger_name, passenger_email || null, passenger_phone || null,
      pax_count || 1, start_date, expiry_date]);

  const voucher = rows[0];

  // Log issuance billing event immediately on voucher creation
  if (billing.billing_model === 'issuance') {
    pool.query(
      `INSERT INTO billing_events (id, voucher_id, program_id, service_id, outlet_id, billing_model, unit_price, billed_amount, event_type)
       VALUES ($1,$2,$3,$4,$5,'issuance',$6,$6,'issuance')`,
      [uuid(), voucher.id, program.id, service_id, outlet_id || null, parseFloat(billing.unit_price) || 0]
    ).catch(() => {});
  }

  // Fire notification (non-blocking)
  pool.query('SELECT name FROM services WHERE id=$1', [service_id]).then(({ rows: sr }) => {
    notify(voucher.id, 'voucher_created', {
      ...voucher,
      service_name: sr[0]?.name || '',
      program_name: program.name
    });
  }).catch(() => {});

  // Resolve which outlets this voucher is valid at
  let outletQuery, outletParams;
  if (program.restriction_level === 'outlet') {
    outletQuery  = 'SELECT o.*, s.name AS site_name, s.iata_code FROM outlets o JOIN sites s ON s.id=o.site_id WHERE o.id=$1';
    outletParams = [outlet_id];
  } else if (program.restriction_level === 'site') {
    outletQuery  = `SELECT o.*, s.name AS site_name, s.iata_code FROM outlets o JOIN sites s ON s.id=o.site_id JOIN program_outlets po ON po.outlet_id=o.id WHERE po.program_id=$1 AND o.site_id=$2 ORDER BY o.name`;
    outletParams = [program.id, site_id];
  } else {
    outletQuery  = `SELECT o.*, s.name AS site_name, s.iata_code FROM outlets o JOIN sites s ON s.id=o.site_id JOIN program_outlets po ON po.outlet_id=o.id WHERE po.program_id=$1 ORDER BY s.name, o.name`;
    outletParams = [program.id];
  }
  const { rows: outlets } = await pool.query(outletQuery, outletParams);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(201).json({
    success:      true,
    voucher_code: voucher.code,
    voucher_link: `${baseUrl}/v/${voucher.code}`,
    data: {
      passenger_name: voucher.passenger_name,
      pax_count:      voucher.pax_count,
      start_date:     voucher.start_date,
      expiry_date:    voucher.expiry_date,
      restriction_level: program.restriction_level,
      outlets
    }
  });
});

// ── GET /api/voucher/list ─────────────────────────────────────────────────────
router.get('/list', requireApiKey, async (req, res) => {
  const { status, limit = 50 } = req.query;
  const params = [req.program.id, parseInt(limit)];
  const filter = status ? `AND v.status=$3` : '';
  if (status) params.push(status);

  const { rows } = await pool.query(`
    SELECT v.*, sv.name AS service_name,
           o.name AS outlet_name, s.name AS site_name, s.iata_code
    FROM vouchers v
    JOIN services sv ON sv.id = v.service_id
    LEFT JOIN outlets o ON o.id = v.outlet_id
    LEFT JOIN sites s ON s.id = COALESCE(v.site_id, o.site_id)
    WHERE v.program_id=$1 ${filter}
    ORDER BY v.created_at DESC LIMIT $2
  `, params);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json(rows.map(v => ({ ...v, voucher_link: `${baseUrl}/v/${v.code}` })));
});

// ── POST /api/voucher/validate ────────────────────────────────────────────────
// Step 1 of redemption: validate code, return temp_auth_id  (vendor API key required)
router.post('/validate', requireVendorKey, async (req, res) => {
  const { voucher_code } = req.body;
  if (!voucher_code) return res.status(400).json({ valid: false, error: 'voucher_code is required' });

  const { rows } = await pool.query('SELECT * FROM vouchers WHERE code=$1', [voucher_code]);
  if (!rows.length) return res.status(404).json({ valid: false, error: 'Voucher not found' });

  const v     = rows[0];
  const today = new Date().toISOString().split('T')[0];

  if (v.status === 'redeemed') return res.json({ valid: false, error: 'Voucher already redeemed', redeemed_at: v.redeemed_at });
  if (v.status === 'voided')   return res.json({ valid: false, error: 'Voucher has been voided' });
  if (today < v.start_date)    return res.json({ valid: false, error: 'Voucher not yet active', valid_from: v.start_date });
  if (today > v.expiry_date)   return res.json({ valid: false, error: 'Voucher has expired', expired_on: v.expiry_date });

  const { rows: authRows } = await pool.query(
    'INSERT INTO temp_auths (id, voucher_id) VALUES ($1,$2) RETURNING *',
    [uuid(), v.id]
  );

  res.json({
    valid:            true,
    expires_on:       v.expiry_date,
    free_pax:         v.pax_count,
    passenger:        v.passenger_name,
    temp_auth_id:     authRows[0].id,
    auth_valid_until: authRows[0].expires_at,
    vendor:           req.vendor.name
  });
});

// ── POST /api/voucher/redeem ──────────────────────────────────────────────────
// Step 2 of redemption: consume temp_auth, mark voucher redeemed (vendor API key required)
router.post('/redeem', requireVendorKey, async (req, res) => {
  const { temp_auth_id, pax_count, outlet_id, actual_bill_amount } = req.body;
  if (!temp_auth_id) return res.status(400).json({ success: false, error: 'temp_auth_id is required' });

  const { rows: authRows } = await pool.query('SELECT * FROM temp_auths WHERE id=$1', [temp_auth_id]);
  if (!authRows.length) return res.status(404).json({ success: false, error: 'Invalid temp_auth_id' });

  const auth = authRows[0];
  if (auth.used)                              return res.status(409).json({ success: false, error: 'temp_auth already used' });
  if (new Date(auth.expires_at) < new Date()) return res.status(422).json({ success: false, error: 'temp_auth expired — re-validate the voucher' });

  // Fetch voucher + billing config
  const { rows: vRows } = await pool.query('SELECT * FROM vouchers WHERE id=$1', [auth.voucher_id]);
  const voucher = vRows[0];

  const { rows: billingRows } = await pool.query(
    'SELECT billing_model, unit_price, discount_value FROM program_services WHERE program_id=$1 AND service_id=$2',
    [voucher.program_id, voucher.service_id]
  );
  const billing = billingRows[0] || { billing_model: 'issuance', unit_price: 0, discount_value: null };

  // Discount model requires actual_bill_amount from POS
  if (billing.billing_model === 'discount') {
    if (actual_bill_amount === undefined || actual_bill_amount === null) {
      return res.status(400).json({ success: false, error: 'actual_bill_amount is required for discount-model services' });
    }
  }

  // If outlet_id provided, verify it belongs to this vendor
  if (outlet_id) {
    const { rows: outletRows } = await pool.query(
      'SELECT 1 FROM outlets WHERE id=$1 AND vendor_id=$2', [outlet_id, req.vendor.id]
    );
    if (!outletRows.length) return res.status(403).json({ success: false, error: 'outlet_id does not belong to this vendor' });
  }

  // Compute billing amounts
  let billedAmount = 0;
  let discountedAmount = null;
  if (billing.billing_model === 'discount') {
    discountedAmount = Math.min(parseFloat(billing.discount_value), parseFloat(actual_bill_amount));
    billedAmount     = discountedAmount;
  } else if (billing.billing_model === 'redemption') {
    billedAmount = parseFloat(billing.unit_price) || 0;
  }
  // issuance: billing event already logged at create; billedAmount = 0 here (no new event)

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE vouchers SET status=$1, redeemed_at=NOW() WHERE id=$2', ['redeemed', auth.voucher_id]);
    await client.query('UPDATE temp_auths SET used=TRUE WHERE id=$1', [temp_auth_id]);
    await client.query(
      `INSERT INTO redemptions (id, voucher_id, temp_auth_id, pax_count, outlet_id, vendor_id, actual_bill_amount, discounted_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), auth.voucher_id, temp_auth_id, pax_count || 1, outlet_id || null, req.vendor.id,
       actual_bill_amount !== undefined ? parseFloat(actual_bill_amount) : null,
       discountedAmount]
    );

    // Log billing event for redemption / discount models
    if (billing.billing_model === 'redemption' || billing.billing_model === 'discount') {
      await client.query(
        `INSERT INTO billing_events (id, voucher_id, program_id, service_id, outlet_id, billing_model, unit_price, actual_bill_amount, billed_amount, event_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'redemption')`,
        [uuid(), auth.voucher_id, voucher.program_id, voucher.service_id, outlet_id || null,
         billing.billing_model, parseFloat(billing.unit_price) || 0,
         actual_bill_amount !== undefined ? parseFloat(actual_bill_amount) : null,
         billedAmount]
      );
    }

    await client.query('COMMIT');

    // Fire notification (non-blocking)
    pool.query(`
      SELECT v.*, o.name AS outlet_name
      FROM vouchers v LEFT JOIN outlets o ON o.id = $2 WHERE v.id = $1
    `, [auth.voucher_id, outlet_id || null]).then(({ rows: vr }) => {
      if (vr[0]) notify(auth.voucher_id, 'voucher_redeemed', { ...vr[0], outlet_name: vr[0].outlet_name || null, vendor_name: req.vendor.name });
    }).catch(() => {});

    const resp = { success: true, message: 'Voucher redeemed successfully', redeemed_at: new Date().toISOString(), vendor: req.vendor.name };
    if (billing.billing_model === 'discount') {
      resp.discount_applied = discountedAmount;
      resp.customer_pays    = Math.max(0, parseFloat(actual_bill_amount) - discountedAmount);
    }
    res.json(resp);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

module.exports = router;
