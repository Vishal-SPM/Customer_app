const pool     = require('../db/pool');
const { v4: uuid } = require('uuid');
const nodemailer   = require('nodemailer');

// ── Email transporter (lazy init) ─────────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST) return null;
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _transporter;
}

// ── DB log ────────────────────────────────────────────────────────────────────
async function log(voucherId, type, channel, recipient, status, error = null) {
  await pool.query(
    `INSERT INTO notifications_log (id, voucher_id, type, channel, recipient, status, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuid(), voucherId || null, type, channel, recipient, status, error || null]
  ).catch(e => console.error('notify log error:', e.message));
}

// ── Send email ────────────────────────────────────────────────────────────────
async function sendEmail(to, subject, text, html) {
  const t = getTransporter();
  if (!t) return 'skipped';
  await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text, html });
  return 'sent';
}

// ── Send SMS via MSG91 ────────────────────────────────────────────────────────
async function sendSMS(phone, message) {
  if (!process.env.MSG91_AUTH_KEY) return 'skipped';
  const sender = process.env.MSG91_SENDER || 'EATSVC';
  const url = `https://api.msg91.com/api/sendhttp.php?authkey=${process.env.MSG91_AUTH_KEY}` +
              `&mobiles=${encodeURIComponent(phone)}&message=${encodeURIComponent(message)}` +
              `&sender=${sender}&route=4&country=91`;
  const res = await fetch(url);
  return res.ok ? 'sent' : 'failed';
}

// ── Templates ─────────────────────────────────────────────────────────────────
function templates(type, data) {
  const base = process.env.APP_URL || 'https://eats-voucher.onrender.com';
  const link = `${base}/v/${data.code}`;
  const name = data.passenger_name || 'Passenger';

  switch (type) {
    case 'voucher_created':
      return {
        subject: `Your ${data.service_name} Voucher — ${data.code}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1e293b">Hi ${name},</h2>
            <p>Your voucher has been created successfully.</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0">
              <tr><td style="padding:6px 0;color:#64748b">Code</td><td style="font-weight:700;font-size:18px;letter-spacing:2px">${data.code}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Service</td><td>${data.service_name}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Program</td><td>${data.program_name}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Valid</td><td>${data.start_date} → ${data.expiry_date}</td></tr>
            </table>
            <a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">View Voucher &amp; QR Code</a>
          </div>`,
        sms: `Hi ${name}, your ${data.service_name} voucher ${data.code} is ready. Valid till ${data.expiry_date}. View: ${link}`
      };

    case 'voucher_redeemed':
      return {
        subject: `Voucher ${data.code} Redeemed Successfully`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1e293b">Hi ${name},</h2>
            <p>Your voucher has been redeemed successfully.</p>
            <table style="border-collapse:collapse;width:100%;margin:16px 0">
              <tr><td style="padding:6px 0;color:#64748b">Code</td><td style="font-weight:700">${data.code}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Outlet</td><td>${data.outlet_name || 'N/A'}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Vendor</td><td>${data.vendor_name || 'N/A'}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Date &amp; Time</td><td>${new Date().toLocaleString('en-IN')}</td></tr>
            </table>
            <p style="color:#64748b">Thank you for using our service!</p>
          </div>`,
        sms: `Voucher ${data.code} redeemed at ${data.outlet_name || 'outlet'} on ${new Date().toLocaleDateString('en-IN')}. Thank you!`
      };

    case 'expiry_reminder':
      return {
        subject: `Reminder: Your voucher expires in 3 days — ${data.code}`,
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#f59e0b">Hi ${name}, your voucher expires soon!</h2>
            <p>Your voucher <strong>${data.code}</strong> expires on <strong>${data.expiry_date}</strong>.</p>
            <p>Don't let it go to waste — use it before it expires.</p>
            <a href="${link}" style="display:inline-block;background:#f59e0b;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">View Voucher</a>
          </div>`,
        sms: `Reminder: Your voucher ${data.code} expires on ${data.expiry_date}. View: ${link}`
      };

    default: return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
// Fire-and-forget safe: catches all errors internally and logs them.
async function notify(voucherId, type, data) {
  const t = templates(type, data);
  if (!t) return;

  if (data.passenger_email) {
    try {
      const status = await sendEmail(data.passenger_email, t.subject, t.sms, t.html);
      await log(voucherId, type, 'email', data.passenger_email, status);
    } catch (err) {
      await log(voucherId, type, 'email', data.passenger_email, 'failed', err.message);
    }
  }

  if (data.passenger_phone) {
    try {
      const status = await sendSMS(data.passenger_phone, t.sms);
      await log(voucherId, type, 'sms', data.passenger_phone, status);
    } catch (err) {
      await log(voucherId, type, 'sms', data.passenger_phone, 'failed', err.message);
    }
  }
}

module.exports = { notify };
