/**
 * seed.js — fills an empty database with the demo data.
 *
 *   npm run seed     insert only if the tables are empty (safe to re-run)
 *   npm run reset    wipe everything and re-insert
 *
 * The workers, services and demand numbers below are the exact mock values
 * that used to be hardcoded in js/landing.js and js/admin.js, so the site
 * looks identical after the switch to a real database.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const FORCE = process.argv.includes('--force');

const IS_PROD = process.env.NODE_ENV === 'production';

/* The three demo logins are a convenience for local work and for judges
   clicking through a demo — but their password is published in the README and
   on the login page, and one of them is an admin. So on a production deploy
   they are skipped unless you explicitly ask for them with SEED_DEMO=true.
   Set DEMO_PASSWORD if you do want them live with a password of your own. */
const SEED_DEMO_USERS = !IS_PROD || process.env.SEED_DEMO === 'true';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

const USERS = [
  { name: 'Rahul Sharma', email: 'customer@demo.com', phone: '9810012345', role: 'customer' },
  { name: 'Ramesh Kumar', email: 'worker@demo.com',   phone: '9810054321', role: 'worker'   },
  { name: 'Cooperative Admin', email: 'admin@demo.com', phone: '9810099999', role: 'admin'  }
];

const SERVICES = [
  { name: 'Electrician', icon: 'electrical_services', base_price: 450, demand: 92 },
  { name: 'Plumber',     icon: 'plumbing',            base_price: 350, demand: 81 },
  { name: 'Cleaner',     icon: 'cleaning_services',   base_price: 300, demand: 74 },
  { name: 'Driver',      icon: 'local_taxi',          base_price: 500, demand: 63 },
  { name: 'Carpenter',   icon: 'carpenter',           base_price: 400, demand: 52 },
  { name: 'Painter',     icon: 'format_paint',        base_price: 380, demand: 45 }
];

const WORKERS = [
  { code: 'SHK-9024', name: 'Ramesh Kumar',  service: 'Electrician', rating: 4.8, distance_km: 1.2, price_from: 450, verification: 'Verified',             availability: 'Available',   jobs_done: 214, phone: '9810054321' },
  { code: 'SHK-9131', name: 'Amit Sharma',   service: 'Electrician', rating: 4.6, distance_km: 2.1, price_from: 400, verification: 'Pending Verification', availability: 'Available',   jobs_done: 96,  phone: '9810054322' },
  { code: 'SHK-9145', name: 'Rajesh Singh',  service: 'Plumber',     rating: 4.9, distance_km: 0.8, price_from: 350, verification: 'Verified',             availability: 'Available',   jobs_done: 301, phone: '9810054323' },
  { code: 'SHK-9152', name: 'Mohit Kumar',   service: 'Plumber',     rating: 4.7, distance_km: 1.7, price_from: 400, verification: 'Verified',             availability: 'Available',   jobs_done: 142, phone: '9810054324' },
  { code: 'SHK-9174', name: 'Sunita Devi',   service: 'Cleaner',     rating: 4.8, distance_km: 1.0, price_from: 300, verification: 'Verified',             availability: 'Unavailable', jobs_done: 188, phone: '9810054325' },
  { code: 'SHK-9208', name: 'Vikram Rawat',  service: 'Driver',      rating: 4.9, distance_km: 1.5, price_from: 500, verification: 'Verified',             availability: 'Available',   jobs_done: 260, phone: '9810054326' },
  { code: 'SHK-9233', name: 'Imran Qureshi', service: 'Carpenter',   rating: 4.7, distance_km: 2.4, price_from: 400, verification: 'Verified',             availability: 'Available',   jobs_done: 74,  phone: '9810054327' },
  { code: 'SHK-9260', name: 'Lakshmi Nair',  service: 'Painter',     rating: 4.6, distance_km: 3.1, price_from: 380, verification: 'Pending Verification', availability: 'Available',   jobs_done: 41,  phone: '9810054328' }
];

function isEmpty() {
  // Services are seeded in every mode, so they — not users — are the reliable
  // "has this database been filled yet?" marker. (In production the demo
  // users are skipped, so a users-count check would re-seed on every boot.)
  return db.prepare('SELECT COUNT(*) AS n FROM services').get().n === 0;
}

function wipe() {
  db.exec(`
    DELETE FROM chat_messages;
    DELETE FROM audit_log;
    DELETE FROM bookings;
    DELETE FROM workers;
    DELETE FROM services;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN
      ('users','services','workers','bookings','chat_messages','audit_log');
  `);
}

const run = db.transaction(() => {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const insertUser = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)`
  );
  const userIds = {};
  if (SEED_DEMO_USERS) {
    for (const u of USERS) {
      userIds[u.email] = insertUser.run(u.name, u.email, u.phone, hash, u.role).lastInsertRowid;
    }
  }

  const insertService = db.prepare(
    `INSERT INTO services (name, icon, base_price, demand) VALUES (?, ?, ?, ?)`
  );
  for (const s of SERVICES) insertService.run(s.name, s.icon, s.base_price, s.demand);

  const insertWorker = db.prepare(
    `INSERT INTO workers (code, user_id, name, service, phone, rating, jobs_done,
                          distance_km, price_from, verification, availability)
     VALUES (@code, @user_id, @name, @service, @phone, @rating, @jobs_done,
             @distance_km, @price_from, @verification, @availability)`
  );
  const workerIds = {};
  for (const w of WORKERS) {
    // Link the demo worker login to Ramesh Kumar's worker profile.
    const user_id = w.code === 'SHK-9024' ? (userIds['worker@demo.com'] || null) : null;
    workerIds[w.name] = insertWorker.run({ ...w, user_id }).lastInsertRowid;
  }

  // A few bookings so the dashboards are not empty on first load. These hang
  // off the demo customer, so they only make sense when that account exists.
  if (!SEED_DEMO_USERS) return;

  const insertBooking = db.prepare(
    `INSERT INTO bookings (code, customer_id, worker_id, service, customer_name, mobile,
                           address, preferred_date, preferred_time, instructions, amount, status)
     VALUES (@code, @customer_id, @worker_id, @service, @customer_name, @mobile,
             @address, @preferred_date, @preferred_time, @instructions, @amount, @status)`
  );
  const today = new Date();
  const dateIn = (days) =>
    new Date(today.getTime() + days * 86400000).toISOString().split('T')[0];

  const seedBookings = [
    { code: 'SS-2026-1001', worker: 'Ramesh Kumar', service: 'Electrician', amount: 450, status: 'Confirmed', name: 'Rahul Sharma',  day: 1,  time: '10:00 AM', note: 'Fan in the bedroom is sparking.' },
    { code: 'SS-2026-1002', worker: 'Amit Sharma',  service: 'Electrician', amount: 400, status: 'Pending',   name: 'Priya Patel',   day: 2,  time: '02:00 PM', note: '' },
    { code: 'SS-2026-1003', worker: 'Sunita Devi',  service: 'Cleaner',     amount: 300, status: 'Completed', name: 'Ankit Verma',   day: -3, time: '09:00 AM', note: 'Deep clean, two bedrooms.' }
  ];

  for (const b of seedBookings) {
    insertBooking.run({
      code: b.code,
      customer_id: userIds['customer@demo.com'],
      worker_id: workerIds[b.worker],
      service: b.service,
      customer_name: b.name,
      mobile: '9810012345',
      address: '221B, Sector 15, Gurugram, Haryana',
      preferred_date: dateIn(b.day),
      preferred_time: b.time,
      instructions: b.note,
      amount: b.amount,
      status: b.status
    });
  }
});

if (!isEmpty() && !FORCE) {
  console.log('Database already has data. Nothing to do.');
  console.log('Run "npm run reset" if you want to wipe it and start over.');
  process.exit(0);
}

if (FORCE) {
  wipe();
  console.log('Wiped existing data.');
}

run();

const demoBlock = SEED_DEMO_USERS
  ? `  Demo logins (password for all three: ${DEMO_PASSWORD})
    customer@demo.com   customer
    worker@demo.com     worker
    admin@demo.com      admin`
  : `  Demo logins SKIPPED (NODE_ENV=production).
    Nobody can sign in yet. Create your admin account with:
      npm run create-admin
    Or set SEED_DEMO=true to bring the demo logins back.`;

console.log(`
Seeded successfully.

${demoBlock}

  ${SERVICES.length} services, ${WORKERS.length} workers${SEED_DEMO_USERS ? ', 3 bookings' : ''}.
`);
