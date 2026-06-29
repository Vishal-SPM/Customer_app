const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'eats_jwt_secret_dev';

async function requireLogin(req, res, next) {
  try {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function requirePermission(perm) {
  return async (req, res, next) => {
    await requireLogin(req, res, () => {
      if (req.user.is_superadmin) return next();
      if (!(req.user.permissions || []).includes(perm)) {
        return res.status(403).json({ error: `Permission required: ${perm}` });
      }
      next();
    });
  };
}

module.exports = { requireLogin, requirePermission, JWT_SECRET };
