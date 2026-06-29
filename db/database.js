const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE  = path.join(DATA_DIR, 'vouchers.sqlite');

let _db = null;

// ── Persistence ───────────────────────────────────────────────────────────────

function save() {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(data));
}

// ── Init (async, called once at server startup) ───────────────────────────────

async function init() {
  if (_db) return;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  _db = fs.existsSync(DB_FILE)
    ? new SQL.Database(fs.readFileSync(DB_FILE))
    : new SQL.Database();

  const schema = [
    `CREATE TABLE IF NOT EXISTS clients (
       id         TEXT PRIMARY KEY,
       name       TEXT NOT NULL,
       logo_url   TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS programs (
       id               TEXT PRIMARY KEY,
       client_id        TEXT NOT NULL,
       name             TEXT NOT NULL,
       code_prefix      TEXT NOT NULL UNIQUE,
       validity_days    INTEGER NOT NULL DEFAULT 30,
       redemption_modes TEXT NOT NULL DEFAULT '["portal","api","app"]',
       api_key          TEXT NOT NULL UNIQUE,
       created_at       TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS outlets (
       id                     TEXT PRIMARY KEY,
       name                   TEXT NOT NULL,
       airport_code           TEXT NOT NULL,
       terminal               TEXT,
       requires_boarding_pass INTEGER NOT NULL DEFAULT 0,
       lounge_group_id        TEXT,
       created_at             TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE TABLE IF NOT EXISTS program_outlets (
       program_id TEXT NOT NULL,
       outlet_id  TEXT NOT NULL,
       price      REAL NOT NULL DEFAULT 0,
       PRIMARY KEY (program_id, outlet_id)
     )`,
    `CREATE TABLE IF NOT EXISTS vouchers (
       id              TEXT PRIMARY KEY,
       program_id      TEXT NOT NULL,
       code            TEXT NOT NULL UNIQUE,
       status          TEXT NOT NULL DEFAULT 'active',
       passenger_name  TEXT,
       pax_count       INTEGER NOT NULL DEFAULT 1,
       benefit_scope   TEXT NOT NULL,
       start_date      TEXT NOT NULL,
       expiry_date     TEXT NOT NULL,
       delivery_method TEXT DEFAULT 'download',
       created_at      TEXT DEFAULT (datetime('now')),
       redeemed_at     TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS redemptions (
       id                   TEXT PRIMARY KEY,
       voucher_id           TEXT NOT NULL,
       outlet_id            TEXT,
       redeemed_by          TEXT,
       boarding_pass_number TEXT,
       redeemed_at          TEXT DEFAULT (datetime('now'))
     )`
  ];

  for (const stmt of schema) _db.run(stmt);
}

// ── better-sqlite3 compatibility shim ────────────────────────────────────────
//
// Routes call db.prepare('...').get(a, b) / .all(a, b) / .run(a, b).
// This shim makes sql.js look identical to that API.

function prepare(sql) {
  return {
    get(...params) {
      const stmt = _db.prepare(sql);
      if (params.length) stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },
    all(...params) {
      const results = [];
      const stmt    = _db.prepare(sql);
      if (params.length) stmt.bind(params);
      while (stmt.step()) results.push({ ...stmt.getAsObject() });
      stmt.free();
      return results;
    },
    run(...params) {
      _db.run(sql, params);
      save();
    }
  };
}

module.exports = { init, prepare };
