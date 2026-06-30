const express    = require('express');
const router     = express.Router();
const pool       = require('../db/pool');
const { notify } = require('../utils/notify');

// Guard — all internal routes require x-cron-secret header
router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// POST /api/internal/expiry-reminders
// Finds active vouchers expiring in exactly 3 days with contact info
// and sends reminder notifications. Hit this daily via cron-job.org.
router.post('/expiry-reminders', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*, p.name AS program_name, sv.name AS service_name
    FROM vouchers v
    JOIN programs p  ON p.id  = v.program_id
    JOIN services sv ON sv.id = v.service_id
    WHERE v.status = 'active'
      AND v.expiry_date = CURRENT_DATE + INTERVAL '3 days'
      AND (v.passenger_email IS NOT NULL OR v.passenger_phone IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM notifications_log nl
        WHERE nl.voucher_id = v.id
          AND nl.type = 'expiry_reminder'
          AND nl.status IN ('sent', 'skipped')
      )
  `);

  let processed = 0;
  for (const v of rows) {
    await notify(v.id, 'expiry_reminder', v);
    processed++;
  }

  console.log(`[cron] expiry-reminders: ${processed} voucher(s) notified`);
  res.json({ processed, checked_at: new Date().toISOString() });
});

// GET /api/internal/expiry-reminders — test endpoint, returns what would be sent
router.get('/expiry-reminders', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.id, v.code, v.passenger_name, v.passenger_email, v.passenger_phone,
           v.expiry_date, p.name AS program_name
    FROM vouchers v
    JOIN programs p ON p.id = v.program_id
    WHERE v.status = 'active'
      AND v.expiry_date = CURRENT_DATE + INTERVAL '3 days'
  `);
  res.json({ due: rows.length, vouchers: rows });
});

module.exports = router;
