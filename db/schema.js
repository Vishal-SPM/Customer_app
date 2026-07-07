const pool   = require('./pool');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

async function createSchema() {
  const client = await pool.connect();
  try {
    await client.query(`

      CREATE TABLE IF NOT EXISTS clients (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        logo_url   TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sites (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        iata_code  TEXT NOT NULL UNIQUE,
        city       TEXT,
        country    TEXT DEFAULT 'India',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS services (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS outlets (
        id                     TEXT PRIMARY KEY,
        site_id                TEXT NOT NULL REFERENCES sites(id),
        name                   TEXT NOT NULL,
        terminal_type          TEXT,
        terminal_name          TEXT,
        gate_type              TEXT,
        direction              TEXT,
        amenities              TEXT[],
        requires_boarding_pass BOOLEAN DEFAULT FALSE,
        created_at             TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS outlet_services (
        outlet_id  TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
        service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        PRIMARY KEY (outlet_id, service_id)
      );

      CREATE TABLE IF NOT EXISTS programs (
        id                TEXT PRIMARY KEY,
        client_id         TEXT NOT NULL REFERENCES clients(id),
        name              TEXT NOT NULL,
        code_prefix       TEXT NOT NULL UNIQUE,
        validity_days     INTEGER NOT NULL DEFAULT 30,
        restriction_level TEXT NOT NULL DEFAULT 'program',
        api_key           TEXT NOT NULL UNIQUE,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS program_services (
        program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        PRIMARY KEY (program_id, service_id)
      );

      CREATE TABLE IF NOT EXISTS program_outlets (
        program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        outlet_id  TEXT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
        price      NUMERIC(10,2) DEFAULT 0,
        PRIMARY KEY (program_id, outlet_id)
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id             TEXT PRIMARY KEY,
        program_id     TEXT NOT NULL REFERENCES programs(id),
        service_id     TEXT NOT NULL REFERENCES services(id),
        outlet_id      TEXT REFERENCES outlets(id),
        site_id        TEXT REFERENCES sites(id),
        code           TEXT NOT NULL UNIQUE,
        status         TEXT NOT NULL DEFAULT 'active',
        passenger_name TEXT NOT NULL,
        pax_count      INTEGER NOT NULL DEFAULT 1,
        start_date     DATE NOT NULL,
        expiry_date    DATE NOT NULL,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        redeemed_at    TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS temp_auths (
        id         TEXT PRIMARY KEY,
        voucher_id TEXT NOT NULL REFERENCES vouchers(id),
        expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
        used       BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS redemptions (
        id           TEXT PRIMARY KEY,
        voucher_id   TEXT NOT NULL REFERENCES vouchers(id),
        temp_auth_id TEXT REFERENCES temp_auths(id),
        pax_count    INTEGER,
        redeemed_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        email      TEXT,
        phone      TEXT,
        api_key    TEXT NOT NULL UNIQUE,
        is_active  BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE outlets ADD COLUMN IF NOT EXISTS vendor_id TEXT REFERENCES vendors(id);

      ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS outlet_id  TEXT REFERENCES outlets(id);
      ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS vendor_id  TEXT REFERENCES vendors(id);

      CREATE TABLE IF NOT EXISTS users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_superadmin BOOLEAN DEFAULT FALSE,
        is_active     BOOLEAN DEFAULT TRUE,
        created_by    TEXT REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        PRIMARY KEY (user_id, permission)
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type    TEXT    NOT NULL DEFAULT 'internal';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS all_programs BOOLEAN NOT NULL DEFAULT TRUE;

      ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS passenger_email TEXT;
      ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS passenger_phone TEXT;

      CREATE TABLE IF NOT EXISTS notifications_log (
        id         TEXT PRIMARY KEY,
        voucher_id TEXT REFERENCES vouchers(id) ON DELETE SET NULL,
        type       TEXT NOT NULL,
        channel    TEXT NOT NULL,
        recipient  TEXT NOT NULL,
        status     TEXT NOT NULL DEFAULT 'pending',
        error      TEXT,
        sent_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_programs (
        user_id    TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, program_id)
      );

      -- Walk-in price per outlet-service
      ALTER TABLE outlet_services ADD COLUMN IF NOT EXISTS walking_price NUMERIC(10,2) NOT NULL DEFAULT 0;

      -- Outlet groups
      CREATE TABLE IF NOT EXISTS outlet_groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS outlet_group_members (
        outlet_group_id TEXT NOT NULL REFERENCES outlet_groups(id) ON DELETE CASCADE,
        outlet_id       TEXT NOT NULL REFERENCES outlets(id)       ON DELETE CASCADE,
        PRIMARY KEY (outlet_group_id, outlet_id)
      );

      -- Program-outlet-service pricing (3-way junction; replaces program_outlets.price)
      CREATE TABLE IF NOT EXISTS program_outlet_services (
        program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
        outlet_id  TEXT NOT NULL REFERENCES outlets(id)  ON DELETE CASCADE,
        service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        price      NUMERIC(10,2) NOT NULL,
        PRIMARY KEY (program_id, outlet_id, service_id)
      );

      -- Billing configuration on program-service junction
      ALTER TABLE program_services ADD COLUMN IF NOT EXISTS billing_model  TEXT         NOT NULL DEFAULT 'issuance';
      ALTER TABLE program_services ADD COLUMN IF NOT EXISTS unit_price     NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE program_services ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2);

      -- Service type: qr | booking | discount_voucher
      ALTER TABLE services ADD COLUMN IF NOT EXISTS service_type TEXT NOT NULL DEFAULT 'qr';

      -- Seed existing services to correct types
      UPDATE services SET service_type = 'booking'
        WHERE service_type = 'qr'
          AND (LOWER(name) LIKE '%meet%' OR LOWER(name) LIKE '%greet%' OR LOWER(name) LIKE '%assist%');

      -- Redemption billing fields (discount model)
      ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS actual_bill_amount NUMERIC(10,2);
      ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS discounted_amount  NUMERIC(10,2);

      -- Billing events — one row per billable event (issuance or redemption)
      CREATE TABLE IF NOT EXISTS billing_events (
        id                 TEXT PRIMARY KEY,
        voucher_id         TEXT NOT NULL REFERENCES vouchers(id),
        program_id         TEXT NOT NULL REFERENCES programs(id),
        service_id         TEXT NOT NULL REFERENCES services(id),
        outlet_id          TEXT REFERENCES outlets(id),
        billing_model      TEXT NOT NULL,
        unit_price         NUMERIC(10,2) NOT NULL DEFAULT 0,
        actual_bill_amount NUMERIC(10,2),
        billed_amount      NUMERIC(10,2) NOT NULL,
        event_type         TEXT NOT NULL,
        event_at           TIMESTAMPTZ DEFAULT NOW()
      );

    `);

    // Seed default superadmin on first run
    const { rows } = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash('Admin@123', 10);
      await client.query(`
        INSERT INTO users (id, name, email, password_hash, is_superadmin)
        VALUES ($1,$2,$3,$4,$5)
      `, [uuid(), 'Superadmin', 'admin@eats.com', hash, true]);
      console.log('\n  ┌─────────────────────────────────────────┐');
      console.log('  │  Default superadmin account created     │');
      console.log('  │  Email:    admin@eats.com               │');
      console.log('  │  Password: Admin@123                    │');
      console.log('  │  Change password after first login!     │');
      console.log('  └─────────────────────────────────────────┘\n');
    }

    console.log('  Schema ready');
  } finally {
    client.release();
  }
}

module.exports = createSchema;
