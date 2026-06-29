const db      = require('../db/database');
const QRCode  = require('qrcode');
const { getEligibleOutlets, voucherStatus } = require('../db/helpers');

const STATUS_STYLE = {
  active:   { label: 'Valid',     color: '#16a34a', bg: '#dcfce7' },
  upcoming: { label: 'Upcoming',  color: '#1d4ed8', bg: '#dbeafe' },
  redeemed: { label: 'Redeemed',  color: '#dc2626', bg: '#fee2e2' },
  voided:   { label: 'Voided',    color: '#4b5563', bg: '#f3f4f6' },
  expired:  { label: 'Expired',   color: '#ea580c', bg: '#ffedd5' }
};

module.exports = async (req, res) => {
  const voucher = db.prepare('SELECT * FROM vouchers WHERE code = ?').get(req.params.code);

  if (!voucher) {
    return res.status(404).send(`
      <!DOCTYPE html><html><head><title>Not Found</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;}
      .box{text-align:center;color:#64748b;} h1{font-size:2rem;color:#1e293b;}</style></head>
      <body><div class="box"><h1>404</h1><p>Voucher not found</p></div></body></html>
    `);
  }

  const program = db.prepare(`
    SELECT p.id, p.name AS program_name, p.code_prefix,
           c.name AS client_name, c.logo_url
    FROM programs p
    JOIN clients c ON c.id = p.client_id
    WHERE p.id = ?
  `).get(voucher.program_id);

  const scope     = JSON.parse(voucher.benefit_scope);
  const outlets   = getEligibleOutlets(scope, voucher.program_id);
  const computed  = voucherStatus(voucher);
  const style     = STATUS_STYLE[computed] || STATUS_STYLE.active;

  const qrDataUrl = await QRCode.toDataURL(voucher.code, {
    width:           240,
    margin:          2,
    color:           { dark: '#0f172a', light: '#ffffff' }
  });

  const outletRows = outlets.map(o => `
    <div class="outlet">
      <div class="outlet-name">${escHtml(o.name)}</div>
      <div class="outlet-meta">
        ${escHtml(o.airport_code)}${o.terminal ? ` &middot; Terminal ${escHtml(o.terminal)}` : ''}
        ${o.requires_boarding_pass ? ' &middot; <span class="bp-tag">Boarding pass required</span>' : ''}
      </div>
    </div>
  `).join('');

  const logoHtml = program.logo_url
    ? `<img src="${escHtml(program.logo_url)}" alt="logo" class="logo">`
    : `<div class="logo-placeholder">${escHtml(program.client_name.charAt(0))}</div>`;

  const redeemNote = computed === 'redeemed'
    ? `<div class="redeem-note">Redeemed on ${fmt(voucher.redeemed_at)}</div>`
    : '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voucher · ${escHtml(voucher.code)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .card {
      background: #fff;
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(15,23,42,.12);
      max-width: 420px;
      width: 100%;
      overflow: hidden;
    }

    /* Header */
    .header {
      background: #0f172a;
      padding: 28px 24px 20px;
      text-align: center;
      color: #fff;
    }
    .logo { height: 44px; margin-bottom: 12px; object-fit: contain; }
    .logo-placeholder {
      width: 44px; height: 44px; border-radius: 10px;
      background: #334155; color: #94a3b8;
      font-size: 22px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px;
    }
    .client-name  { font-size: 18px; font-weight: 700; letter-spacing: -.3px; }
    .program-name { font-size: 12px; color: #94a3b8; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }

    /* Body */
    .body { padding: 24px; }

    .status-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 14px; border-radius: 999px;
      font-size: 12px; font-weight: 700;
      color: ${style.color}; background: ${style.bg};
      margin-bottom: 18px;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: ${style.color}; }

    .passenger  { font-size: 24px; font-weight: 800; color: #0f172a; line-height: 1.2; }
    .pax-label  { font-size: 13px; color: #64748b; margin-top: 3px; margin-bottom: 22px; }

    .redeem-note {
      background: #fee2e2; color: #b91c1c;
      font-size: 12px; font-weight: 600;
      padding: 8px 12px; border-radius: 8px;
      margin-bottom: 16px;
    }

    /* QR Section */
    .qr-section {
      text-align: center;
      background: #f8fafc;
      border-radius: 14px;
      padding: 24px 16px 16px;
      margin-bottom: 20px;
      ${computed !== 'active' ? 'opacity:.45; filter:grayscale(1);' : ''}
    }
    .qr-section img { display: block; margin: 0 auto; width: 200px; height: 200px; }
    .voucher-code {
      font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace;
      font-size: 18px; font-weight: 700; letter-spacing: 4px;
      color: #0f172a; margin-top: 14px;
    }
    .scan-hint { font-size: 11px; color: #94a3b8; margin-top: 6px; }

    /* Validity */
    .section-label {
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 1px;
      color: #94a3b8; margin-bottom: 8px;
    }
    .validity-row { display: flex; gap: 10px; margin-bottom: 20px; }
    .validity-box {
      flex: 1; background: #f8fafc; border-radius: 10px;
      padding: 12px; text-align: center;
    }
    .validity-box .v-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .8px; margin-bottom: 4px; }
    .validity-box .v-date  { font-size: 15px; font-weight: 700; color: #1e293b; }

    /* Outlets */
    .outlet { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
    .outlet:last-child { border-bottom: none; }
    .outlet-name { font-size: 14px; font-weight: 600; color: #1e293b; }
    .outlet-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
    .bp-tag {
      display: inline-block;
      font-size: 10px; font-weight: 600;
      background: #fef9c3; color: #854d0e;
      padding: 1px 6px; border-radius: 4px;
    }

    /* Footer */
    .footer {
      background: #f8fafc;
      border-top: 1px solid #f1f5f9;
      padding: 14px 24px;
      text-align: center;
      font-size: 11px; color: #94a3b8; line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="card">

    <div class="header">
      ${logoHtml}
      <div class="client-name">${escHtml(program.client_name)}</div>
      <div class="program-name">${escHtml(program.program_name)}</div>
    </div>

    <div class="body">
      <span class="status-badge"><span class="status-dot"></span>${style.label}</span>
      ${redeemNote}

      <div class="passenger">${escHtml(voucher.passenger_name)}</div>
      <div class="pax-label">${voucher.pax_count} ${voucher.pax_count === 1 ? 'Guest' : 'Guests'}</div>

      <div class="qr-section">
        <img src="${qrDataUrl}" alt="Voucher QR Code">
        <div class="voucher-code">${escHtml(voucher.code)}</div>
        <div class="scan-hint">Scan at lounge entrance · One-time use only</div>
      </div>

      <div class="section-label">Validity Period</div>
      <div class="validity-row">
        <div class="validity-box">
          <div class="v-label">Valid From</div>
          <div class="v-date">${fmt(voucher.start_date)}</div>
        </div>
        <div class="validity-box">
          <div class="v-label">Valid Until</div>
          <div class="v-date">${fmt(voucher.expiry_date)}</div>
        </div>
      </div>

      <div class="section-label">Eligible Outlets (${outlets.length})</div>
      ${outletRows || '<p style="font-size:13px;color:#94a3b8;">All program outlets</p>'}
    </div>

    <div class="footer">
      EATs Voucher System &nbsp;·&nbsp; Non-transferable<br>
      For support, contact the issuing partner
    </div>

  </div>
</body>
</html>`);
};

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
