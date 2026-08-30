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
    demand     INTEGER NOT NULL DEFAULT 0
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

  CREATE INDEX IF NOT EXISTS idx_workers_service  ON workers(service);
  CREATE INDEX IF NOT EXISTS idx_bookings_cust    ON bookings(customer_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_worker  ON bookings(worker_id);
  CREATE INDEX IF NOT EXISTS idx_chat_session     ON chat_messages(session_id);
`);

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

module.exports = { db, audit };
