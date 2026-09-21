/**
 * services/workerSafety.js — operational Worker Safety Score (0–100).
 *
 * This is not a medical system. The score only reflects workload:
 * hours, overtime, consecutive jobs, breaks, high-risk job types,
 * travel time, and current assignment volume.
 */

const { db, audit, getSetting } = require('../db');

const STANDARD_DAY_MINUTES = 8 * 60;
const DEFAULT_JOB_MINUTES = 60;
const DEMO_MARK = '[SAFETY-DEMO]';

const RECOMMENDATIONS = {
  SAFE: 'Your workload is currently within a safe range.',
  CAUTION: 'Consider taking a break before accepting another assignment.',
  HIGH_RISK: 'Your current workload is high. Additional assignments are temporarily restricted.'
};

function todayISO(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function slotToMinutes(slot) {
  const m = String(slot || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return 9 * 60;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function hoursPenalty(workingMinutes) {
  const hours = workingMinutes / 60;
  if (hours <= 6) return 0;
  if (hours <= 8) return 5;
  if (hours <= 10) return 15;
  return 30;
}

function overtimePenalty(overtimeMinutes) {
  if (overtimeMinutes <= 0) return 0;
  if (overtimeMinutes <= 60) return 5;
  if (overtimeMinutes <= 120) return 10;
  return 20;
}

function consecutivePenalty(consecutiveJobs) {
  if (consecutiveJobs <= 2) return 0;
  if (consecutiveJobs <= 4) return 5;
  if (consecutiveJobs <= 6) return 10;
  return 20;
}

function breakPenalty(breakMinutes, workingMinutes, jobsCount) {
  if (workingMinutes < 4 * 60 && jobsCount < 3) return 0;
  const needed = workingMinutes > 8 * 60 ? 60 : workingMinutes >= 6 * 60 ? 45 : 30;
  if (breakMinutes >= needed) return 0;
  if (breakMinutes >= Math.floor(needed * 0.45)) return 10;
  return 20;
}

function highRiskPenalty(highRiskJobs) {
  return Math.min(24, Math.max(0, highRiskJobs) * 8);
}

function travelPenalty(travelMinutes, workingMinutes) {
  if (travelMinutes >= 120 && workingMinutes > 8 * 60) return 15;
  if (travelMinutes > 90) return 10;
  if (travelMinutes > 60 && workingMinutes > 6 * 60) return 10;
  if (travelMinutes > 45 && workingMinutes > 8 * 60) return 5;
  return 0;
}

function workloadLevel(jobsCount, workingMinutes) {
  const hours = workingMinutes / 60;
  if (jobsCount > 6 || hours > 10) return 'VERY HIGH';
  if (jobsCount >= 5 || hours > 8) return 'HIGH';
  if (jobsCount >= 3 || hours > 6) return 'MEDIUM';
  return 'LOW';
}

function workloadPenalty(level) {
  if (level === 'VERY HIGH') return 20;
  if (level === 'HIGH') return 10;
  if (level === 'MEDIUM') return 5;
  return 0;
}

function statusFromScore(score) {
  if (score >= 80) return 'SAFE';
  if (score >= 50) return 'CAUTION';
  return 'HIGH_RISK';
}

function estimateTravelMinutes(worker) {
  const km = Number(worker && worker.distance_km);
  if (!Number.isFinite(km) || km < 0) return 0;
  return Math.round(km * 3);
}

function jobDuration(row) {
  const stored = Number(row.duration_minutes);
  if (Number.isFinite(stored) && stored > 0) return Math.min(stored, 12 * 60);
  if (row.started_at && row.completed_at) {
    const a = Date.parse(row.started_at);
    const b = Date.parse(row.completed_at);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return Math.min(12 * 60, Math.round((b - a) / 60000));
    }
  }
  return DEFAULT_JOB_MINUTES;
}

function longestConsecutive(jobs) {
  if (!jobs.length) return 0;
  const ordered = jobs
    .slice()
    .sort((a, b) => slotToMinutes(a.preferred_time) - slotToMinutes(b.preferred_time));
  let best = 1;
  let run = 1;
  for (let i = 1; i < ordered.length; i++) {
    const gap = slotToMinutes(ordered[i].preferred_time) - slotToMinutes(ordered[i - 1].preferred_time);
    if (gap >= 0 && gap <= 70) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }
  return best;
}

function recordedBreakMinutes(workerId, date) {
  const rows = db
    .prepare(
      `SELECT started_at, ended_at, duration_minutes FROM worker_breaks
        WHERE worker_id = ? AND date(started_at) = ?`
    )
    .all(workerId, date);

  let minutes = 0;
  let lastBreakAt = null;
  for (const row of rows) {
    lastBreakAt = row.ended_at || row.started_at;
    if (Number.isFinite(Number(row.duration_minutes)) && Number(row.duration_minutes) > 0) {
      minutes += Number(row.duration_minutes);
      continue;
    }
    if (row.started_at && row.ended_at) {
      const a = Date.parse(row.started_at);
      const b = Date.parse(row.ended_at);
      if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
        minutes += Math.round((b - a) / 60000);
      }
    }
  }
  return { minutes, lastBreakAt };
}

function inferredGapBreaks(jobs) {
  if (jobs.length < 2) return 0;
  const ordered = jobs
    .slice()
    .sort((a, b) => slotToMinutes(a.preferred_time) - slotToMinutes(b.preferred_time));
  let extra = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = slotToMinutes(ordered[i - 1].preferred_time) + jobDuration(ordered[i - 1]);
    const nextStart = slotToMinutes(ordered[i].preferred_time);
    const gap = nextStart - prevEnd;
    if (gap >= 20 && gap <= 180) extra += gap;
  }
  return extra;
}

function gatherDay(workerId, date) {
  const jobs = db
    .prepare(
      `SELECT b.*, s.risk_level
         FROM bookings b
         LEFT JOIN services s ON s.name = b.service
        WHERE b.worker_id = ?
          AND b.preferred_date = ?
          AND b.status IN ('Pending','Confirmed','Completed')
        ORDER BY b.preferred_time`
    )
    .all(workerId, date);

  const completed = jobs.filter((j) => j.status === 'Completed');
  const workingMinutes = jobs.reduce((sum, j) => sum + jobDuration(j), 0);
  const overtimeMinutes = Math.max(0, workingMinutes - STANDARD_DAY_MINUTES);
  const travelMinutes = jobs.reduce((sum, j) => {
    const t = Number(j.travel_minutes);
    return sum + (Number.isFinite(t) && t > 0 ? t : 0);
  }, 0);
  const highRiskJobs = jobs.filter((j) => j.risk_level === 'HIGH').length;
  const consecutiveJobs = longestConsecutive(jobs);
  const recorded = recordedBreakMinutes(workerId, date);
  const breakMinutes = recorded.minutes + (recorded.minutes > 0 ? 0 : inferredGapBreaks(jobs));
  const level = workloadLevel(jobs.length, workingMinutes);

  return {
    jobs,
    jobsAssigned: jobs.length,
    jobsCompleted: completed.length,
    workingMinutes,
    overtimeMinutes,
    travelMinutes,
    highRiskJobs,
    consecutiveJobs,
    breakMinutes,
    lastBreakAt: recorded.lastBreakAt,
    workloadLevel: level
  };
}

function scoreFromMetrics(m) {
  const penalties = {
    hours: hoursPenalty(m.workingMinutes),
    overtime: overtimePenalty(m.overtimeMinutes),
    consecutive: consecutivePenalty(m.consecutiveJobs),
    breaks: breakPenalty(m.breakMinutes, m.workingMinutes, m.jobsAssigned),
    highRisk: highRiskPenalty(m.highRiskJobs),
    travel: travelPenalty(m.travelMinutes, m.workingMinutes),
    workload: workloadPenalty(m.workloadLevel)
  };
  const totalPenalty = Object.values(penalties).reduce((a, b) => a + b, 0);
  const safetyScore = clamp(100 - totalPenalty, 0, 100);
  const safetyStatus = statusFromScore(safetyScore);
  return { safetyScore, safetyStatus, penalties };
}

function notifyTransition(worker, previousStatus, nextStatus) {
  if (!previousStatus || previousStatus === nextStatus) return;
  const worse =
    (previousStatus === 'SAFE' && (nextStatus === 'CAUTION' || nextStatus === 'HIGH_RISK')) ||
    (previousStatus === 'CAUTION' && nextStatus === 'HIGH_RISK');
  const recovered = previousStatus === 'HIGH_RISK' && nextStatus !== 'HIGH_RISK';
  if (!worse && !recovered) return;

  const workerUserId = worker.user_id;
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();

  let title;
  let body;
  let kind;
  if (nextStatus === 'CAUTION' && worse) {
    kind = 'safety.caution';
    title = 'Workload getting high';
    body = 'Your workload is getting high. Consider taking a break.';
  } else if (nextStatus === 'HIGH_RISK' && worse) {
    kind = 'safety.high_risk';
    title = 'Workload restricted';
    body = 'Your workload is high. New assignments may be restricted until workload decreases.';
  } else {
    kind = 'safety.recovered';
    title = 'Workload easing';
    body = 'Your operational workload has eased. You can take new assignments again when you are ready.';
  }

  const insert = db.prepare(
    `INSERT INTO notifications (user_id, worker_id, kind, title, body) VALUES (?, ?, ?, ?, ?)`
  );

  if (workerUserId) insert.run(workerUserId, worker.id, kind, title, body);

  const adminTitle = `${worker.name}: ${nextStatus.replace('_', ' ')}`;
  const adminBody = `${worker.name} (${worker.service}) is now ${nextStatus.replace('_', ' ')} with today's workload.`;
  for (const admin of admins) {
    if (admin.id === workerUserId) continue;
    insert.run(admin.id, worker.id, kind, adminTitle, adminBody);
  }

  audit('safety.status_change', {
    userId: workerUserId,
    entity: 'worker',
    entityId: worker.id,
    details: { from: previousStatus, to: nextStatus }
  });
}

function upsertMetrics(workerId, date, payload) {
  db.prepare(
    `INSERT INTO worker_safety_metrics (
        worker_id, date, working_minutes, jobs_completed, consecutive_jobs,
        break_minutes, overtime_minutes, travel_minutes, high_risk_jobs,
        workload_level, safety_score, safety_status, last_break_at, calculated_at
      ) VALUES (
        @worker_id, @date, @working_minutes, @jobs_completed, @consecutive_jobs,
        @break_minutes, @overtime_minutes, @travel_minutes, @high_risk_jobs,
        @workload_level, @safety_score, @safety_status, @last_break_at, datetime('now')
      )
      ON CONFLICT(worker_id, date) DO UPDATE SET
        working_minutes = excluded.working_minutes,
        jobs_completed = excluded.jobs_completed,
        consecutive_jobs = excluded.consecutive_jobs,
        break_minutes = excluded.break_minutes,
        overtime_minutes = excluded.overtime_minutes,
        travel_minutes = excluded.travel_minutes,
        high_risk_jobs = excluded.high_risk_jobs,
        workload_level = excluded.workload_level,
        safety_score = excluded.safety_score,
        safety_status = excluded.safety_status,
        last_break_at = excluded.last_break_at,
        calculated_at = datetime('now')`
  ).run(payload);
}

function calculateForWorker(workerId, date = todayISO()) {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!worker) return null;

  const day = gatherDay(workerId, date);
  const scored = scoreFromMetrics(day);

  const prev = db
    .prepare('SELECT safety_status FROM worker_safety_metrics WHERE worker_id = ? AND date = ?')
    .get(workerId, date);

  upsertMetrics(workerId, date, {
    worker_id: workerId,
    date,
    working_minutes: day.workingMinutes,
    jobs_completed: day.jobsCompleted,
    consecutive_jobs: day.consecutiveJobs,
    break_minutes: day.breakMinutes,
    overtime_minutes: day.overtimeMinutes,
    travel_minutes: day.travelMinutes,
    high_risk_jobs: day.highRiskJobs,
    workload_level: day.workloadLevel,
    safety_score: scored.safetyScore,
    safety_status: scored.safetyStatus,
    last_break_at: day.lastBreakAt
  });

  if (date === todayISO()) {
    notifyTransition(worker, prev ? prev.safety_status : 'SAFE', scored.safetyStatus);
  }

  return getSnapshot(worker, date, day, scored);
}

function getSnapshot(worker, date, day, scored) {
  const activeBreak = db
    .prepare(
      `SELECT id, started_at FROM worker_breaks
        WHERE worker_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`
    )
    .get(worker.id);

  return {
    workerId: worker.id,
    workerCode: worker.code,
    workerName: worker.name,
    skill: worker.service,
    date,
    safetyScore: scored.safetyScore,
    status: scored.safetyStatus,
    workingMinutes: day.workingMinutes,
    jobsCompleted: day.jobsCompleted,
    jobsAssigned: day.jobsAssigned,
    consecutiveJobs: day.consecutiveJobs,
    breakMinutes: day.breakMinutes,
    overtimeMinutes: day.overtimeMinutes,
    travelMinutes: day.travelMinutes,
    highRiskJobs: day.highRiskJobs,
    workloadLevel: day.workloadLevel,
    recommendation: RECOMMENDATIONS[scored.safetyStatus],
    calculatedAt: new Date().toISOString(),
    lastBreakAt: day.lastBreakAt,
    activeBreak: activeBreak
      ? { id: activeBreak.id, startedAt: activeBreak.started_at }
      : null,
    assignment: assignmentRule(scored.safetyStatus),
    penalties: scored.penalties
  };
}

function readOrCalculate(workerId, date = todayISO()) {
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!worker) return null;
  const row = db
    .prepare('SELECT * FROM worker_safety_metrics WHERE worker_id = ? AND date = ?')
    .get(workerId, date);
  if (!row) return calculateForWorker(workerId, date);
  const day = gatherDay(workerId, date);
  return getSnapshot(worker, date, day, {
    safetyScore: row.safety_score,
    safetyStatus: row.safety_status,
    penalties: null
  });
}

function assignmentRule(status) {
  const highRiskPolicy = getSetting('safety.assign_high_risk', 'block_non_emergency');
  const emergencyOk = getSetting('safety.emergency_allow_high_risk', 'true') === 'true';
  const deprioritizeCaution = getSetting('safety.caution_deprioritize', 'true') === 'true';

  if (status === 'SAFE') {
    return { allowed: true, priority: 0, action: 'Normal', emergencyOverride: emergencyOk };
  }
  if (status === 'CAUTION') {
    return {
      allowed: true,
      priority: deprioritizeCaution ? 1 : 0,
      action: 'Recommend Break',
      emergencyOverride: emergencyOk
    };
  }
  return {
    allowed: highRiskPolicy !== 'block_non_emergency',
    blockNonEmergency: highRiskPolicy === 'block_non_emergency',
    priority: 2,
    action: 'Restrict Assignment',
    emergencyOverride: emergencyOk
  };
}

function canAssignWorker(workerId, { isEmergency = false } = {}) {
  const snap = readOrCalculate(workerId, todayISO());
  if (!snap) return { ok: false, error: 'Worker not found.', status: 404 };
  const rule = snap.assignment;
  if (snap.status !== 'HIGH_RISK') return { ok: true, snapshot: snap, warning: snap.status === 'CAUTION' ? snap.recommendation : null };
  if (isEmergency && rule.emergencyOverride) {
    return {
      ok: true,
      snapshot: snap,
      warning: 'This is a HIGH RISK workload assignment allowed only because the booking is marked as an emergency.'
    };
  }
  if (rule.blockNonEmergency) {
    return {
      ok: false,
      status: 409,
      error: `${snap.workerName} is currently HIGH RISK for workload. New non-emergency jobs are restricted until their Safety Score recovers.`,
      snapshot: snap
    };
  }
  return { ok: true, snapshot: snap, warning: snap.recommendation };
}

function rankWorkers(workers) {
  const date = todayISO();
  const deprioritize = getSetting('safety.caution_deprioritize', 'true') === 'true';
  return workers
    .map((w) => {
      const snap = readOrCalculate(w.id, date);
      const status = snap ? snap.status : 'SAFE';
      const score = snap ? snap.safetyScore : 100;
      const rule = assignmentRule(status);
      return {
        ...w,
        safetyScore: score,
        safetyStatus: status,
        workloadLevel: snap ? snap.workloadLevel : 'LOW',
        assignmentAllowed: status !== 'HIGH_RISK' || !rule.blockNonEmergency,
        assignmentAction: rule.action,
        _safetyPriority: deprioritize ? rule.priority : status === 'HIGH_RISK' ? 2 : 0
      };
    })
    .sort((a, b) => {
      if (a._safetyPriority !== b._safetyPriority) return a._safetyPriority - b._safetyPriority;
      return (b.safetyScore || 0) - (a.safetyScore || 0);
    })
    .map((w) => {
      const { _safetyPriority, ...rest } = w;
      return rest;
    });
}

function listForAdmin({ date, status, service, workload } = {}) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
  const workers = db
    .prepare(
      `SELECT id, code, name, service, rating, jobs_done, availability, verification
         FROM workers
        WHERE verification != 'Suspended'
        ORDER BY name`
    )
    .all();

  let rows = workers.map((w) => {
    const snap = calculateForWorker(w.id, day);
    return {
      workerId: w.id,
      code: w.code,
      name: w.name,
      skill: w.service,
      rating: w.rating,
      availability: w.availability,
      verification: w.verification,
      jobs: snap.jobsAssigned,
      jobsCompleted: snap.jobsCompleted,
      hours: Math.round((snap.workingMinutes / 60) * 10) / 10,
      workingMinutes: snap.workingMinutes,
      workload: snap.workloadLevel,
      safetyScore: snap.safetyScore,
      status: snap.status,
      action: snap.assignment.action,
      travelMinutes: snap.travelMinutes,
      breakMinutes: snap.breakMinutes,
      highRiskJobs: snap.highRiskJobs,
      recommendation: snap.recommendation
    };
  });

  if (status) {
    const wanted = String(status).toUpperCase().replace(' ', '_');
    rows = rows.filter((r) => r.status === wanted);
  }
  if (service) rows = rows.filter((r) => r.skill === service);
  if (workload) {
    const wanted = String(workload).toUpperCase().replace('_', ' ');
    rows = rows.filter((r) => r.workload === wanted);
  }

  const summary = {
    SAFE: rows.filter((r) => r.status === 'SAFE').length,
    CAUTION: rows.filter((r) => r.status === 'CAUTION').length,
    HIGH_RISK: rows.filter((r) => r.status === 'HIGH_RISK').length
  };

  return { date: day, summary, workers: rows };
}

function startBreak(workerId) {
  const open = db
    .prepare('SELECT id FROM worker_breaks WHERE worker_id = ? AND ended_at IS NULL')
    .get(workerId);
  if (open) return { error: 'A break is already in progress.', status: 409 };
  const info = db
    .prepare('INSERT INTO worker_breaks (worker_id, started_at) VALUES (?, datetime(\'now\'))')
    .run(workerId);
  return { ok: true, breakId: info.lastInsertRowid, startedAt: new Date().toISOString() };
}

function endBreak(workerId) {
  const open = db
    .prepare(
      'SELECT * FROM worker_breaks WHERE worker_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
    )
    .get(workerId);
  if (!open) return { error: 'No active break to end.', status: 409 };
  const start = Date.parse(open.started_at + (open.started_at.includes('T') ? '' : 'Z'));
  const duration = Number.isFinite(start)
    ? Math.max(1, Math.round((Date.now() - start) / 60000))
    : 1;
  db.prepare(
    `UPDATE worker_breaks SET ended_at = datetime('now'), duration_minutes = ? WHERE id = ?`
  ).run(duration, open.id);
  const snap = calculateForWorker(workerId);
  return { ok: true, durationMinutes: duration, safety: snap };
}

function demoEnabled() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.ENABLE_SAFETY_DEMO !== 'false';
}

function simulateWorkload(workerId, jobsWanted) {
  if (!demoEnabled()) return { error: 'Demo simulation is disabled.', status: 403 };
  const n = Number(jobsWanted);
  if (!Number.isInteger(n) || n < 0 || n > 12) {
    return { error: 'jobs must be an integer between 0 and 12.', status: 400 };
  }
  const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!worker) return { error: 'Worker not found.', status: 404 };

  const date = todayISO();
  db.prepare(
    `DELETE FROM bookings WHERE worker_id = ? AND preferred_date = ? AND instructions LIKE ?`
  ).run(workerId, date, `${DEMO_MARK}%`);

  const slots = ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'];
  const insert = db.prepare(
    `INSERT INTO bookings (code, customer_id, worker_id, service, customer_name, mobile,
                           address, preferred_date, preferred_time, instructions, amount, status,
                           duration_minutes, travel_minutes, completed_at)
     VALUES (?, NULL, ?, ?, 'Safety Demo', '9800000000',
             'Demo workload simulation', ?, ?, ?, ?, 'Completed',
             60, ?, datetime('now'))`
  );

  const year = new Date().getFullYear();
  for (let i = 0; i < n; i++) {
    const code = `SD-${year}-W${workerId}J${i}${Date.now().toString().slice(-5)}`;
    const time = slots[i % slots.length];
    const travel = estimateTravelMinutes(worker);
    insert.run(code, workerId, worker.service, date, time, `${DEMO_MARK} simulated job ${i + 1}`, worker.price_from, travel);
  }

  const snap = calculateForWorker(workerId, date);
  return { ok: true, demo: true, jobs: n, safety: snap };
}

function resetDemo(workerId) {
  if (!demoEnabled()) return { error: 'Demo simulation is disabled.', status: 403 };
  const date = todayISO();
  if (workerId) {
    db.prepare(
      `DELETE FROM bookings WHERE worker_id = ? AND preferred_date = ? AND instructions LIKE ?`
    ).run(workerId, date, `${DEMO_MARK}%`);
    calculateForWorker(workerId, date);
  } else {
    db.prepare(`DELETE FROM bookings WHERE instructions LIKE ?`).run(`${DEMO_MARK}%`);
    const ids = db.prepare('SELECT id FROM workers').all();
    for (const w of ids) calculateForWorker(w.id, date);
  }
  return { ok: true };
}

function unreadNotifications(userId) {
  return db
    .prepare(
      `SELECT id, kind, title, body, created_at, read_at, worker_id
         FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`
    )
    .all(userId);
}

function markNotificationsRead(userId) {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(userId);
}

function safetyContextForUser(user) {
  if (!user || user.role !== 'worker') return null;
  const worker = db.prepare('SELECT * FROM workers WHERE user_id = ?').get(user.id);
  if (!worker) return null;
  return readOrCalculate(worker.id);
}

module.exports = {
  DEMO_MARK,
  RECOMMENDATIONS,
  todayISO,
  estimateTravelMinutes,
  calculateForWorker,
  readOrCalculate,
  canAssignWorker,
  rankWorkers,
  listForAdmin,
  startBreak,
  endBreak,
  demoEnabled,
  simulateWorkload,
  resetDemo,
  unreadNotifications,
  markNotificationsRead,
  safetyContextForUser,
  assignmentRule,
  scoreFromMetrics
};
