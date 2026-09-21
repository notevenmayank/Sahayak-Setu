/**
 * routes/workers.js — service catalogue and worker listings.
 * These are public: visitors browse before they log in.
 */

const express = require('express');
const { db, audit } = require('../db');
const { requireAuth } = require('../middleware/auth');
const safety = require('../services/workerSafety');

const router = express.Router();

const SORTS = {
  rating:   'w.rating DESC, w.distance_km ASC',
  distance: 'w.distance_km ASC, w.rating DESC',
  price:    'w.price_from ASC, w.rating DESC'
};

// GET /api/services
router.get('/services', (_req, res) => {
  const services = db
    .prepare(
      `SELECT s.name, s.icon, s.base_price, s.demand, s.risk_level,
              (SELECT COUNT(*) FROM workers w
                WHERE w.service = s.name AND w.verification != 'Suspended' AND w.is_blacklisted != 1) AS worker_count
         FROM services s
        ORDER BY s.demand DESC`
    )
    .all();
  res.json({ services });
});

// GET /api/workers?service=Electrician&sort=rating&available=true&q=ramesh
router.get('/workers', (req, res) => {
  const { service, sort, available, q } = req.query;

  const where = [`w.verification != 'Suspended'`, `w.is_blacklisted != 1`];
  const params = {};

  if (service) { where.push('w.service = @service'); params.service = String(service); }
  if (available === 'true') { where.push(`w.availability = 'Available'`); }
  if (q) { where.push('LOWER(w.name) LIKE @q'); params.q = `%${String(q).toLowerCase()}%`; }

  const workers = db
    .prepare(
      `SELECT w.id, w.code, w.name, w.service, w.rating, w.jobs_done,
              w.distance_km, w.price_from, w.verification, w.availability
         FROM workers w
        WHERE ${where.join(' AND ')}
        ORDER BY ${SORTS[sort] || SORTS.rating}`
    )
    .all(params);

  const withSafety = workers.map((w) => {
    try {
      const snap = safety.readOrCalculate(w.id);
      return {
        ...w,
        safetyScore: snap ? snap.safetyScore : 100,
        safetyStatus: snap ? snap.status : 'SAFE',
        workloadLevel: snap ? snap.workloadLevel : 'LOW',
        assignmentAllowed: snap ? (snap.status !== 'HIGH_RISK' || !snap.assignment.blockNonEmergency) : true
      };
    } catch {
      return { ...w, safetyScore: 100, safetyStatus: 'SAFE', workloadLevel: 'LOW', assignmentAllowed: true };
    }
  });

  const ordered = sort === 'match'
    ? safety.rankWorkers(withSafety)
    : withSafety;

  res.json({ workers: ordered, count: ordered.length });
});

// GET /api/workers/:id
router.get('/workers/:id', (req, res) => {
  const worker = db
    .prepare(
      `SELECT id, code, name, service, rating, jobs_done, distance_km,
              price_from, verification, availability
         FROM workers WHERE id = ?`
    )
    .get(req.params.id);

  if (!worker) return res.status(404).json({ error: 'Worker not found.' });

  const recent = db
    .prepare(
      `SELECT service, status, preferred_date FROM bookings
        WHERE worker_id = ? ORDER BY created_at DESC LIMIT 5`
    )
    .all(worker.id);

  res.json({ worker, recentBookings: recent });
});

// PATCH /api/workers/me/availability   { available: true|false }
// A logged-in worker toggling their own availability.
router.patch('/workers/me/availability', requireAuth, (req, res) => {
  const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const availability = req.body.available === false ? 'Unavailable' : 'Available';
  db.prepare('UPDATE workers SET availability = ? WHERE id = ?').run(availability, worker.id);
  try { safety.calculateForWorker(worker.id); } catch (err) { console.error('[safety]', err.message); }

  res.json({ ok: true, availability });
});

// PATCH /api/workers/me   { service, priceFrom }
// A worker editing their own listing. Note what is deliberately NOT editable
// here: rating, jobs_done and verification. A worker must not be able to award
// themselves five stars or mark their own account Verified.
router.patch('/workers/me', requireAuth, (req, res) => {
  const worker = db.prepare('SELECT * FROM workers WHERE user_id = ?').get(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  let service = worker.service;
  if (req.body.service !== undefined) {
    service = String(req.body.service).trim();
    const known = db.prepare('SELECT 1 FROM services WHERE name = ?').get(service);
    if (!known) return res.status(400).json({ error: 'Choose one of the listed services.' });
  }

  let price_from = worker.price_from;
  if (req.body.priceFrom !== undefined) {
    price_from = Number(req.body.priceFrom);
    if (!Number.isFinite(price_from) || price_from < 50 || price_from > 10000) {
      return res.status(400).json({ error: 'Starting price must be between 50 and 10000.' });
    }
    price_from = Math.round(price_from);
  }

  db.prepare('UPDATE workers SET service = ?, price_from = ? WHERE id = ?')
    .run(service, price_from, worker.id);

  audit('worker.update_own_listing', {
    userId: req.user.id, entity: 'worker', entityId: worker.id,
    details: { service, price_from }, ip: req.ip
  });

  const updated = db
    .prepare(
      `SELECT id, code, service, rating, verification, availability, jobs_done,
              price_from, distance_km
         FROM workers WHERE id = ?`
    )
    .get(worker.id);

  res.json({ worker: updated });
});

module.exports = router;
