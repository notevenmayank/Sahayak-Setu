/**
 * routes/safety.js — Worker Safety & Fatigue Monitoring APIs.
 * Scoring stays on the server; clients only display the result.
 */

const express = require('express');
const { db, audit, getSetting, setSetting } = require('../db');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');
const safety = require('../services/workerSafety');

const router = express.Router();

function workerForUser(userId) {
  return db.prepare('SELECT * FROM workers WHERE user_id = ?').get(userId);
}

function canViewWorker(req, workerId) {
  if (req.user.role === 'admin') return true;
  if (req.user.role !== 'worker') return false;
  const mine = workerForUser(req.user.id);
  return Boolean(mine && mine.id === workerId);
}

function publicSafety(snap, { includePenalties = false } = {}) {
  if (!snap) return null;
  const out = {
    workerId: snap.workerId,
    safetyScore: snap.safetyScore,
    status: snap.status,
    workingMinutes: snap.workingMinutes,
    jobsCompleted: snap.jobsCompleted,
    jobsAssigned: snap.jobsAssigned,
    consecutiveJobs: snap.consecutiveJobs,
    breakMinutes: snap.breakMinutes,
    overtimeMinutes: snap.overtimeMinutes,
    travelMinutes: snap.travelMinutes,
    highRiskJobs: snap.highRiskJobs,
    workloadLevel: snap.workloadLevel,
    recommendation: snap.recommendation,
    calculatedAt: snap.calculatedAt,
    lastBreakAt: snap.lastBreakAt,
    activeBreak: snap.activeBreak,
    assignment: {
      action: snap.assignment.action,
      allowed: snap.assignment.allowed,
      blockNonEmergency: Boolean(snap.assignment.blockNonEmergency)
    }
  };
  if (includePenalties && snap.penalties) out.penalties = snap.penalties;
  return out;
}

router.get('/workers/me/safety', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });
  try {
    const snap = safety.calculateForWorker(worker.id);
    res.json(publicSafety(snap));
  } catch (err) {
    console.error('[safety]', err);
    res.status(500).json({ error: 'Safety information temporarily unavailable' });
  }
});

router.get('/workers/:workerId/safety', requireAuth, (req, res) => {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId) || workerId <= 0) {
    return res.status(400).json({ error: 'Invalid worker ID.' });
  }
  if (!canViewWorker(req, workerId)) {
    return res.status(403).json({ error: 'You can only view your own safety information.' });
  }
  const worker = db.prepare('SELECT id FROM workers WHERE id = ?').get(workerId);
  if (!worker) return res.status(404).json({ error: 'Worker not found.' });
  try {
    const snap = safety.calculateForWorker(workerId);
    res.json(publicSafety(snap, { includePenalties: req.user.role === 'admin' }));
  } catch (err) {
    console.error('[safety]', err);
    res.status(500).json({ error: 'Safety information temporarily unavailable' });
  }
});

router.post('/workers/:workerId/safety/recalculate', requireAuth, (req, res) => {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId) || workerId <= 0) {
    return res.status(400).json({ error: 'Invalid worker ID.' });
  }
  if (!canViewWorker(req, workerId)) {
    return res.status(403).json({ error: 'You cannot recalculate another worker\'s safety score.' });
  }
  try {
    const snap = safety.calculateForWorker(workerId);
    if (!snap) return res.status(404).json({ error: 'Worker not found.' });
    audit('safety.recalculate', {
      userId: req.user.id, entity: 'worker', entityId: workerId, ip: req.ip
    });
    res.json(publicSafety(snap, { includePenalties: req.user.role === 'admin' }));
  } catch (err) {
    console.error('[safety]', err);
    res.status(500).json({ error: 'Safety information temporarily unavailable' });
  }
});

router.post('/workers/me/breaks/start', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });
  const result = safety.startBreak(worker.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  audit('safety.break_start', {
    userId: req.user.id, entity: 'worker', entityId: worker.id, ip: req.ip
  });
  res.json(result);
});

router.post('/workers/me/breaks/end', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });
  const result = safety.endBreak(worker.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  audit('safety.break_end', {
    userId: req.user.id, entity: 'worker', entityId: worker.id,
    details: { durationMinutes: result.durationMinutes }, ip: req.ip
  });
  res.json({
    ok: true,
    durationMinutes: result.durationMinutes,
    safety: publicSafety(result.safety)
  });
});

router.get('/workers/me/notifications', requireAuth, (req, res) => {
  const items = safety.unreadNotifications(req.user.id);
  res.json({ notifications: items });
});

router.post('/workers/me/notifications/read', requireAuth, (req, res) => {
  safety.markNotificationsRead(req.user.id);
  res.json({ ok: true });
});

router.get('/admin/worker-safety', requireRole('admin'), (req, res) => {
  try {
    const { status, service, workload, date } = req.query;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
    }
    const data = safety.listForAdmin({ date, status, service, workload });
    res.json({
      ...data,
      demoEnabled: safety.demoEnabled(),
      settings: {
        assignHighRisk: getSetting('safety.assign_high_risk', 'block_non_emergency'),
        emergencyAllowHighRisk: getSetting('safety.emergency_allow_high_risk', 'true') === 'true',
        cautionDeprioritize: getSetting('safety.caution_deprioritize', 'true') === 'true'
      }
    });
  } catch (err) {
    console.error('[safety]', err);
    res.status(500).json({ error: 'Safety information temporarily unavailable' });
  }
});

router.patch('/admin/safety-settings', requireRole('admin'), (req, res) => {
  const allowedAssign = ['block_non_emergency', 'allow'];
  if (req.body.assignHighRisk !== undefined) {
    const v = String(req.body.assignHighRisk);
    if (!allowedAssign.includes(v)) {
      return res.status(400).json({ error: 'assignHighRisk must be block_non_emergency or allow.' });
    }
    setSetting('safety.assign_high_risk', v);
  }
  if (req.body.emergencyAllowHighRisk !== undefined) {
    setSetting('safety.emergency_allow_high_risk', req.body.emergencyAllowHighRisk ? 'true' : 'false');
  }
  if (req.body.cautionDeprioritize !== undefined) {
    setSetting('safety.caution_deprioritize', req.body.cautionDeprioritize ? 'true' : 'false');
  }
  audit('admin.safety_settings', {
    userId: req.user.id, entity: 'settings', details: req.body, ip: req.ip
  });
  res.json({
    settings: {
      assignHighRisk: getSetting('safety.assign_high_risk'),
      emergencyAllowHighRisk: getSetting('safety.emergency_allow_high_risk') === 'true',
      cautionDeprioritize: getSetting('safety.caution_deprioritize') === 'true'
    }
  });
});

router.patch('/admin/services/:name/risk', requireRole('admin'), (req, res) => {
  const name = String(req.params.name || '').trim();
  const riskLevel = String(req.body.riskLevel || '').toUpperCase();
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(riskLevel)) {
    return res.status(400).json({ error: 'riskLevel must be LOW, MEDIUM or HIGH.' });
  }
  const svc = db.prepare('SELECT * FROM services WHERE name = ?').get(name);
  if (!svc) return res.status(404).json({ error: 'Service not found.' });
  db.prepare('UPDATE services SET risk_level = ? WHERE name = ?').run(riskLevel, name);
  const affected = db.prepare('SELECT id FROM workers WHERE service = ?').all(name);
  for (const w of affected) safety.calculateForWorker(w.id);
  audit('admin.service_risk', {
    userId: req.user.id, entity: 'service', entityId: name,
    details: { riskLevel }, ip: req.ip
  });
  res.json({ service: db.prepare('SELECT name, icon, base_price, demand, risk_level FROM services WHERE name = ?').get(name) });
});

router.post('/admin/worker-safety/demo', requireRole('admin'), (req, res) => {
  if (!safety.demoEnabled()) {
    return res.status(403).json({ error: 'Demo simulation is disabled in production.' });
  }
  const workerId = Number(req.body.workerId);
  const jobs = Number(req.body.jobs);
  const result = safety.simulateWorkload(workerId, jobs);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  audit('safety.demo_simulate', {
    userId: req.user.id, entity: 'worker', entityId: workerId,
    details: { jobs }, ip: req.ip
  });
  res.json(result);
});

router.post('/admin/worker-safety/demo/reset', requireRole('admin'), (req, res) => {
  const workerId = req.body.workerId == null ? null : Number(req.body.workerId);
  const result = safety.resetDemo(Number.isInteger(workerId) ? workerId : null);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

/* ------------------------------------------------------------------ *
 * Worker Suraksha & SOS Workflows
 * ------------------------------------------------------------------ */

// POST /api/safety/sos
router.post('/safety/sos', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const bookingId = req.body.bookingId ? Number(req.body.bookingId) : null;
  const latitude = req.body.latitude ? Number(req.body.latitude) : null;
  const longitude = req.body.longitude ? Number(req.body.longitude) : null;
  const type = String(req.body.type || 'Emergency SOS').trim();

  const info = db.prepare(
    `INSERT INTO worker_incidents (worker_id, booking_id, type, latitude, longitude, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'Active', datetime('now'))`
  ).run(worker.id, bookingId, type, latitude, longitude);

  const incidentId = info.lastInsertRowid;

  // Insert notification for admin & worker
  const insertNotif = db.prepare(
    `INSERT INTO notifications (user_id, worker_id, kind, title, body) VALUES (?, ?, ?, ?, ?)`
  );
  insertNotif.run(
    req.user.id,
    worker.id,
    'safety.sos',
    '🚨 Emergency SOS Activated',
    'Emergency incident recorded. Follow your configured emergency procedure.'
  );

  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
  for (const admin of admins) {
    if (admin.id === req.user.id) continue;
    insertNotif.run(
      admin.id,
      worker.id,
      'safety.sos_admin',
      `🚨 SOS: ${worker.name}`,
      `Worker ${worker.name} triggered an Emergency SOS (Incident #${incidentId}).`
    );
  }

  audit('safety.sos', {
    userId: req.user.id,
    entity: 'worker_incident',
    entityId: incidentId,
    details: { bookingId, type, latitude, longitude },
    ip: req.ip
  });

  res.status(201).json({
    ok: true,
    incidentId,
    status: 'Active',
    message: 'Emergency incident recorded. Follow your configured emergency procedure.',
    procedure: '1. Ensure your physical safety first. 2. Contact emergency services if required. 3. Federation assistance has been notified.'
  });
});

// GET /api/safety/incidents/me
router.get('/safety/incidents/me', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const incidents = db.prepare(
    `SELECT i.*, b.code AS booking_code
       FROM worker_incidents i
       LEFT JOIN bookings b ON b.id = i.booking_id
      WHERE i.worker_id = ?
      ORDER BY i.created_at DESC LIMIT 10`
  ).all(worker.id);

  res.json({ incidents });
});

// GET /api/safety/insurance/plan
router.get('/safety/insurance/plan', (_req, res) => {
  res.json({
    plan: {
      planName: 'Basic Worker Protection',
      type: 'Affordable worker protection plan — prototype',
      monthlyPremium: 49,
      coverageAmount: 200000,
      providerName: 'Sahayak Suraksha Trust (Prototype Partner)',
      benefits: [
        'Work-related accident & injury protection up to ₹2,00,000',
        'Emergency response & medical assistance support',
        'Direct digital claim assistance workflow'
      ],
      notice: 'Prototype configuration — micro-insurance partner integration ready.'
    }
  });
});

// GET /api/safety/insurance/status
router.get('/safety/insurance/status', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const policy = db.prepare(
    `SELECT * FROM worker_insurance WHERE worker_id = ? ORDER BY id DESC LIMIT 1`
  ).get(worker.id);

  if (!policy) {
    return res.json({
      enrolled: false,
      status: 'Not enrolled',
      workerId: worker.id
    });
  }

  res.json({
    enrolled: policy.status === 'Active',
    status: policy.status,
    policy: {
      id: policy.id,
      planName: policy.plan_name,
      monthlyPremium: policy.monthly_premium,
      coverageAmount: policy.coverage_amount,
      policyNumber: policy.policy_number,
      providerName: policy.provider_name,
      enrolledAt: policy.enrolled_at,
      renewalDate: policy.renewal_date
    }
  });
});

// POST /api/safety/insurance/enroll
router.post('/safety/insurance/enroll', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const existing = db.prepare(
    `SELECT * FROM worker_insurance WHERE worker_id = ? AND status = 'Active'`
  ).get(worker.id);

  if (existing) {
    return res.json({
      ok: true,
      enrolled: true,
      alreadyActive: true,
      policyNumber: existing.policy_number,
      message: 'Worker is already enrolled in active Suraksha protection.'
    });
  }

  const policyNumber = `SURAKSHA-${new Date().getFullYear()}-W${worker.id}${Math.floor(1000 + Math.random() * 9000)}`;
  const planName = req.body.planName || 'Basic Worker Protection';
  const monthlyPremium = 49;
  const coverageAmount = 200000;
  const providerName = 'Sahayak Suraksha Trust (Prototype Partner)';

  db.prepare(
    `INSERT INTO worker_insurance (
        worker_id, plan_name, monthly_premium, coverage_amount, status,
        enrolled_at, renewal_date, provider_name, policy_number
      ) VALUES (
        ?, ?, ?, ?, 'Active',
        datetime('now'), date('now', '+30 days'), ?, ?
      )`
  ).run(worker.id, planName, monthlyPremium, coverageAmount, providerName, policyNumber);

  audit('insurance.enroll', {
    userId: req.user.id,
    entity: 'worker_insurance',
    entityId: policyNumber,
    ip: req.ip
  });

  res.status(201).json({
    ok: true,
    enrolled: true,
    status: 'Active',
    policyNumber,
    planName,
    message: 'Enrolled in Sahayak Suraksha worker protection successfully.'
  });
});

// POST /api/safety/insurance/claim
router.post('/safety/insurance/claim', requireAuth, (req, res) => {
  const worker = workerForUser(req.user.id);
  if (!worker) return res.status(404).json({ error: 'You do not have a worker profile.' });

  const policy = db.prepare(
    `SELECT id FROM worker_insurance WHERE worker_id = ? AND status = 'Active'`
  ).get(worker.id);

  const incidentId = req.body.incidentId ? Number(req.body.incidentId) : null;
  const description = String(req.body.description || 'Emergency claim assistance requested').trim();

  const info = db.prepare(
    `INSERT INTO insurance_claims (worker_id, incident_id, policy_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'Submitted', datetime('now'), datetime('now'))`
  ).run(worker.id, incidentId, policy ? policy.id : null);

  const claimId = info.lastInsertRowid;

  audit('insurance.claim_create', {
    userId: req.user.id,
    entity: 'insurance_claim',
    entityId: claimId,
    details: { incidentId, description },
    ip: req.ip
  });

  res.status(201).json({
    ok: true,
    claimId,
    status: 'Submitted',
    message: 'Insurance claim assistance initiated. A federation representative will contact you shortly.'
  });
});

// GET /api/safety/demand-insights
router.get('/safety/demand-insights', optionalAuth, (req, res) => {
  try {
    const service = req.query.service ? String(req.query.service).trim() : null;
    let query = `SELECT area, service, COUNT(*) as count FROM service_complaints WHERE 1=1`;
    const params = [];
    if (service) {
      query += ` AND service = ?`;
      params.push(service);
    }
    query += ` GROUP BY area, service ORDER BY count DESC LIMIT 8`;

    const rows = db.prepare(query).all(...params);
    const insights = rows.map((r) => ({
      area: r.area,
      service: r.service,
      complaintsCount: r.count,
      demandLevel: r.count >= 3 ? 'HIGH' : r.count >= 2 ? 'MEDIUM' : 'LOW'
    }));

    res.json({ insights });
  } catch (err) {
    console.error('[safety] demand insights error:', err);
    res.status(500).json({ error: 'Could not load demand insights' });
  }
});

module.exports = router;

