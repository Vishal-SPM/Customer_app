const pool   = require('../db/pool');
const QRCode = require('qrcode');

const STATUS = {
  active:   { label: 'Valid',     color: '#16a34a', bg: '#dcfce7' },
  upcoming: { label: 'Upcoming',  color: '#1d4ed8', bg: '#dbeafe' },
  redeemed: { label: 'Redeemed',  color: '#dc2626', bg: '#fee2e2' },
  voided:   { label: 'Voided',    color: '#4b5563', bg: '#f3f4f6' },
  expired:  { label: 'Expired',   color: '#ea580c', bg: '#ffedd5' }
};

function computeStatus(v) {
  const today = new Date().toISOString().split('T')[0];
  if (v.status === 'redeemed') return 'redeemed';
  if (v.status === 'voided')   return 'voided';
  if (today > v.expiry_date)   return 'expired';
  if (today < v.start_date)    return 'upcoming';
  return 'active';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = async (req, res) => {
  const { rows } = await pool.query(`
    SELECT v.*,
           p.name AS program_name, p.restriction_level, p.code_prefix,
           c.name AS client_name,  c.logo_url,
           sv.name AS service_name,
           o.name AS outlet_name,  o.terminal_name, o.terminal_type,
           s2.name AS site_name,   s2.iata_code
    FROM vouchers v
    JOIN programs p  ON p.id = v.program_id
    JOIN clients c   ON c.id = p.client_id
    JOIN services sv ON sv.id = v.service_id
    LEFT JOIN outlets o ON o.id = v.outlet_id
    LEFT JOIN sites s2  ON s2.id = COALESCE(v.site_id, o.site_id)
    WHERE v.code = $1
  `, [req.params.code]);

  if (!rows.length) {
    return res.status(404).send(`<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8fafc"><div style="text-align:center"><h1 style="font-size:3rem;color:#1e293b">404</h1><p style="color:#64748b">Voucher not found</p></div></body></html>`);
  }

  const v      = rows[0];
  const status = computeStatus(v);
  const style  = STATUS[status];

  // Resolve outlets to display
  let outletRows = [];
  if (v.restriction_level === 'outlet' && v.outlet_id) {
    const { rows: or } = await pool.query(`
      SELECT o.*, s.name AS site_name, s.iata_code
      FROM outlets o JOIN sites s ON s.id=o.site_id WHERE o.id=$1
    `, [v.outlet_id]);
    outletRows = or;
  } else if (v.restriction_level === 'site' && v.site_id) {
    const { rows: or } = await pool.query(`
      SELECT o.*, s.name AS site_name, s.iata_code
      FROM outlets o JOIN sites s ON s.id=o.site_id
      JOIN program_outlets po ON po.outlet_id=o.id
      WHERE po.program_id=$1 AND o.site_id=$2 ORDER BY o.name
    `, [v.program_id, v.site_id]);
    outletRows = or;
  } else {
    const { rows: or } = await pool.query(`
      SELECT o.*, s.name AS site_name, s.iata_code
      FROM outlets o JOIN sites s ON s.id=o.site_id
      JOIN program_outlets po ON po.outlet_id=o.id
      WHERE po.program_id=$1 ORDER BY s.name, o.name
    `, [v.program_id]);
    outletRows = or;
  }

  const qrDataUrl = await QRCode.toDataURL(v.code, { width: 220, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });

  const outletHtml = outletRows.map(o => `
    <div class="outlet">
      <div class="oname">${esc(o.name)}</div>
      <div class="ometa">
        ${esc(o.iata_code)} ${o.terminal_name ? '· ' + esc(o.terminal_name) : ''}
        ${o.direction ? '· ' + esc(o.direction) : ''}
        ${o.requires_boarding_pass ? '<span class="bp">Boarding pass required</span>' : ''}
      </div>
    </div>`).join('');

  const logoHtml = v.logo_url
    ? `<img src="${esc(v.logo_url)}" class="logo" alt="logo">`
    : `<div class="logo-text">${esc(v.client_name.charAt(0))}</div>`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(v.code)} — EATs Voucher</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:#fff;border-radius:20px;box-shadow:0 8px 32px rgba(15,23,42,.12);max-width:420px;width:100%;overflow:hidden}
    .hdr{background:#0f172a;padding:28px 24px 20px;text-align:center;color:#fff}
    .logo{height:44px;margin-bottom:12px;object-fit:contain}
    .logo-text{width:44px;height:44px;border-radius:10px;background:#334155;color:#94a3b8;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
    .client{font-size:18px;font-weight:700}
    .prog{font-size:12px;color:#94a3b8;margin-top:2px;text-transform:uppercase;letter-spacing:1px}
    .body{padding:24px}
    .badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:999px;font-size:12px;font-weight:700;color:${style.color};background:${style.bg};margin-bottom:18px}
    .dot{width:7px;height:7px;border-radius:50%;background:${style.color}}
    .pax{font-size:24px;font-weight:800;color:#0f172a;line-height:1.2}
    .pax-sub{font-size:13px;color:#64748b;margin-top:3px;margin-bottom:22px}
    .qr{text-align:center;background:#f8fafc;border-radius:14px;padding:24px 16px 16px;margin-bottom:20px;${status!=='active'?'opacity:.4;filter:grayscale(1);':''}}
    .qr img{display:block;margin:0 auto;width:200px;height:200px}
    .code{font-family:'Courier New',monospace;font-size:18px;font-weight:700;letter-spacing:4px;color:#0f172a;margin-top:14px}
    .hint{font-size:11px;color:#94a3b8;margin-top:6px}
    .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px}
    .dates{display:flex;gap:10px;margin-bottom:20px}
    .dbox{flex:1;background:#f8fafc;border-radius:10px;padding:12px;text-align:center}
    .dbox .dl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}
    .dbox .dv{font-size:15px;font-weight:700;color:#1e293b}
    .outlet{padding:10px 0;border-bottom:1px solid #f1f5f9}
    .outlet:last-child{border-bottom:none}
    .oname{font-size:14px;font-weight:600;color:#1e293b}
    .ometa{font-size:12px;color:#64748b;margin-top:2px}
    .bp{display:inline-block;font-size:10px;font-weight:600;background:#fef9c3;color:#854d0e;padding:1px 6px;border-radius:4px;margin-left:4px}
    .svc{display:inline-block;font-size:11px;background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:999px;font-weight:600;margin-bottom:20px}
    .ftr{background:#f8fafc;border-top:1px solid #f1f5f9;padding:14px 24px;text-align:center;font-size:11px;color:#94a3b8;line-height:1.6}
  </style>
</head>
<body>
<div class="card">
  <div class="hdr">
    ${logoHtml}
    <div class="client">${esc(v.client_name)}</div>
    <div class="prog">${esc(v.program_name)}</div>
  </div>
  <div class="body">
    <span class="badge"><span class="dot"></span>${style.label}</span>
    <span class="svc">${esc(v.service_name)}</span>
    <div class="pax">${esc(v.passenger_name)}</div>
    <div class="pax-sub">${v.pax_count} ${v.pax_count === 1 ? 'Guest' : 'Guests'}</div>
    <div class="qr">
      <img src="${qrDataUrl}" alt="QR Code">
      <div class="code">${esc(v.code)}</div>
      <div class="hint">Scan at lounge entrance · Single use</div>
    </div>
    <div class="lbl">Validity</div>
    <div class="dates">
      <div class="dbox"><div class="dl">From</div><div class="dv">${fmtDate(v.start_date)}</div></div>
      <div class="dbox"><div class="dl">Until</div><div class="dv">${fmtDate(v.expiry_date)}</div></div>
    </div>
    <div class="lbl">Valid At (${outletRows.length} ${outletRows.length === 1 ? 'Outlet' : 'Outlets'})</div>
    ${outletHtml || '<p style="color:#94a3b8;font-size:13px;">All program outlets</p>'}
  </div>
  <div class="ftr">EATs Voucher System · Non-transferable · One-time use only</div>
</div>
</body>
</html>`);
};
