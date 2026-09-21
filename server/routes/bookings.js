/**
 * routes/bookings.js — creating and managing bookings.
 *
 * Booking codes stay in the SS-2026-#### format the prototype used, but the
 * number now comes from the database instead of localStorage array length
 * (which produced duplicate IDs across browsers).
 */

const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const safety = require('../services/workerSafety');

const router = express.Router();

const TIME_SLOTS = ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
                    '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'];

function nextCode() {
  const year = new Date().getFullYear();
  const row = db
    .prepare(`SELECT code FROM bookings WHERE code LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(`SS-${year}-%`);
  const last = row ? parseInt(row.code.split('-')[2], 10) : 1000;
  return `SS-${year}-${last + 1}`;
}

function shape(row) {
  return {
    id: row.id,
    code: row.code,
    service: row.service,
    status: row.status,
    amount: row.amount,
    customerName: row.customer_name,
    mobile: row.mobile,
    address: row.address,
    preferredDate: row.preferred_date,
    preferredTime: row.preferred_time,
    instructions: row.instructions,
    createdAt: row.created_at,
    travelMinutes: row.travel_minutes || 0,
    isEmergency: Boolean(row.is_emergency),
    cancellationReason: row.cancellation_reason || null,
    worker: row.worker_name
      ? { id: row.worker_id, name: row.worker_name, service: row.worker_service, rating: row.worker_rating }
      : null
  };
}

const SELECT_BOOKING = `
  SELECT b.*, w.name AS worker_name, w.service AS worker_service, w.rating AS worker_rating
    FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id`;

// GET /api/bookings/slots?workerId=1&date=2026-08-25
// Slots already taken for that worker/date are marked unavailable.
router.get('/bookings/slots', (req, res) => {
  const { workerId, date } = req.query;
  if (!workerId || !date) return res.status(400).json({ error: 'workerId and date are required.' });

  const taken = db
    .prepare(`SELECT preferred_time FROM bookings
               WHERE worker_id = ? AND preferred_date = ? AND status IN ('Pending','Confirmed')`)
    .all(workerId, date)
    .map((r) => r.preferred_time);

  res.json({ slots: TIME_SLOTS.map((time) => ({ time, available: !taken.includes(time) })) });
});

// POST /api/bookings
// Works for guests too (customer_id stays null) so the demo flow is not blocked
// by a login wall, but a logged-in customer gets the booking attached to them.
router.post('/bookings', optionalAuth, (req, res) => {
  const b = req.body || {};
  const workerId = Number(b.workerId);
  const customerName = String(b.customerName || '').trim();
  const mobile = String(b.mobileNumber || b.mobile || '').trim();
  const address = String(b.serviceAddress || b.address || '').trim();
  const preferredDate = String(b.preferredDate || '').trim();
  const preferredTime = String(b.preferredTime || '').trim();
  const instructions = String(b.additionalInstructions || b.instructions || '').trim();
  const isEmergency = Boolean(b.isEmergency || b.emergency);

  if (!workerId) return res.status(400).json({ error: 'Please choose a worker.' });
  if (customerName.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[0-9]{10}$/.test(mobile)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  if (address.length < 8) return res.status(400).json({ error: 'Please enter the full service address.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return res.status(400).json({ error: 'Please choose a valid date.' });
  if (!preferredTime) return res.status(400).json({ error: 'Please choose a time slot.' });

  // No bookings in the past.
  const today = new Date().toISOString().split('T')[0];
  if (preferredDate < today) return res.status(400).json({ error: 'Please choose today or a future date.' });

  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!worker) return res.status(404).json({ error: 'That worker no longer exists.' });
  if (worker.is_blacklisted) {
    return res.status(409).json({ error: `${worker.name} is currently blacklisted and cannot accept bookings.` });
  }
  if (worker.availability !== 'Available') {
    return res.status(409).json({ error: `${worker.name} is currently unavailable. Please pick another worker.` });
  }

  const clash = db
    .prepare(`SELECT 1 FROM bookings WHERE worker_id = ? AND preferred_date = ?
               AND preferred_time = ? AND status IN ('Pending','Confirmed')`)
    .get(workerId, preferredDate, preferredTime);
  if (clash) {
    return res.status(409).json({ error: `${worker.name} is already booked at ${preferredTime}. Please pick another slot.` });
  }

  const gate = safety.canAssignWorker(workerId, { isEmergency });
  if (!gate.ok) {
    return res.status(gate.status || 409).json({ error: gate.error, safetyStatus: gate.snapshot && gate.snapshot.status });
  }

  let travelMinutes = Number(b.travelMinutes);
  if (!Number.isFinite(travelMinutes) || travelMinutes < 0) {
    travelMinutes = safety.estimateTravelMinutes(worker);
  }
  travelMinutes = Math.min(24 * 60, Math.round(travelMinutes));

  const code = nextCode();
  const id = db
    .prepare(
      `INSERT INTO bookings (code, customer_id, worker_id, service, customer_name, mobile,
                             address, preferred_date, preferred_time, instructions, amount, status,
                             travel_minutes, is_emergency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`
    )
    .run(code, req.user ? req.user.id : null, workerId, worker.service, customerName,
         mobile, address, preferredDate, preferredTime, instructions, worker.price_from,
         travelMinutes, isEmergency ? 1 : 0)
    .lastInsertRowid;

  try { safety.calculateForWorker(workerId); } catch (err) { console.error('[safety]', err.message); }

  audit('booking.create', {
    userId: req.user ? req.user.id : null,
    entity: 'booking', entityId: code,
    details: { workerId, service: worker.service, isEmergency }, ip: req.ip
  });

  res.status(201).json({
    booking: shape(db.prepare(`${SELECT_BOOKING} WHERE b.id = ?`).get(id)),
    ...(gate.warning ? { safetyWarning: gate.warning } : {})
  });
});

// GET /api/bookings  — what the caller is allowed to see
router.get('/bookings', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`${SELECT_BOOKING} ORDER BY b.created_at DESC`).all();
  } else if (req.user.role === 'worker') {
    const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(req.user.id);
    rows = worker
      ? db.prepare(`${SELECT_BOOKING} WHERE b.worker_id = ? ORDER BY b.created_at DESC`).all(worker.id)
      : [];
  } else {
    rows = db.prepare(`${SELECT_BOOKING} WHERE b.customer_id = ? ORDER BY b.created_at DESC`).all(req.user.id);
  }
  res.json({ bookings: rows.map(shape) });
});

// GET /api/bookings/:code  — public lookup by code, so the AI assistant and the
// confirmation screen can check a booking without a login.
router.get('/bookings/:code', (req, res) => {
  const row = db.prepare(`${SELECT_BOOKING} WHERE b.code = ?`).get(String(req.params.code).toUpperCase());
  if (!row) return res.status(404).json({ error: 'No booking found with that ID.' });
  res.json({ booking: shape(row) });
});

// PATCH /api/bookings/:code/status   { status: 'Confirmed' }
router.patch('/bookings/:code/status', requireAuth, (req, res) => {
  const status = String(req.body.status || '');
  const allowed = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const row = db.prepare('SELECT * FROM bookings WHERE code = ?').get(String(req.params.code).toUpperCase());
  if (!row) return res.status(404).json({ error: 'Booking not found.' });

  // Customers may only cancel their own booking. Workers act on jobs assigned
  // to them. Admins can set anything.
  if (req.user.role === 'customer') {
    if (row.customer_id !== req.user.id) return res.status(403).json({ error: 'That is not your booking.' });
    if (status !== 'Cancelled') return res.status(403).json({ error: 'You can only cancel a booking.' });
  } else if (req.user.role === 'worker') {
    const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(req.user.id);
    if (!worker || row.worker_id !== worker.id) {
      return res.status(403).json({ error: 'That job is not assigned to you.' });
    }
  }

  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, row.id);

  if (status === 'Confirmed' && !row.started_at) {
    db.prepare("UPDATE bookings SET started_at = datetime('now') WHERE id = ?").run(row.id);
  }
  if (status === 'Completed') {
    db.prepare("UPDATE bookings SET completed_at = datetime('now') WHERE id = ? AND completed_at IS NULL").run(row.id);
    db.prepare('UPDATE workers SET jobs_done = jobs_done + 1 WHERE id = ?').run(row.worker_id);
  }

  if (row.worker_id) {
    try { safety.calculateForWorker(row.worker_id); } catch (err) { console.error('[safety]', err.message); }
  }

  audit('booking.status', {
    userId: req.user.id, entity: 'booking', entityId: row.code,
    details: { from: row.status, to: status }, ip: req.ip
  });

  res.json({ booking: shape(db.prepare(`${SELECT_BOOKING} WHERE b.id = ?`).get(row.id)) });
});

module.exports = router;
