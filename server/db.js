/**
 * db.js — database connection + schema.
 *
 * We use SQLite: the whole database is one file (data/app.db). There is no
 * database server to install or start. `better-sqlite3` talks to it
 * synchronously, which keeps the route code simple to read.
 *
 * On Render/Railway the container disk is wiped on every redeploy, so the
 * location is configurable: point DATA_DIR at a mounted persistent volume
 * (e.g. DATA_DIR=/var/data) and the accounts survive. Left unset, it falls
 * back to ./data, which is what you want locally.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'app.db');

/* Say where the data actually lives. On a fresh production boot with no
   volume mounted this line is the clue that the database is about to be
   thrown away on the next deploy. */
if (process.env.NODE_ENV === 'production') {
  console.log(`[db] using ${DB_FILE}`);
  if (!process.env.DATA_DIR) {
    console.warn(
      '[db] WARNING: DATA_DIR is not set, so the database sits on the container disk.\n' +
      '     On Render/Railway that disk is wiped on every redeploy and every user\n' +
      '     account will be lost. Attach a persistent volume and set DATA_DIR to it.'
    );
  }
}

const db = new Database(DB_FILE);

// WAL mode = better performance and fewer "database is locked" errors.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('customer','worker','admin')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS services (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    icon       TEXT    NOT NULL DEFAULT 'handyman',
    base_price INTEGER NOT NULL DEFAULT 300,
    demand     INTEGER NOT NULL DEFAULT 0,
    risk_level TEXT    NOT NULL DEFAULT 'MEDIUM'
               CHECK (risk_level IN ('LOW','MEDIUM','HIGH'))
  );

  CREATE TABLE IF NOT EXISTS workers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    NOT NULL UNIQUE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT    NOT NULL,
    service      TEXT    NOT NULL,
    phone        TEXT,
    rating       REAL    NOT NULL DEFAULT 4.5,
    jobs_done    INTEGER NOT NULL DEFAULT 0,
    distance_km  REAL    NOT NULL DEFAULT 2.0,
    price_from   INTEGER NOT NULL DEFAULT 300,
    verification TEXT    NOT NULL DEFAULT 'Pending Verification'
                 CHECK (verification IN ('Verified','Pending Verification','Suspended')),
    availability TEXT    NOT NULL DEFAULT 'Available'
                 CHECK (availability IN ('Available','Unavailable')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT    NOT NULL UNIQUE,
    customer_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    worker_id     INTEGER REFERENCES workers(id) ON DELETE SET NULL,
    service       TEXT    NOT NULL,
    customer_name TEXT    NOT NULL,
    mobile        TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    preferred_date TEXT   NOT NULL,
    preferred_time TEXT   NOT NULL,
    instructions  TEXT    NOT NULL DEFAULT '',
    amount        INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Pending','Confirmed','Completed','Cancelled')),
    started_at    TEXT,
    completed_at  TEXT,
    duration_minutes INTEGER,
    travel_minutes INTEGER NOT NULL DEFAULT 0,
    is_emergency  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    role       TEXT    NOT NULL CHECK (role IN ('user','assistant')),
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  /* Generic append-only trail. Useful on its own, and it is the piece the
     SIH26190 document-management pivot would need most, so it lives here now. */
  CREATE TABLE IF NOT EXISTS audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action     TEXT    NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    details    TEXT,
    ip         TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS worker_safety_metrics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id         INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    date              TEXT    NOT NULL,
    working_minutes   INTEGER NOT NULL DEFAULT 0,
    jobs_completed    INTEGER NOT NULL DEFAULT 0,
    consecutive_jobs  INTEGER NOT NULL DEFAULT 0,
    break_minutes     INTEGER NOT NULL DEFAULT 0,
    overtime_minutes  INTEGER NOT NULL DEFAULT 0,
    travel_minutes    INTEGER NOT NULL DEFAULT 0,
    high_risk_jobs    INTEGER NOT NULL DEFAULT 0,
    workload_level    TEXT    NOT NULL DEFAULT 'LOW'
                      CHECK (workload_level IN ('LOW','MEDIUM','HIGH','VERY HIGH')),
    safety_score      INTEGER NOT NULL DEFAULT 100,
    safety_status     TEXT    NOT NULL DEFAULT 'SAFE'
                      CHECK (safety_status IN ('SAFE','CAUTION','HIGH_RISK')),
    last_break_at     TEXT,
    calculated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (worker_id, date)
  );

  CREATE TABLE IF NOT EXISTS worker_breaks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    started_at  TEXT    NOT NULL,
    ended_at    TEXT,
    duration_minutes INTEGER,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worker_id   INTEGER REFERENCES workers(id) ON DELETE SET NULL,
    kind        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL,
    read_at     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS worker_locations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    latitude    REAL    NOT NULL,
    longitude   REAL    NOT NULL,
    accuracy    REAL,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS service_complaints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    service     TEXT    NOT NULL,
    latitude    REAL    NOT NULL,
    longitude   REAL    NOT NULL,
    area        TEXT,
    booking_id  INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    status      TEXT    NOT NULL DEFAULT 'Open',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS worker_insurance (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    plan_name       TEXT    NOT NULL,
    monthly_premium INTEGER NOT NULL,
    coverage_amount INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'Active',
    enrolled_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    renewal_date    TEXT,
    provider_name   TEXT    NOT NULL,
    policy_number   TEXT    NOT NULL UNIQUE,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS worker_incidents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    booking_id  INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
    type        TEXT    NOT NULL DEFAULT 'Emergency SOS',
    latitude    REAL,
    longitude   REAL,
    status      TEXT    NOT NULL DEFAULT 'Active',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS insurance_claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    incident_id INTEGER REFERENCES worker_incidents(id) ON DELETE SET NULL,
    policy_id   INTEGER REFERENCES worker_insurance(id) ON DELETE SET NULL,
    status      TEXT    NOT NULL DEFAULT 'Submitted',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workers_service  ON workers(service);
  CREATE INDEX IF NOT EXISTS idx_bookings_cust    ON bookings(customer_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_worker  ON bookings(worker_id);
  CREATE INDEX IF NOT EXISTS idx_chat_session     ON chat_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_safety_worker_date ON worker_safety_metrics(worker_id, date);
  CREATE INDEX IF NOT EXISTS idx_breaks_worker ON worker_breaks(worker_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_worker_locations ON worker_locations(worker_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_complaints_service ON service_complaints(service, area);
  CREATE INDEX IF NOT EXISTS idx_insurance_worker ON worker_insurance(worker_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_worker ON worker_incidents(worker_id);
`);

function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function ensureColumn(table, column, definition) {
  if (!tableColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate() {
  ensureColumn('workers', 'latitude', 'REAL');
  ensureColumn('workers', 'longitude', 'REAL');
  ensureColumn('services', 'risk_level', "TEXT NOT NULL DEFAULT 'MEDIUM'");
  ensureColumn('bookings', 'started_at', 'TEXT');
  ensureColumn('bookings', 'completed_at', 'TEXT');
  ensureColumn('bookings', 'duration_minutes', 'INTEGER');
  ensureColumn('bookings', 'travel_minutes', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('bookings', 'is_emergency', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('bookings', 'cancellation_reason', 'TEXT');
  ensureColumn('workers', 'is_blacklisted', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('workers', 'blacklist_reason', 'TEXT');
  ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'Active'");

  db.exec('CREATE INDEX IF NOT EXISTS idx_workers_blacklisted ON workers(is_blacklisted)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  insertSetting.run('safety.assign_high_risk', 'block_non_emergency');
  insertSetting.run('safety.emergency_allow_high_risk', 'true');
  insertSetting.run('safety.caution_deprioritize', 'true');

  const alreadySeeded = db.prepare("SELECT 1 FROM app_settings WHERE key = 'safety.risk_seeded'").get();
  if (!alreadySeeded) {
    const RISK_DEFAULTS = {
      Cleaner: 'LOW',
      Driver: 'MEDIUM',
      Painter: 'MEDIUM',
      Carpenter: 'MEDIUM',
      Plumber: 'MEDIUM',
      Electrician: 'HIGH'
    };
    const upd = db.prepare('UPDATE services SET risk_level = ? WHERE name = ?');
    for (const [name, level] of Object.entries(RISK_DEFAULTS)) {
      upd.run(level, name);
    }
    insertSetting.run('safety.risk_seeded', 'true');
  }
}

migrate();

/** Write a row to the audit trail. Never throws — logging must not break a request. */
function audit(action, { userId = null, entity = null, entityId = null, details = null, ip = null } = {}) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, action, entity, entityId == null ? null : String(entityId),
          details == null ? null : JSON.stringify(details), ip);
  } catch (err) {
    console.error('[audit] failed:', err.message);
  }
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

module.exports = { db, audit, getSetting, setSetting };
