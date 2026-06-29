const { prepare } = require('./database');

function getEligibleOutlets(benefitScope, programId) {
  const scope = typeof benefitScope === 'string' ? JSON.parse(benefitScope) : benefitScope;

  const base = `
    SELECT o.id, o.name, o.airport_code, o.terminal,
           o.requires_boarding_pass, o.lounge_group_id,
           po.price AS program_price
    FROM outlets o
    JOIN program_outlets po ON po.outlet_id = o.id
    WHERE po.program_id = ?
  `;

  switch (scope.type) {
    case 'outlet':
      return prepare(`${base} AND o.id = ?`).all(programId, scope.outlet_id);
    case 'lounge_group':
      return prepare(`${base} AND o.lounge_group_id = ?`).all(programId, scope.lounge_group_id);
    case 'airport':
      return prepare(`${base} AND o.airport_code = ?`).all(programId, scope.airport_code);
    case 'airport_terminal':
      return prepare(`${base} AND o.airport_code = ? AND o.terminal = ?`).all(programId, scope.airport_code, scope.terminal);
    case 'program':
    default:
      return prepare(base).all(programId);
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function voucherStatus(voucher) {
  const today = new Date().toISOString().split('T')[0];
  if (voucher.status === 'redeemed') return 'redeemed';
  if (voucher.status === 'voided')   return 'voided';
  if (today > voucher.expiry_date)   return 'expired';
  if (today < voucher.start_date)    return 'upcoming';
  return 'active';
}

module.exports = { getEligibleOutlets, addDays, voucherStatus };
