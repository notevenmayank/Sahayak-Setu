/**
 * services/ai.js — Gemini 2.5 Flash grounded assistant for Sahayak Setu.
 *
 * Architecture:
 *   User -> /api/chat -> Gemini 2.5 Flash -> Tool Call (intent determination)
 *   -> Backend verification & SQLite DB execution -> Trusted Facts -> Gemini natural language reply
 *
 * Principles:
 *   - "Gemini thinks, backend verifies, database provides the truth."
 *   - Gemini never directly accesses SQLite or executes raw SQL.
 *   - Gemini API key is server-side only; never exposed to frontend.
 *   - High-quality offline fallback keeps the app functional even if Gemini is unreachable.
 */

require('dotenv').config();
const { GoogleGenAI, Type } = require('@google/genai');
const { db } = require('../db');
const safetyService = require('./workerSafety');

const MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const RUPEE = '₹';

function getActiveProvider() {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const grokKey = (process.env.GROK_API_KEY || '').trim();
  if (groqKey || grokKey.startsWith('gsk_')) return 'groq';
  if (grokKey) return 'grok';
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) return 'gemini';
  return 'fallback';
}

function hasKey() {
  return getActiveProvider() !== 'fallback';
}

let aiClientInstance = null;
function getAiClient() {
  if (!aiClientInstance && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    aiClientInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim() });
  }
  return aiClientInstance;
}

/* ------------------------------------------------------------------ *
 * Tool Declarations for Gemini 2.5 Flash
 * ------------------------------------------------------------------ */

const FUNCTION_DECLARATIONS = [
  {
    name: 'find_workers',
    description: 'Find verified service workers in the database matching trade, price, rating, or availability.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING, description: 'Service category e.g. Electrician, Plumber, Cleaner, Driver, Carpenter, Painter' },
        maxPrice: { type: Type.NUMBER, description: 'Maximum starting price in Indian Rupees' },
        minRating: { type: Type.NUMBER, description: 'Minimum worker star rating (e.g. 4.5)' },
        availableOnly: { type: Type.BOOLEAN, description: 'Whether to only return currently available workers' },
        query: { type: Type.STRING, description: 'Worker name or search keywords' }
      }
    }
  },
  {
    name: 'get_worker_details',
    description: 'Get complete verified details for a specific worker by ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'The unique numeric worker ID' }
      },
      required: ['workerId']
    }
  },
  {
    name: 'get_services',
    description: 'Get the list of all active cooperative services with base prices and current demand.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'get_my_bookings',
    description: 'Get the recent bookings of the signed-in customer or worker. Never exposes another user bookings.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'get_booking_status',
    description: 'Look up status of a booking by its code (e.g. SS-2026-1001).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bookingCode: { type: Type.STRING, description: 'Booking ID code like SS-2026-1001' }
      },
      required: ['bookingCode']
    }
  },
  {
    name: 'check_worker_availability',
    description: 'Check available time slots for a worker on a specific date.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'Worker ID' },
        date: { type: Type.STRING, description: 'Date in YYYY-MM-DD format' }
      },
      required: ['workerId', 'date']
    }
  },
  {
    name: 'get_complaint_stats',
    description: 'Get aggregated complaint and service-demand stats by area and trade from real cooperative records.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING, description: 'Service trade name optional' },
        area: { type: Type.STRING, description: 'Locality or sector name optional' }
      }
    }
  },
  {
    name: 'get_worker_location',
    description: 'Get live or last-reported location of a worker for tracking. Only authorized customers with a confirmed booking can view.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'Worker ID' },
        bookingCode: { type: Type.STRING, description: 'Booking code for authorization' }
      },
      required: ['workerId']
    }
  },
  {
    name: 'get_insurance_plan',
    description: 'Get information about Sahayak Suraksha micro-insurance protection plan and worker enrollment status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'Worker ID to check enrollment status' }
      }
    }
  },
  {
    name: 'get_worker_safety',
    description: 'Get workload and operational safety score metrics for a worker (hours, fatigue, jobs, recommendation).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'Worker ID' }
      }
    }
  },
  {
    name: 'get_nearby_workers',
    description: 'Find verified workers near given geographic coordinates or service location.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        service: { type: Type.STRING, description: 'Service trade' },
        latitude: { type: Type.NUMBER, description: 'Latitude coordinate' },
        longitude: { type: Type.NUMBER, description: 'Longitude coordinate' },
        radiusKm: { type: Type.NUMBER, description: 'Search radius in km' }
      }
    }
  },
  {
    name: 'create_booking',
    description: 'Safely validate and request a booking with a verified worker on behalf of the customer.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        workerId: { type: Type.INTEGER, description: 'Worker ID' },
        preferredDate: { type: Type.STRING, description: 'Date YYYY-MM-DD' },
        preferredTime: { type: Type.STRING, description: 'Slot e.g. 10:00 AM' },
        customerName: { type: Type.STRING, description: 'Customer name' },
        mobile: { type: Type.STRING, description: '10-digit mobile number' },
        address: { type: Type.STRING, description: 'Full service address' },
        instructions: { type: Type.STRING, description: 'Optional job instructions or problem notes' },
        isEmergency: { type: Type.BOOLEAN, description: 'True if this is an urgent emergency job' }
      },
      required: ['workerId', 'preferredDate', 'preferredTime']
    }
  }
];

/* ------------------------------------------------------------------ *
 * Trusted Backend Tool Execution Layer (SQLite & WorkerSafety Engine)
 * ------------------------------------------------------------------ */

const TIME_SLOTS = ['09:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
                    '02:00 PM', '03:00 PM', '04:00 PM', '05:00 PM'];

function nextBookingCode() {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT code FROM bookings WHERE code LIKE ? ORDER BY id DESC LIMIT 1`).get(`SS-${year}-%`);
  const last = row ? parseInt(row.code.split('-')[2], 10) : 1000;
  return `SS-${year}-${last + 1}`;
}

async function executeTool(name, args = {}, user = null, actionsCollector = []) {
  switch (name) {
    case 'find_workers': {
      const where = ["verification != 'Suspended'"];
      const params = {};
      if (args.service) {
        where.push('service = @service');
        params.service = args.service;
      }
      if (args.availableOnly) {
        where.push("availability = 'Available'");
      }
      if (args.minRating) {
        where.push('rating >= @minRating');
        params.minRating = Number(args.minRating);
      }
      if (args.maxPrice) {
        where.push('price_from <= @maxPrice');
        params.maxPrice = Number(args.maxPrice);
      }
      if (args.query) {
        where.push('(LOWER(name) LIKE @q OR LOWER(service) LIKE @q)');
        params.q = `%${String(args.query).toLowerCase()}%`;
      }

      const rows = db.prepare(
        `SELECT id, code, name, service, rating, jobs_done, distance_km, price_from, verification, availability
           FROM workers WHERE ${where.join(' AND ')} ORDER BY rating DESC, distance_km ASC LIMIT 6`
      ).all(params);

      if (rows.length > 0) {
        rows.slice(0, 2).forEach((w) => {
          actionsCollector.push({ type: 'book_worker', workerId: w.id, label: `Book ${w.name}` });
          actionsCollector.push({ type: 'view_worker', workerId: w.id, label: `View ${w.name}` });
        });
      }
      return { found: rows.length, workers: rows };
    }

    case 'get_worker_details': {
      const workerId = Number(args.workerId);
      const worker = db.prepare(
        `SELECT id, code, name, service, rating, jobs_done, distance_km, price_from, verification, availability, phone
           FROM workers WHERE id = ?`
      ).get(workerId);
      if (!worker) return { found: false, error: 'Worker not found' };
      actionsCollector.push({ type: 'book_worker', workerId: worker.id, label: `Book ${worker.name}` });
      return { found: true, worker };
    }

    case 'get_services': {
      const services = db.prepare(
        `SELECT s.name, s.base_price, s.demand, s.risk_level,
                (SELECT COUNT(*) FROM workers w WHERE w.service = s.name AND w.verification = 'Verified' AND w.availability = 'Available') AS available_workers
           FROM services s ORDER BY s.demand DESC`
      ).all();
      return { services };
    }

    case 'get_my_bookings': {
      if (!user) {
        return { authenticated: false, message: 'User is not signed in. Ask the user to log in or provide a booking ID like SS-2026-1001.' };
      }
      let bookings = [];
      if (user.role === 'worker') {
        const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
        if (worker) {
          bookings = db.prepare(
            `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, b.amount, b.customer_name, b.address
               FROM bookings b WHERE b.worker_id = ? ORDER BY b.created_at DESC LIMIT 5`
          ).all(worker.id);
        }
      } else {
        bookings = db.prepare(
          `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, b.amount, w.name AS worker_name, w.id AS worker_id
             FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id
            WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 5`
        ).all(user.id);
      }

      bookings.forEach((b) => {
        if (b.status === 'Confirmed') {
          actionsCollector.push({ type: 'track_worker', bookingCode: b.code, label: `Track ${b.code}` });
        }
      });

      return { authenticated: true, bookings };
    }

    case 'get_booking_status': {
      const code = String(args.bookingCode || '').trim().toUpperCase();
      const row = db.prepare(
        `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, b.amount, b.address,
                b.customer_id, b.worker_id, w.name AS worker_name, w.rating AS worker_rating
           FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id
          WHERE b.code = ?`
      ).get(code);

      if (!row) return { found: false, message: `No booking found with code ${code}. Please verify the booking ID.` };

      if (row.status === 'Confirmed') {
        actionsCollector.push({ type: 'track_worker', bookingCode: row.code, label: `Track Worker (${row.code})` });
      }

      return {
        found: true,
        code: row.code,
        service: row.service,
        status: row.status,
        date: row.preferred_date,
        time: row.preferred_time,
        worker: row.worker_name || 'Unassigned',
        amount: row.amount
      };
    }

    case 'check_worker_availability': {
      const workerId = Number(args.workerId);
      const date = String(args.date || '').trim();
      const worker = db.prepare('SELECT id, name, availability FROM workers WHERE id = ?').get(workerId);
      if (!worker) return { found: false, error: 'Worker not found' };

      const taken = db.prepare(
        `SELECT preferred_time FROM bookings
          WHERE worker_id = ? AND preferred_date = ? AND status IN ('Pending','Confirmed')`
      ).all(workerId, date).map((r) => r.preferred_time);

      const freeSlots = TIME_SLOTS.filter((s) => !taken.includes(s));
      return {
        workerId: worker.id,
        workerName: worker.name,
        date,
        isAvailableOverall: worker.availability === 'Available',
        freeSlots,
        takenCount: taken.length
      };
    }

    case 'get_complaint_stats': {
      let query = `SELECT area, service, COUNT(*) as count FROM service_complaints WHERE 1=1`;
      const params = [];
      if (args.service) {
        query += ` AND service = ?`;
        params.push(args.service);
      }
      if (args.area) {
        query += ` AND area = ?`;
        params.push(args.area);
      }
      query += ` GROUP BY area, service ORDER BY count DESC LIMIT 8`;
      const stats = db.prepare(query).all(...params);
      return {
        stats: stats.map((s) => ({
          area: s.area,
          service: s.service,
          demandScore: s.count,
          demandLevel: s.count >= 3 ? 'HIGH' : s.count >= 2 ? 'MEDIUM' : 'LOW'
        }))
      };
    }

    case 'get_worker_location': {
      const workerId = Number(args.workerId);
      const bookingCode = String(args.bookingCode || '').trim().toUpperCase();

      // Authorization verification
      let authorized = false;
      if (user && (user.role === 'admin' || user.id === workerId)) authorized = true;
      if (user && user.role === 'customer') {
        const hasBooking = db.prepare(
          `SELECT 1 FROM bookings WHERE customer_id = ? AND worker_id = ? AND status IN ('Pending','Confirmed')`
        ).get(user.id, workerId);
        if (hasBooking) authorized = true;
      }
      if (!authorized && bookingCode) {
        const hasValidBooking = db.prepare(
          `SELECT 1 FROM bookings WHERE code = ? AND worker_id = ? AND status IN ('Pending','Confirmed')`
        ).get(bookingCode, workerId);
        if (hasValidBooking) authorized = true;
      }

      if (!authorized) {
        return {
          authorized: false,
          error: 'Worker live location is protected. You can view location once you have a confirmed booking with this worker.'
        };
      }

      const loc = db.prepare(
        `SELECT latitude, longitude, accuracy, updated_at FROM worker_locations
          WHERE worker_id = ? ORDER BY id DESC LIMIT 1`
      ).get(workerId);

      if (!loc) {
        return {
          authorized: true,
          available: false,
          message: 'Worker has not shared live location yet. Location is currently unavailable.'
        };
      }

      const updated = Date.parse(loc.updated_at + (loc.updated_at.includes('T') ? '' : 'Z'));
      const secondsAgo = Number.isFinite(updated) ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : 0;

      return {
        authorized: true,
        available: true,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        updatedAt: loc.updated_at,
        secondsAgo,
        statusText: `Worker location updated ${secondsAgo} seconds ago`
      };
    }

    case 'get_insurance_plan': {
      const plan = {
        name: 'Sahayak Suraksha (Basic Worker Protection)',
        type: 'Affordable worker protection plan — prototype',
        monthlyContribution: 49,
        coverageAmount: 200000,
        provider: 'Sahayak Suraksha Trust (Prototype Partner)',
        benefits: [
          'Work-related accident and injury protection',
          'Emergency assistance coverage',
          'Fast claim assistance workflow'
        ]
      };

      let workerStatus = null;
      let targetWorkerId = args.workerId;
      if (!targetWorkerId && user && user.role === 'worker') {
        const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
        if (worker) targetWorkerId = worker.id;
      }

      if (targetWorkerId) {
        const ins = db.prepare('SELECT * FROM worker_insurance WHERE worker_id = ?').get(targetWorkerId);
        if (ins) {
          workerStatus = {
            enrolled: true,
            status: ins.status,
            policyNumber: ins.policy_number,
            enrolledAt: ins.enrolled_at,
            renewalDate: ins.renewal_date
          };
        } else {
          workerStatus = { enrolled: false, status: 'Not enrolled' };
        }
      }

      return { plan, workerStatus };
    }

    case 'get_worker_safety': {
      let targetWorkerId = args.workerId;
      if (!targetWorkerId && user && user.role === 'worker') {
        const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
        if (worker) targetWorkerId = worker.id;
      }
      if (!targetWorkerId) {
        return { error: 'Worker ID required to retrieve safety score.' };
      }

      if (user && user.role === 'worker') {
        const worker = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(user.id);
        if (!worker || worker.id !== targetWorkerId) {
          return { error: 'You may only inspect your own operational safety workload.' };
        }
      }

      const snap = safetyService.readOrCalculate(targetWorkerId);
      if (!snap) return { error: 'Worker not found' };

      return {
        safetyScore: snap.safetyScore,
        status: snap.status,
        workloadLevel: snap.workloadLevel,
        workingMinutesToday: snap.workingMinutes,
        jobsCompletedToday: snap.jobsCompleted,
        jobsAssignedToday: snap.jobsAssigned,
        recommendation: snap.recommendation
      };
    }

    case 'get_nearby_workers': {
      const radiusKm = args.radiusKm || 5.0;
      const where = ["verification = 'Verified'", "availability = 'Available'"];
      const params = {};
      if (args.service) {
        where.push('service = @service');
        params.service = args.service;
      }

      const workers = db.prepare(
        `SELECT id, code, name, service, rating, distance_km, price_from, latitude, longitude
           FROM workers WHERE ${where.join(' AND ')} AND distance_km <= ${radiusKm}
          ORDER BY distance_km ASC, rating DESC LIMIT 5`
      ).all(params);

      workers.slice(0, 2).forEach((w) => {
        actionsCollector.push({ type: 'book_worker', workerId: w.id, label: `Book ${w.name}` });
      });

      return { count: workers.length, workers };
    }

    case 'create_booking': {
      const workerId = Number(args.workerId);
      const preferredDate = String(args.preferredDate || '').trim();
      const preferredTime = String(args.preferredTime || '').trim();
      const customerName = String(args.customerName || (user ? user.name : '')).trim();
      const mobile = String(args.mobile || (user ? user.phone || '9810012345' : '9810012345')).trim();
      const address = String(args.address || 'Customer Location, Noida').trim();
      const instructions = String(args.instructions || '').trim();
      const isEmergency = Boolean(args.isEmergency);

      if (!workerId || !preferredDate || !preferredTime) {
        return { success: false, error: 'Worker, date, and time slot are required.' };
      }

      const worker = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
      if (!worker) return { success: false, error: 'Worker not found' };
      if (worker.availability !== 'Available') {
        return { success: false, error: `${worker.name} is currently marked unavailable.` };
      }

      const clash = db.prepare(
        `SELECT 1 FROM bookings WHERE worker_id = ? AND preferred_date = ? AND preferred_time = ? AND status IN ('Pending','Confirmed')`
      ).get(workerId, preferredDate, preferredTime);
      if (clash) {
        return { success: false, error: `${worker.name} already has a booking at ${preferredTime} on ${preferredDate}. Please pick another slot.` };
      }

      const gate = safetyService.canAssignWorker(workerId, { isEmergency });
      if (!gate.ok) {
        return { success: false, error: gate.error };
      }

      const code = nextBookingCode();
      const travel = safetyService.estimateTravelMinutes(worker);
      const customerId = user ? user.id : null;

      db.prepare(
        `INSERT INTO bookings (code, customer_id, worker_id, service, customer_name, mobile,
                               address, preferred_date, preferred_time, instructions, amount, status,
                               travel_minutes, is_emergency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`
      ).run(code, customerId, workerId, worker.service, customerName, mobile, address, preferredDate, preferredTime, instructions, worker.price_from, travel, isEmergency ? 1 : 0);

      try { safetyService.calculateForWorker(workerId); } catch (e) { /* ignore */ }

      actionsCollector.push({ type: 'view_booking', bookingCode: code, label: `View Booking ${code}` });

      return {
        success: true,
        bookingCode: code,
        workerName: worker.name,
        service: worker.service,
        date: preferredDate,
        time: preferredTime,
        amount: worker.price_from,
        status: 'Pending',
        note: 'Booking request sent to worker. Worker confirmation pending.'
      };
    }

    default:
      return { error: `Tool ${name} is not permitted.` };
  }
}

/* ------------------------------------------------------------------ *
 * System Prompt
 * ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are Sahayak, the intelligent assistant for Sahayak Setu — an Indian cooperative platform connecting households with verified local service workers (Electricians, Plumbers, Cleaners, Drivers, Carpenters, Painters).

Core Rules & Behavior:
- Be warm, concise, and practical. 2 to 3 short sentences is ideal.
- NEVER invent, hallucinate, or assume worker names, ratings, phone numbers, prices, booking IDs, insurance policies, or live locations.
- When you need information, ALWAYS call the appropriate tool to query the backend database.
- Gemini thinks, backend verifies, database provides the truth.
- Currency is Indian Rupees (${RUPEE}). Always format prices as ${RUPEE}450.
- When someone describes a problem ("fan spark ho raha hai", "water leakage", "room paint karna hai"), use find_workers or get_nearby_workers to find real verified workers and recommend them with real rating and starting price.
- Natural Language & Multilingual:
  - If the user writes in English, reply in English.
  - If the user writes in Hindi or Roman Hindi (e.g. "mera fan kharab hai", "paani tapak raha hai"), reply in the same natural Roman Hindi / Hindi.
- Plain text only. Keep markdown formatting minimal (avoid long bullet lists or complex tables).
- Never ask for or mention passwords, OTPs, or credit card / bank details.
- For worker safety queries, only use get_worker_safety. Talk about operational workload, hours, breaks, and jobs. Never diagnose health conditions.
- For worker insurance, use get_insurance_plan. Clearly describe it as affordable cooperative protection (prototype plan).
- For tracking, only provide location info returned by get_worker_location. If unavailable, say so honestly.`;

/* ------------------------------------------------------------------ *
 * Rule-Based Fallback Brain (Works offline or when API key is missing)
 * ------------------------------------------------------------------ */

const INTENT_WORDS = {
  Electrician: ['electric', 'electrician', 'fan', 'light', 'bulb', 'wiring', 'wire', 'switch', 'socket', 'short circuit', 'spark', 'mcb', 'fuse', 'inverter', 'bijli', 'current', 'pankha'],
  Plumber:     ['plumb', 'plumber', 'tap', 'leak', 'pipe', 'water', 'drain', 'toilet', 'flush', 'basin', 'geyser', 'motor', 'nal', 'paani', 'seepage'],
  Cleaner:     ['clean', 'cleaner', 'cleaning', 'sweep', 'mop', 'dust', 'sofa', 'bathroom clean', 'deep clean', 'safai', 'jhadu', 'kachra'],
  Driver:      ['driver', 'drive', 'car', 'taxi', 'trip', 'airport', 'pick up', 'drop', 'gaadi', 'chauffeur'],
  Carpenter:   ['carpenter', 'wood', 'furniture', 'door', 'cupboard', 'almirah', 'hinge', 'table', 'chair', 'bed frame', 'lakdi', 'darwaza'],
  Painter:     ['paint', 'painter', 'painting', 'wall', 'whitewash', 'putty', 'distemper', 'rang', 'safedi']
};

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function detectService(text) {
  const lower = String(text || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [service, words] of Object.entries(INTENT_WORDS)) {
    const score = words.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
    if (score > bestScore) { best = service; bestScore = score; }
  }
  return best;
}

function buildContext(user) {
  const services = db.prepare(
    `SELECT s.name, s.base_price,
            (SELECT COUNT(*) FROM workers w WHERE w.service = s.name AND w.availability = 'Available' AND w.verification = 'Verified') AS available
       FROM services s ORDER BY s.demand DESC`
  ).all();

  const workers = db.prepare(
    `SELECT id, name, service, rating, distance_km, price_from
       FROM workers WHERE availability = 'Available' AND verification = 'Verified'
      ORDER BY rating DESC LIMIT 10`
  ).all();

  let bookings = [];
  let workerSafety = null;
  if (user) {
    bookings = db.prepare(
      `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, w.name AS worker
         FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id
        WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 5`
    ).all(user.id);

    if (user.role === 'worker') {
      workerSafety = safetyService.safetyContextForUser(user);
    }
  }

  return { services, workers, bookings, user, workerSafety };
}

function fallbackReply(message, user = null, actionsCollector = []) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  const ctx = buildContext(user);

  // Booking ID lookup (SS-YYYY-####)
  const codeMatch = text.toUpperCase().match(/SS-\d{4}-\d{3,}/);
  if (codeMatch) {
    const row = db.prepare(
      `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, w.name AS worker
         FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id WHERE b.code = ?`
    ).get(codeMatch[0]);

    if (row) {
      if (row.status === 'Confirmed') {
        actionsCollector.push({ type: 'track_worker', bookingCode: row.code, label: `Track Worker (${row.code})` });
      }
      return `Booking ${row.code} is ${row.status.toLowerCase()}. ${row.service} with ${row.worker || 'a worker yet to be assigned'}, scheduled for ${row.preferred_date} at ${row.preferred_time}.`;
    }
    return `I could not find a booking with the ID ${codeMatch[0]}. Please double-check it — the format is SS-2026-1001.`;
  }

  // Location / Tracking ("kaha tak pahucha", "kaha hai", "track")
  if (lower.includes('kaha') || lower.includes('track') || lower.includes('location') || lower.includes('reach') || lower.includes('pahucha')) {
    if (user && user.role === 'customer') {
      const activeBooking = db.prepare(
        `SELECT b.code, b.worker_id, w.name AS worker_name FROM bookings b
           JOIN workers w ON w.id = b.worker_id
          WHERE b.customer_id = ? AND b.status = 'Confirmed'
          ORDER BY b.id DESC LIMIT 1`
      ).get(user.id);

      if (activeBooking) {
        const loc = db.prepare(`SELECT * FROM worker_locations WHERE worker_id = ? ORDER BY id DESC LIMIT 1`).get(activeBooking.worker_id);
        actionsCollector.push({ type: 'track_worker', bookingCode: activeBooking.code, label: `Track ${activeBooking.worker_name}` });
        if (loc) {
          return `${activeBooking.worker_name} aapke active booking (${activeBooking.code}) ke liye on the way hain. Aap 'Track Worker' button se live map dekh sakte hain.`;
        }
        return `${activeBooking.worker_name} aapke active booking (${activeBooking.code}) ke liye assign ho chuke hain, lekin worker ne abhi live location share nahi ki hai.`;
      }
    }
    return 'Worker live location dekhne ke liye aapke paas ek Confirmed booking honi chahiye. Aap My Bookings section se "Track Worker" par click karke map dekh sakte hain.';
  }

  // Suraksha Insurance ("insurance", "suraksha", "bima")
  if (lower.includes('insurance') || lower.includes('suraksha') || lower.includes('bima') || lower.includes('claim')) {
    actionsCollector.push({ type: 'view_insurance', label: 'View Suraksha Plan' });
    return 'Sahayak Suraksha hamara cooperative worker protection plan hai: ₹49/month mein up to ₹2,00,000 accidental coverage, work-injury assistance aur emergency claim support. Worker profile se ise enroll kar sakte hain.';
  }

  // Demand / Complaints ("demand", "complaint", "shikayat", "area")
  if (lower.includes('demand') || lower.includes('complaint') || lower.includes('area') || lower.includes('heatmap')) {
    const topAreas = db.prepare(
      `SELECT area, service, COUNT(*) as c FROM service_complaints GROUP BY area, service ORDER BY c DESC LIMIT 3`
    ).all();
    if (topAreas.length) {
      const summary = topAreas.map((t) => `${t.area} (${t.service})`).join(', ');
      return `Current high-demand areas: ${summary}. Worker dashboard par Demand Heatmap dekh kar aap concentrated demand areas follow kar sakte hain.`;
    }
    return 'Worker dashboard par Demand Heatmap se aap real-time service complaints aur demand clusters dekh sakte hain.';
  }

  // Worker Safety / Workload
  if (lower.includes('workload') || lower.includes('fatigue') || lower.includes('safety score') || lower.includes('hours') ||
      (lower.includes('safe') && (lower.includes('my') || lower.includes('score') || lower.includes('worker')))) {
    if (ctx.workerSafety) {
      const s = ctx.workerSafety;
      const hours = Math.floor(s.workingMinutes / 60);
      const mins = s.workingMinutes % 60;
      return `Aapka current Safety Score ${s.safetyScore}% hai (${s.status}). Aaj aapne ${s.jobsCompleted} jobs complete ki hain aur lagbhag ${hours}h ${mins}m kaam kiya hai. ${s.recommendation}`;
    }
    return 'Worker Safety System fatigue aur workload monitor karta hai. Logged-in workers apne profile par Safety Score aur safe assignment recommendation dekh sakte hain.';
  }

  // Greetings
  if (/^(hi|hello|hey|namaste|namaskar|hii|hlo|pranam)\b/.test(lower)) {
    return 'Namaste! Main Sahayak hoon, SahayakSetu ka AI assistant. Aapko ghar par electrician, plumber, cleaner ya koi aur service chahiye to batayein, main verified workers dhoondh dunga.';
  }

  // Prices
  if (lower.includes('price') || lower.includes('cost') || lower.includes('charge') ||
      lower.includes('rate') || lower.includes('kitna') || lower.includes('fees') || lower.includes('paisa')) {
    const list = ctx.services.slice(0, 4).map((s) => `${s.name} from ${RUPEE}${s.base_price}`).join(', ');
    return `Starting prices abhi: ${list}. Final price kaam dekh kar decide hoti hai, aur payment direct worker ko kaam ke baad dena hota hai.`;
  }

  // My Bookings
  if (lower.includes('my booking') || lower.includes('my bookings') || lower.includes('mera booking') || lower.includes('status')) {
    if (!ctx.user) return 'Apni bookings dekhne ke liye please log in karein, ya mujhe booking code dein (jaise SS-2026-1001).';
    if (!ctx.bookings.length) return 'Aapki koi active booking nahi mili. Dashboard se worker select karke book kar sakte hain.';
    ctx.bookings.slice(0, 2).forEach((b) => {
      if (b.status === 'Confirmed') {
        actionsCollector.push({ type: 'track_worker', bookingCode: b.code, label: `Track ${b.code}` });
      }
    });
    return 'Aapki recent bookings: ' + ctx.bookings
      .map((b) => `${b.code} — ${b.service} with ${b.worker || 'unassigned'}, ${b.status} (${b.preferred_date} ${b.preferred_time})`)
      .join('. ') + '.';
  }

  // Problem description -> detect service
  const service = detectService(text);
  if (service) {
    const matches = ctx.workers.filter((w) => w.service === service).slice(0, 2);
    if (matches.length) {
      matches.forEach((w) => {
        actionsCollector.push({ type: 'book_worker', workerId: w.id, label: `Book ${w.name}` });
      });
      const who = matches
        .map((w) => `${w.name} (⭐${w.rating}, ${w.distance_km} km, from ${RUPEE}${w.price_from})`)
        .join(' aur ');
      return `Ye ${service} ka kaam lag raha hai. Nearby verified workers available hain: ${who}. Aap dashboard se direct book kar sakte hain.`;
    }
    return `Ye ${service} ka kaam lag raha hai. Abhi koi verified ${service} available nahi hai, thodi der mein dobara check karein.`;
  }

  return `Main aapko verified workers dhoondhne, starting prices batane, ya booking status check karne mein help kar sakta hoon. Humein bataiye aapko kis service ki zaroorat hai?`;
}

/* ------------------------------------------------------------------ *
 * Gemini 2.5 Flash Function-Calling Engine (Two-Stage Execution)
 * ------------------------------------------------------------------ */

async function callGemini(history, user) {
  const aiClient = getAiClient();
  if (!aiClient) throw new Error('Gemini API key is not configured.');

  const actionsCollector = [];

  // Convert conversation history to Gemini contents format
  const contents = [];
  for (const m of history) {
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    });
  }

  // Ensure last message is from user
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  // Stage 1: Send query with tools to Gemini
  const response = await aiClient.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
      temperature: 0.3
    }
  });

  const functionCalls = response.functionCalls;

  // If Gemini did not call any tools, return direct text
  if (!functionCalls || functionCalls.length === 0) {
    const reply = response.text ? response.text.trim() : fallbackReply(history[history.length - 1]?.content, user, actionsCollector);
    return { reply, actions: actionsCollector };
  }

  // Stage 2: Execute tools server-side against SQLite
  const functionResponses = [];
  for (const call of functionCalls) {
    const toolName = call.name;
    const toolArgs = call.args || {};
    const result = await executeTool(toolName, toolArgs, user, actionsCollector);
    functionResponses.push({
      name: toolName,
      response: result
    });
  }

  // Send tool responses back to Gemini for natural language synthesis
  // Note: preserve candidateContent directly to retain required thought_signature
  const candidateContent = response.candidates && response.candidates[0] && response.candidates[0].content;
  const toolContents = [
    ...contents,
    candidateContent || {
      role: 'model',
      parts: functionCalls.map((fc) => ({
        functionCall: { name: fc.name, args: fc.args }
      }))
    },
    {
      role: 'user',
      parts: functionResponses.map((fr) => ({
        functionResponse: {
          name: fr.name,
          response: fr.response
        }
      }))
    }
  ];

  const finalResponse = await aiClient.models.generateContent({
    model: MODEL,
    contents: toolContents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.3
    }
  });

  const reply = finalResponse.text ? finalResponse.text.trim() : 'I have verified the details from our database.';
  return { reply, actions: actionsCollector };
}

/* ------------------------------------------------------------------ *
 * Grok (xAI) Provider Implementation with 12 Grounded Tools
 * ------------------------------------------------------------------ */

function getOpenAiTools() {
  return FUNCTION_DECLARATIONS.map((d) => {
    const props = {};
    for (const [k, v] of Object.entries(d.parameters?.properties || {})) {
      props[k] = {
        type: String(v.type).toLowerCase(),
        description: v.description
      };
    }
    return {
      type: 'function',
      function: {
        name: d.name,
        description: d.description,
        parameters: {
          type: 'object',
          properties: props,
          required: d.parameters?.required || []
        }
      }
    };
  });
}

function getOpenAiConfig(provider) {
  if (provider === 'groq') {
    const apiKey = (process.env.GROQ_API_KEY || process.env.GROK_API_KEY || '').trim();
    const envModel = process.env.GROQ_MODEL || (process.env.GROK_MODEL && !process.env.GROK_MODEL.startsWith('grok') ? process.env.GROK_MODEL : '');
    const model = envModel || 'qwen/qwen3.8-27b';
    return {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey,
      model,
      name: 'Groq'
    };
  }
  // Default to xAI Grok
  return {
    endpoint: 'https://api.x.ai/v1/chat/completions',
    apiKey: (process.env.GROK_API_KEY || '').trim(),
    model: process.env.GROK_MODEL || 'grok-2-latest',
    name: 'Grok'
  };
}

async function callOpenAiCompatible(history, user, provider = 'groq') {
  const cfg = getOpenAiConfig(provider);
  if (!cfg.apiKey) throw new Error(`${cfg.name} API key is not configured.`);
  const actionsCollector = [];

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }))
  ];

  const tools = getOpenAiTools();

  // Stage 1: Send messages and available tools to the LLM
  const res1 = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 350
    })
  });

  if (!res1.ok) {
    const errText = await res1.text();
    throw new Error(`${cfg.name} API error (${res1.status}): ${errText}`);
  }

  const data1 = await res1.json();
  const msg1 = data1.choices && data1.choices[0] && data1.choices[0].message;
  if (!msg1) throw new Error(`No response message returned by ${cfg.name}.`);

  // If no tools were called, return direct text
  if (!msg1.tool_calls || msg1.tool_calls.length === 0) {
    return {
      reply: msg1.content ? msg1.content.trim() : 'I am here to help you with Sahayak Setu services.',
      actions: actionsCollector
    };
  }

  // Stage 2: Execute tools server-side against SQLite
  const toolMessages = [];
  for (const tc of msg1.tool_calls) {
    const fnName = tc.function.name;
    let fnArgs = {};
    try {
      fnArgs = JSON.parse(tc.function.arguments || '{}');
    } catch {
      fnArgs = {};
    }
    const result = await executeTool(fnName, fnArgs, user, actionsCollector);
    toolMessages.push({
      role: 'tool',
      tool_call_id: tc.id,
      name: fnName,
      content: JSON.stringify(result)
    });
  }

  // Send tool execution results back for natural language synthesis
  const secondMessages = [
    ...messages,
    msg1,
    ...toolMessages
  ];

  const res2 = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: secondMessages,
      temperature: 0.3,
      max_tokens: 350
    })
  });

  if (!res2.ok) {
    const errText2 = await res2.text();
    throw new Error(`${cfg.name} synthesis error (${res2.status}): ${errText2}`);
  }

  const data2 = await res2.json();
  const msg2 = data2.choices && data2.choices[0] && data2.choices[0].message;
  const reply = msg2?.content ? msg2.content.trim() : 'I have verified the details from our database.';
  return { reply, actions: actionsCollector };
}

// Backward-compatibility wrapper for Grok
async function callGrok(history, user) {
  return callOpenAiCompatible(history, user, 'grok');
}

/* ------------------------------------------------------------------ *
 * Main AI Entry Point
 * ------------------------------------------------------------------ */

async function getReply(history, user) {
  const lastUserMessage = [...history].reverse().find((m) => m.role === 'user');
  const text = lastUserMessage ? lastUserMessage.content : '';
  const actionsCollector = [];
  const provider = getActiveProvider();

  if (provider === 'groq' || provider === 'grok') {
    try {
      const { reply, actions } = await callOpenAiCompatible(history, user, provider);
      return { reply, source: provider, actions };
    } catch (err) {
      console.error(`[ai] ${provider} call failed, using grounded fallback:`, err.message);
      const reply = fallbackReply(text, user, actionsCollector);
      return {
        reply,
        source: 'fallback',
        actions: actionsCollector,
        warning: err.message
      };
    }
  }

  if (provider === 'gemini') {
    try {
      const { reply, actions } = await callGemini(history, user);
      return { reply, source: 'gemini', actions };
    } catch (err) {
      console.error('[ai] Gemini call failed, using grounded fallback:', err.message);
      const reply = fallbackReply(text, user, actionsCollector);
      return {
        reply,
        source: 'fallback',
        actions: actionsCollector,
        warning: err.message
      };
    }
  }

  const reply = fallbackReply(text, user, actionsCollector);
  return { reply, source: 'fallback', actions: actionsCollector };
}

module.exports = {
  getReply,
  hasKey,
  getActiveProvider,
  buildContext,
  fallbackReply,
  detectService,
  executeTool,
  FUNCTION_DECLARATIONS
};

