/**
 * ecosystem.test.js — Integration & security test suite for new ecosystem capabilities:
 *  - Maps & Real worker coordinates
 *  - Worker live location update
 *  - Authorization-protected worker tracking
 *  - GeoJSON Demand & Complaint Heatmap
 *  - Suraksha Micro-Insurance prototype
 *  - Emergency SOS workflow
 *  - Worker Safety score & fatigue management
 *  - Chat actions & Gemini fallback
 */
const http = require('http');

let pass = 0, fail = 0;
const failures = [];

function req(method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers.Authorization = `Bearer ${token}`;

    const r = http.request({ host: '127.0.0.1', port: 4000, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    r.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message, json: null }));
    if (payload) r.write(payload);
    r.end();
  });
}

function ok(label, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ' :: ' + detail : ''}`);
  }
}

const stamp = Date.now();
const email = (tag) => `eco-${tag}-${stamp}@test.com`;

(async () => {
  console.log('=== 1. HEALTH & CHAT AI STATUS ===');
  let r = await req('GET', '/api/health');
  ok('health returns ok:true', r.status === 200 && r.json && r.json.ok === true);
  ok('health identifies ai mode', ['fallback', 'gemini', 'grok', 'groq'].includes(r.json?.ai), JSON.stringify(r.json?.ai));

  r = await req('GET', '/api/chat/health');
  ok('chat health ok', r.status === 200 && r.json && r.json.ok === true);
  ok('chat ai configured', ['fallback', 'gemini', 'grok', 'groq'].includes(r.json?.ai));

  console.log('\n=== 2. MAPS & COMPLAINT HEATMAP ===');
  r = await req('GET', '/api/maps/workers');
  ok('maps workers list 200', r.status === 200 && Array.isArray(r.json?.workers));
  ok('workers have real coordinates', r.json?.workers.length > 0 && typeof r.json.workers[0].latitude === 'number');

  r = await req('GET', '/api/maps/complaints/heatmap');
  ok('complaint heatmap GeoJSON 200', r.status === 200 && r.json?.type === 'FeatureCollection');
  ok('heatmap contains features', Array.isArray(r.json?.features) && r.json.features.length > 0);
  ok('heatmap feature properties have demand weight or level', r.json?.features[0]?.properties?.weight > 0 || !!r.json?.features[0]?.properties?.demandLevel);

  r = await req('GET', '/api/maps/complaints/heatmap?service=Electrician');
  ok('complaint heatmap filtered by service', r.status === 200 && r.json?.features.every((f) => f.properties.service === 'Electrician'));

  console.log('\n=== 3. AUTH & ROLES SETUP FOR TRACKING & SAFETY ===');
  // Register worker
  r = await req('POST', '/api/auth/register', {
    body: { name: 'Eco Worker', email: email('worker'), phone: '9111111111', password: 'password123', role: 'worker', service: 'Plumber', priceFrom: 400 }
  });
  ok('worker registered', r.status === 201 && !!r.json?.token);
  const workerToken = r.json?.token;

  // Retrieve worker profile to get worker.id
  r = await req('GET', '/api/auth/me', { token: workerToken });
  const workerId = r.json?.workerProfile?.id;
  ok('worker profile resolved with worker id', Number.isInteger(workerId) && workerId > 0, `workerId=${workerId}`);

  // Register customer 1 (has booking)
  r = await req('POST', '/api/auth/register', {
    body: { name: 'Eco Customer 1', email: email('cust1'), phone: '9222222222', password: 'password123', role: 'customer' }
  });
  ok('customer 1 registered', r.status === 201 && !!r.json?.token);
  const cust1Token = r.json?.token;

  // Register customer 2 (unrelated, no booking)
  r = await req('POST', '/api/auth/register', {
    body: { name: 'Eco Customer 2', email: email('cust2'), phone: '9333333333', password: 'password123', role: 'customer' }
  });
  ok('customer 2 registered', r.status === 201 && !!r.json?.token);
  const cust2Token = r.json?.token;

  console.log('\n=== 4. WORKER LOCATION UPDATE & PROTECTED TRACKING ===');
  // Worker updates location
  r = await req('PATCH', '/api/maps/workers/me/location', {
    token: workerToken,
    body: { latitude: 28.5720, longitude: 77.3250, accuracy: 12.5 }
  });
  ok('worker updates own location 200', r.status === 200 && r.json?.ok === true);

  // Unrelated customer tries to track worker -> MUST RETURN 403 Forbidden
  r = await req('GET', `/api/maps/workers/${workerId}/location`, { token: cust2Token });
  ok('unrelated customer tracking blocked with 403', r.status === 403, `${r.status} ${r.body}`);

  // Guest tries to track worker -> MUST RETURN 403 Forbidden
  r = await req('GET', `/api/maps/workers/${workerId}/location`);
  ok('guest tracking blocked with 403', r.status === 403);

  // Worker can see their own location
  r = await req('GET', `/api/maps/workers/${workerId}/location`, { token: workerToken });
  ok('worker can see own location 200', r.status === 200 && r.json?.available === true);
  ok('worker location accuracy matches', r.json?.accuracy === 12.5);

  // Customer 1 books the worker
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  r = await req('POST', '/api/bookings', {
    token: cust1Token,
    body: {
      workerId,
      customerName: 'Eco Customer 1',
      mobileNumber: '9222222222',
      serviceAddress: 'Sector 62 Noida',
      preferredDate: tomorrow,
      preferredTime: '10:00 AM'
    }
  });
  ok('booking created', r.status === 201 && !!r.json?.booking?.code);
  const bookingCode = r.json?.booking?.code;

  // Now Customer 1 tracks the worker -> MUST BE ALLOWED (200 OK)
  r = await req('GET', `/api/maps/workers/${workerId}/location`, { token: cust1Token });
  ok('authorized customer with active booking can track worker 200', r.status === 200 && r.json?.available === true);
  ok('tracking returns statusText and secondsAgo', typeof r.json?.secondsAgo === 'number' && typeof r.json?.statusText === 'string');

  console.log('\n=== 5. WORKER SURAKSHA MICRO-INSURANCE PROTOTYPE ===');
  r = await req('GET', '/api/safety/insurance/plan');
  ok('insurance plan details 200', r.status === 200 && !!r.json?.plan?.planName);
  ok('insurance specifies prototype badge', /prototype/i.test(r.json?.plan?.type || '') || /prototype/i.test(r.json?.plan?.notice || ''));

  r = await req('GET', '/api/safety/insurance/status', { token: workerToken });
  ok('insurance status 200', r.status === 200 && r.json?.enrolled === false);

  // Enroll
  r = await req('POST', '/api/safety/insurance/enroll', {
    token: workerToken,
    body: { planName: 'Worker Suraksha Micro-Coverage' }
  });
  ok('insurance enrollment 201', r.status === 201 && r.json?.enrolled === true);
  ok('policy number generated', typeof r.json?.policyNumber === 'string');

  // Claim
  r = await req('POST', '/api/safety/insurance/claim', {
    token: workerToken,
    body: { incidentId: null, description: 'Minor heat exhaustion assistance test' }
  });
  ok('claim submission 201', r.status === 201 && r.json?.status === 'Submitted');

  console.log('\n=== 6. WORKER EMERGENCY SOS WORKFLOW ===');
  r = await req('POST', '/api/safety/sos', {
    token: workerToken,
    body: { latitude: 28.5720, longitude: 77.3250, emergencyType: 'Accident / Medical Injury' }
  });
  ok('SOS trigger 201', r.status === 201 && r.json?.ok === true);
  ok('SOS created incident with assistance instructions', !!r.json?.incidentId && !!r.json?.procedure);

  r = await req('GET', '/api/safety/incidents/me', { token: workerToken });
  ok('worker incidents list 200', r.status === 200 && r.json?.incidents.length >= 1);

  console.log('\n=== 7. WORKER FATIGUE & SAFETY SCORE SYSTEM ===');
  r = await req('GET', '/api/workers/me/safety', { token: workerToken });
  ok('worker safety score 200', r.status === 200 && typeof r.json?.safetyScore === 'number');

  r = await req('POST', '/api/workers/me/breaks/start', { token: workerToken });
  ok('worker starts break 200', r.status === 200 && r.json?.ok === true);

  r = await req('POST', '/api/workers/me/breaks/end', { token: workerToken });
  ok('worker ends break 200', r.status === 200 && r.json?.ok === true);

  r = await req('GET', '/api/safety/demand-insights?service=Plumber', { token: workerToken });
  ok('demand insights 200', r.status === 200 && typeof r.json?.insights[0]?.demandLevel === 'string');

  console.log('\n=== 8. CHAT WORKER RECOMMENDATIONS & TOOL ACTIONS ===');
  r = await req('POST', '/api/chat', {
    body: { message: 'Can you recommend an electrician in Sector 62?', sessionId: 'eco-chat-session' }
  });
  ok('chat response 200', r.status === 200 && typeof r.json?.reply === 'string');
  ok('chat provides structured actions', Array.isArray(r.json?.actions));

  console.log(`\n${'='.repeat(50)}\nPASSED=${pass}  FAILED=${fail}`);
  if (failures.length) {
    console.log('FAILURES:\n - ' + failures.join('\n - '));
  }
  process.exit(fail ? 1 : 0);
})();
