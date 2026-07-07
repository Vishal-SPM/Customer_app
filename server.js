require('dotenv').config();
const express      = require('express');
const path         = require('path');
const createSchema = require('./db/schema');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString().slice(11,19)}  ${req.method.padEnd(6)} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));  // public — for uptime pings
app.use('/api/auth',     require('./routes/auth'));      // public — no JWT needed
app.use('/api/admin',    require('./routes/admin'));     // superadmin only
app.use('/api/clients',  require('./routes/clients'));
app.use('/api/sites',    require('./routes/sites'));
app.use('/api/services', require('./routes/services'));
app.use('/api/outlets',  require('./routes/outlets'));
app.use('/api/programs', require('./routes/programs'));
app.use('/api/vendors',        require('./routes/vendors'));
app.use('/api/outlet-groups',  require('./routes/outlet-groups'));
app.use('/api/programs/:program_id/outlets', require('./routes/program-outlets'));
app.use('/api/reports',        require('./routes/reports'));
app.use('/api/voucher',   require('./routes/vouchers'));
app.use('/api/internal', require('./routes/internal'));
app.get('/v/:code',      require('./views/voucherView'));

// Serve dashboard for any unmatched GET
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
createSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  EATs Voucher Prototype → http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('\n  DB connection failed:', err.message);
    console.error('  Check your .env file — copy .env.example to .env and fill in Postgres credentials\n');
    process.exit(1);
  });
