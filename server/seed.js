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
  { code: 'SHK-9024', name: 'Ramesh Kumar',  service: 'Electrician', rating: 4.8, distance_km: 1.2, price_from: 450, verification: 'Verified',             availability: 'Available',   jobs_done: 214, phone: '9810054321', latitude: 28.6270, longitude: 77.3740 },
  { code: 'SHK-9131', name: 'Amit Sharma',   service: 'Electrician', rating: 4.6, distance_km: 2.1, price_from: 400, verification: 'Pending Verification', availability: 'Available',   jobs_done: 96,  phone: '9810054322', latitude: 28.6320, longitude: 77.3680 },
  { code: 'SHK-9145', name: 'Rajesh Singh',  service: 'Plumber',     rating: 4.9, distance_km: 0.8, price_from: 350, verification: 'Verified',             availability: 'Available',   jobs_done: 301, phone: '9810054323', latitude: 28.6250, longitude: 77.3790 },
  { code: 'SHK-9152', name: 'Mohit Kumar',   service: 'Plumber',     rating: 4.7, distance_km: 1.7, price_from: 400, verification: 'Verified',             availability: 'Available',   jobs_done: 142, phone: '9810054324', latitude: 28.6360, longitude: 77.3710 },
  { code: 'SHK-9174', name: 'Sunita Devi',   service: 'Cleaner',     rating: 4.8, distance_km: 1.0, price_from: 300, verification: 'Verified',             availability: 'Unavailable', jobs_done: 188, phone: '9810054325', latitude: 28.6210, longitude: 77.3820 },
  { code: 'SHK-9208', name: 'Vikram Rawat',  service: 'Driver',      rating: 4.9, distance_km: 1.5, price_from: 500, verification: 'Verified',             availability: 'Available',   jobs_done: 260, phone: '9810054326', latitude: 28.6290, longitude: 77.3650 },
  { code: 'SHK-9233', name: 'Imran Qureshi', service: 'Carpenter',   rating: 4.7, distance_km: 2.4, price_from: 400, verification: 'Verified',             availability: 'Available',   jobs_done: 74,  phone: '9810054327', latitude: 28.6180, longitude: 77.3770 },
  { code: 'SHK-9260', name: 'Lakshmi Nair',  service: 'Painter',     rating: 4.6, distance_km: 3.1, price_from: 380, verification: 'Pending Verification', availability: 'Available',   jobs_done: 41,  phone: '9810054328', latitude: 28.6340, longitude: 77.3850 }
];

function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM services').get().n === 0;
}

function wipe() {
  db.exec(`
    DELETE FROM insurance_claims;
    DELETE FROM worker_incidents;
    DELETE FROM worker_insurance;
    DELETE FROM service_complaints;
    DELETE FROM worker_locations;
    DELETE FROM notifications;
    DELETE FROM worker_breaks;
    DELETE FROM worker_safety_metrics;
    DELETE FROM app_settings;
    DELETE FROM chat_messages;
    DELETE FROM audit_log;
    DELETE FROM bookings;
    DELETE FROM workers;
    DELETE FROM services;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN
      ('users','services','workers','bookings','chat_messages','audit_log',
       'worker_safety_metrics','worker_breaks','notifications',
       'worker_locations','service_complaints','worker_insurance','worker_incidents','insurance_claims');
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
    `INSERT INTO services (name, icon, base_price, demand, risk_level) VALUES (?, ?, ?, ?, ?)`
  );
  const SERVICE_RISK = {
    Electrician: 'HIGH',
    Plumber: 'MEDIUM',
    Cleaner: 'LOW',
    Driver: 'MEDIUM',
    Carpenter: 'MEDIUM',
    Painter: 'MEDIUM'
  };
  for (const s of SERVICES) {
    insertService.run(s.name, s.icon, s.base_price, s.demand, SERVICE_RISK[s.name] || 'MEDIUM');
  }
  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('safety.risk_seeded', 'true')`).run();

  const insertWorker = db.prepare(
    `INSERT INTO workers (code, user_id, name, service, phone, rating, jobs_done,
                          distance_km, price_from, verification, availability, latitude, longitude)
     VALUES (@code, @user_id, @name, @service, @phone, @rating, @jobs_done,
             @distance_km, @price_from, @verification, @availability, @latitude, @longitude)`
  );
  const insertLocation = db.prepare(
    `INSERT INTO worker_locations (worker_id, latitude, longitude, accuracy, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );

  const workerIds = {};
  for (const w of WORKERS) {
    // Link the demo worker login to Ramesh Kumar's worker profile.
    const user_id = w.code === 'SHK-9024' ? (userIds['worker@demo.com'] || null) : null;
    const wid = insertWorker.run({ ...w, user_id }).lastInsertRowid;
    workerIds[w.name] = wid;
    if (w.latitude && w.longitude) {
      insertLocation.run(wid, w.latitude, w.longitude, 10);
    }
  }

  // Realistic sample complaint / service demand points for heatmap & demand insights
  const insertComplaint = db.prepare(
    `INSERT INTO service_complaints (service, latitude, longitude, area, status, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`
  );
  const COMPLAINT_DATA = [
    // Sector 62 (High demand for Electrician and Plumber)
    { service: 'Electrician', lat: 28.6275, lng: 77.3735, area: 'Sector 62', shift: '-1 hour' },
    { service: 'Electrician', lat: 28.6285, lng: 77.3750, area: 'Sector 62', shift: '-3 hour' },
    { service: 'Electrician', lat: 28.6265, lng: 77.3720, area: 'Sector 62', shift: '-5 hour' },
    { service: 'Plumber',     lat: 28.6290, lng: 77.3760, area: 'Sector 62', shift: '-2 hour' },
    { service: 'Plumber',     lat: 28.6270, lng: 77.3745, area: 'Sector 62', shift: '-6 hour' },
    { service: 'Cleaner',     lat: 28.6280, lng: 77.3730, area: 'Sector 62', shift: '-12 hour' },

    // Sector 15 (High demand for Plumber and Carpenter)
    { service: 'Plumber',     lat: 28.6310, lng: 77.3670, area: 'Sector 15', shift: '-2 hour' },
    { service: 'Plumber',     lat: 28.6325, lng: 77.3690, area: 'Sector 15', shift: '-4 hour' },
    { service: 'Plumber',     lat: 28.6300, lng: 77.3660, area: 'Sector 15', shift: '-7 hour' },
    { service: 'Carpenter',   lat: 28.6315, lng: 77.3685, area: 'Sector 15', shift: '-8 hour' },
    { service: 'Electrician', lat: 28.6330, lng: 77.3700, area: 'Sector 15', shift: '-14 hour' },

    // Sector 18 (Commercial & residential demand: Cleaner & Electrician)
    { service: 'Cleaner',     lat: 28.6220, lng: 77.3810, area: 'Sector 18', shift: '-1 hour' },
    { service: 'Cleaner',     lat: 28.6235, lng: 77.3830, area: 'Sector 18', shift: '-3 hour' },
    { service: 'Cleaner',     lat: 28.6205, lng: 77.3800, area: 'Sector 18', shift: '-5 hour' },
    { service: 'Electrician', lat: 28.6225, lng: 77.3815, area: 'Sector 18', shift: '-10 hour' },

    // Indirapuram (High demand for Painter & Plumber)
    { service: 'Painter',     lat: 28.6345, lng: 77.3840, area: 'Indirapuram', shift: '-4 hour' },
    { service: 'Painter',     lat: 28.6355, lng: 77.3860, area: 'Indirapuram', shift: '-9 hour' },
    { service: 'Plumber',     lat: 28.6335, lng: 77.3830, area: 'Indirapuram', shift: '-11 hour' },

    // Sector 50 (Demand for Driver & Cleaner)
    { service: 'Driver',      lat: 28.6295, lng: 77.3640, area: 'Sector 50', shift: '-2 hour' },
    { service: 'Driver',      lat: 28.6305, lng: 77.3665, area: 'Sector 50', shift: '-6 hour' },
    { service: 'Cleaner',     lat: 28.6285, lng: 77.3630, area: 'Sector 50', shift: '-15 hour' }
  ];

  for (const c of COMPLAINT_DATA) {
    insertComplaint.run(c.service, c.lat, c.lng, c.area, 'Open', c.shift);
  }

  // Seed demo insurance for demo worker Ramesh Kumar
  const rameshId = workerIds['Ramesh Kumar'];
  if (rameshId) {
    db.prepare(
      `INSERT INTO worker_insurance (worker_id, plan_name, monthly_premium, coverage_amount, status,
                                     enrolled_at, renewal_date, provider_name, policy_number)
       VALUES (?, ?, ?, ?, 'Active', datetime('now', '-15 days'), date('now', '+15 days'), ?, ?)`
    ).run(
      rameshId,
      'Basic Worker Protection',
      49,
      200000,
      'Sahayak Suraksha Trust (Prototype Partner)',
      'SURAKSHA-2026-9024'
    );
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
  db.exec(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES
      ('safety.assign_high_risk', 'block_non_emergency'),
      ('safety.emergency_allow_high_risk', 'true'),
      ('safety.caution_deprioritize', 'true');
  `);
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
