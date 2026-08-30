/**
 * routes/admin.js — cooperative admin dashboard.
 * Every route here is admin-only; requireRole('admin') rejects everyone else
 * with 403 before the handler runs.
 */

const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireRole('admin'));

// GET /api/admin/stats
router.get('/stats', (_req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const workers = one(`SELECT COUNT(*) AS n FROM workers`).n;
  const verified = one(`SELECT COUNT(*) AS n FROM workers WHERE verification = 'Verified'`).n;
  const pending = one(`SELECT COUNT(*) AS n FROM workers WHERE verification = 'Pending Verification'`).n;
  const completed = one(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'Completed'`).n;
  const activeBookings = one(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('Pending','Confirmed')`).n;
  const revenue = one(`SELECT COALESCE(SUM(amount),0) AS n FROM bookings WHERE status = 'Completed'`).n;
  const monthRevenue = one(
    `SELECT COALESCE(SUM(amount),0) AS n FROM bookings
      WHERE status = 'Completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`
  ).n;
  const customers = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).n;
  // Average of the workers' ratings — the admin card used to show a made-up 4.7.
  const avgRating = one(`SELECT ROUND(COALESCE(AVG(rating), 0), 1) AS n FROM workers`).n;

  res.json({
    stats: {
      workers, verifiedWorkers: verified, pendingVerification: pending,
      completedBookings: completed, activeBookings, customers,
      revenue, monthRevenue, avgRating
    }
  });
});

// GET /api/admin/analytics  — demand share per service, from real bookings
// where there are any, otherwise the seeded demand figure.
router.get('/analytics', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.name, s.icon, s.demand,
              (SELECT COUNT(*) FROM bookings b WHERE b.service = s.name) AS bookings
         FROM services s ORDER BY s.demand DESC`
    )
    .all();

  const total = rows.reduce((sum, r) => sum + r.bookings, 0);
  const analytics = rows.map((r) => ({
    name: r.name,
    icon: r.icon,
    bookings: r.bookings,
    percent: total > 0 ? Math.round((r.bookings / total) * 100) : r.demand
  }));

  res.json({ analytics, totalBookings: total });
});

// GET /api/admin/workers  — full list including suspended
router.get('/workers', (_req, res) => {
  const workers = db
    .prepare(
      `SELECT id, code, name, service, phone, rating, jobs_done,
              distance_km, price_from, verification, availability, created_at
         FROM workers ORDER BY
           CASE verification WHEN 'Pending Verification' THEN 0 ELSE 1 END,
           name`
    )
    .all();
  res.json({ workers });
});

// PATCH /api/admin/workers/:id   { verification } and/or { availability }
router.patch('/workers/:id', (req, res) => {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found.' });

  const updates = {};
  if (req.body.verification !== undefined) {
    const v = String(req.body.verification);
    if (!['Verified', 'Pending Verification', 'Suspended'].includes(v)) {
      return res.status(400).json({ error: 'Invalid verification value.' });
    }
    updates.verification = v;
  }
  if (req.body.availability !== undefined) {
    const a = String(req.body.availability);
    if (!['Available', 'Unavailable'].includes(a)) {
      return res.status(400).json({ error: 'Invalid availability value.' });
    }
    updates.availability = a;
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const setClause = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE workers SET ${setClause} WHERE id = @id`).run({ ...updates, id: worker.id });

  audit('admin.worker_update', {
    userId: req.user.id, entity: 'worker', entityId: worker.code,
    details: updates, ip: req.ip
  });

  res.json({ worker: db.prepare('SELECT * FROM workers WHERE id = ?').get(worker.id) });
});

// GET /api/admin/audit?limit=50
router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const entries = db
    .prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, u.email
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit);
  res.json({ entries });
});

module.exports = router;
