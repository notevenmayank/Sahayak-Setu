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
  const activeWorkers = one(`SELECT COUNT(*) AS n FROM workers WHERE is_blacklisted = 0 AND verification != 'Suspended'`).n;
  const blacklistedWorkers = one(`SELECT COUNT(*) AS n FROM workers WHERE is_blacklisted = 1`).n;

  const totalBookings = one(`SELECT COUNT(*) AS n FROM bookings`).n;
  const completed = one(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'Completed'`).n;
  const activeBookings = one(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('Pending','Confirmed')`).n;
  const cancelledBookings = one(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'Cancelled'`).n;

  const revenue = one(`SELECT COALESCE(SUM(amount),0) AS n FROM bookings WHERE status = 'Completed'`).n;
  const monthRevenue = one(
    `SELECT COALESCE(SUM(amount),0) AS n FROM bookings
      WHERE status = 'Completed' AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')`
  ).n;

  const customers = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).n;
  const totalUsers = one(`SELECT COUNT(*) AS n FROM users`).n;
  const suspendedUsers = one(`SELECT COUNT(*) AS n FROM users WHERE status = 'Suspended'`).n;
  const avgRating = one(`SELECT ROUND(COALESCE(AVG(rating), 0), 1) AS n FROM workers`).n;

  res.json({
    stats: {
      workers,
      totalWorkers: workers,
      verifiedWorkers: verified,
      pendingVerification: pending,
      activeWorkers,
      blacklistedWorkers,
      totalBookings,
      completedBookings: completed,
      activeBookings,
      cancelledBookings,
      customers,
      totalUsers,
      suspendedUsers,
      revenue,
      monthRevenue,
      avgRating
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

/* ------------------------------------------------------------------ *
 * 2. Workers Management & Blacklisting
 * ------------------------------------------------------------------ */

// GET /api/admin/workers?q=...&status=...
router.get('/workers', (req, res) => {
  const { q, status } = req.query;
  const where = [];
  const params = {};

  if (q) {
    where.push('(LOWER(name) LIKE @q OR LOWER(code) LIKE @q OR LOWER(service) LIKE @q OR phone LIKE @q)');
    params.q = `%${String(q).toLowerCase()}%`;
  }

  if (status === 'blacklisted') {
    where.push('is_blacklisted = 1');
  } else if (status === 'active') {
    where.push("is_blacklisted = 0 AND verification != 'Suspended'");
  } else if (status === 'pending') {
    where.push("verification = 'Pending Verification'");
  } else if (status === 'suspended') {
    where.push("verification = 'Suspended'");
  } else if (status === 'verified') {
    where.push("verification = 'Verified'");
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const workers = db
    .prepare(
      `SELECT id, code, user_id, name, service, phone, rating, jobs_done,
              distance_km, price_from, verification, availability,
              is_blacklisted, blacklist_reason, created_at
         FROM workers ${whereClause}
        ORDER BY
          is_blacklisted DESC,
          CASE verification WHEN 'Pending Verification' THEN 0 ELSE 1 END,
          name`
    )
    .all(params);

  res.json({ workers, count: workers.length });
});

// POST /api/admin/workers/:id/blacklist   { reason }
router.post('/workers/:id/blacklist', (req, res) => {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found.' });

  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) {
    return res.status(400).json({ error: 'Please provide a clear reason for blacklisting this worker (minimum 3 characters).' });
  }

  db.prepare(
    `UPDATE workers
        SET is_blacklisted = 1,
            blacklist_reason = ?,
            availability = 'Unavailable'
      WHERE id = ?`
  ).run(reason, worker.id);

  audit('BLACKLIST_WORKER', {
    userId: req.user.id,
    entity: 'worker',
    entityId: worker.code,
    details: { workerId: worker.id, workerName: worker.name, reason },
    ip: req.ip
  });

  const updated = db.prepare('SELECT * FROM workers WHERE id = ?').get(worker.id);
  res.json({ ok: true, message: `${worker.name} has been blacklisted.`, worker: updated });
});

// POST /api/admin/workers/:id/unblacklist
router.post('/workers/:id/unblacklist', (req, res) => {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(req.params.id);
  if (!worker) return res.status(404).json({ error: 'Worker not found.' });

  db.prepare(
    `UPDATE workers
        SET is_blacklisted = 0,
            blacklist_reason = NULL,
            availability = 'Available'
      WHERE id = ?`
  ).run(worker.id);

  audit('UNBLACKLIST_WORKER', {
    userId: req.user.id,
    entity: 'worker',
    entityId: worker.code,
    details: { workerId: worker.id, workerName: worker.name },
    ip: req.ip
  });

  const updated = db.prepare('SELECT * FROM workers WHERE id = ?').get(worker.id);
  res.json({ ok: true, message: `${worker.name} has been reactivated and unblacklisted.`, worker: updated });
});

// PATCH /api/admin/workers/:id   { verification, availability }
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
    userId: req.user.id,
    entity: 'worker',
    entityId: worker.code,
    details: updates,
    ip: req.ip
  });

  res.json({ worker: db.prepare('SELECT * FROM workers WHERE id = ?').get(worker.id) });
});

/* ------------------------------------------------------------------ *
 * 3. Bookings Management & Admin Cancellation
 * ------------------------------------------------------------------ */

// GET /api/admin/bookings?status=...&q=...
router.get('/bookings', (req, res) => {
  const { status, q } = req.query;
  const where = [];
  const params = {};

  if (status && status !== 'all') {
    where.push('b.status = @status');
    params.status = String(status);
  }

  if (q) {
    where.push('(LOWER(b.code) LIKE @q OR LOWER(b.customer_name) LIKE @q OR LOWER(b.service) LIKE @q OR LOWER(COALESCE(w.name, \'\')) LIKE @q)');
    params.q = `%${String(q).toLowerCase()}%`;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT b.*,
              w.name AS worker_name, w.code AS worker_code, w.service AS worker_service,
              w.phone AS worker_phone, w.rating AS worker_rating,
              u.email AS customer_email
         FROM bookings b
         LEFT JOIN workers w ON w.id = b.worker_id
         LEFT JOIN users u ON u.id = b.customer_id
        ${whereClause}
        ORDER BY b.id DESC LIMIT 200`
    )
    .all(params);

  const bookings = rows.map((r) => ({
    id: r.id,
    code: r.code,
    service: r.service,
    status: r.status,
    amount: r.amount,
    customerName: r.customer_name,
    customerEmail: r.customer_email || null,
    mobile: r.mobile,
    address: r.address,
    preferredDate: r.preferred_date,
    preferredTime: r.preferred_time,
    instructions: r.instructions,
    travelMinutes: r.travel_minutes || 0,
    isEmergency: Boolean(r.is_emergency),
    cancellationReason: r.cancellation_reason || null,
    createdAt: r.created_at,
    worker: r.worker_name
      ? { id: r.worker_id, code: r.worker_code, name: r.worker_name, service: r.worker_service, phone: r.worker_phone, rating: r.worker_rating }
      : null
  }));

  res.json({ bookings, count: bookings.length });
});

// POST /api/admin/bookings/:id/cancel   { reason }
router.post('/bookings/:id/cancel', (req, res) => {
  const booking = db
    .prepare('SELECT * FROM bookings WHERE id = ? OR code = ?')
    .get(req.params.id, req.params.id);

  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (booking.status === 'Cancelled') {
    return res.status(400).json({ error: 'This booking is already cancelled.' });
  }

  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) {
    return res.status(400).json({ error: 'Please enter a cancellation reason (minimum 3 characters).' });
  }

  db.prepare(
    `UPDATE bookings
        SET status = 'Cancelled',
            cancellation_reason = ?
      WHERE id = ?`
  ).run(reason, booking.id);

  audit('CANCEL_BOOKING', {
    userId: req.user.id,
    entity: 'booking',
    entityId: booking.code,
    details: {
      bookingId: booking.id,
      code: booking.code,
      service: booking.service,
      customerName: booking.customer_name,
      previousStatus: booking.status,
      reason
    },
    ip: req.ip
  });

  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking.id);
  res.json({ ok: true, message: `Booking ${booking.code} has been cancelled by Admin.`, booking: updated });
});

/* ------------------------------------------------------------------ *
 * 4. Users Management & Suspension
 * ------------------------------------------------------------------ */

// GET /api/admin/users?role=...&status=...&q=...
router.get('/users', (req, res) => {
  const { role, status, q } = req.query;
  const where = [];
  const params = {};

  if (role && role !== 'all') {
    where.push('role = @role');
    params.role = String(role);
  }

  if (status && status !== 'all') {
    where.push('status = @status');
    params.status = String(status);
  }

  if (q) {
    where.push('(LOWER(name) LIKE @q OR LOWER(email) LIKE @q OR phone LIKE @q)');
    params.q = `%${String(q).toLowerCase()}%`;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const users = db
    .prepare(
      `SELECT id, name, email, phone, role, status, created_at
         FROM users ${whereClause}
        ORDER BY id DESC LIMIT 200`
    )
    .all(params);

  res.json({ users, count: users.length });
});

// PATCH /api/admin/users/:id/status   { status: 'Active'|'Suspended', reason?: string }
router.patch('/users/:id/status', (req, res) => {
  const targetUser = db.prepare('SELECT id, name, email, phone, role, status FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.status(404).json({ error: 'User not found.' });

  const newStatus = String(req.body.status || '').trim();
  if (!['Active', 'Suspended'].includes(newStatus)) {
    return res.status(400).json({ error: 'Status must be either Active or Suspended.' });
  }

  if (req.user.id === targetUser.id && newStatus === 'Suspended') {
    return res.status(400).json({ error: 'You cannot suspend your own admin account.' });
  }

  const reason = String(req.body.reason || '').trim();

  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, targetUser.id);

  const actionName = newStatus === 'Suspended' ? 'SUSPEND_USER' : 'ACTIVATE_USER';
  audit(actionName, {
    userId: req.user.id,
    entity: 'user',
    entityId: targetUser.id,
    details: {
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role,
      newStatus,
      reason: reason || undefined
    },
    ip: req.ip
  });

  const updated = db.prepare('SELECT id, name, email, phone, role, status, created_at FROM users WHERE id = ?').get(targetUser.id);
  res.json({ ok: true, message: `User ${targetUser.email} is now ${newStatus}.`, user: updated });
});

/* ------------------------------------------------------------------ *
 * 5. Audit Trail
 * ------------------------------------------------------------------ */

// GET /api/admin/audit?limit=50&action=...
router.get('/audit', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 300);
  const { action, q } = req.query;
  const where = [];
  const params = {};

  if (action && action !== 'all') {
    where.push('a.action = @action');
    params.action = String(action);
  }

  if (q) {
    where.push('(LOWER(a.action) LIKE @q OR LOWER(COALESCE(a.entity, \'\')) LIKE @q OR LOWER(COALESCE(a.entity_id, \'\')) LIKE @q OR LOWER(COALESCE(u.email, \'\')) LIKE @q)');
    params.q = `%${String(q).toLowerCase()}%`;
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const entries = db
    .prepare(
      `SELECT a.id, a.user_id, a.action, a.entity, a.entity_id, a.details, a.ip, a.created_at,
              u.email, u.name AS user_name, u.role AS user_role
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
        ${whereClause}
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(...(Object.keys(params).length ? [params, limit] : [limit]));

  res.json({ entries, count: entries.length });
});

module.exports = router;
