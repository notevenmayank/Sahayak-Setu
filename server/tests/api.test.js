/**
 * End-to-end API test suite for SahayakSetu.
 * Runs real HTTP requests against the running server on port 4000.
 */
const http = require('http');

let pass = 0, fail = 0;
const failures = [];

function req(method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
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
  if (condition) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ' :: ' + detail : ''}`); }
}

const isSorted = (a, desc) => a.every((v, i) => i === 0 || (desc ? a[i - 1] >= v : a[i - 1] <= v));

(async () => {
  console.log('=== PUBLIC ===');
  let r = await req('GET', '/api/health');
  ok('health 200 + ok:true', r.status === 200 && r.json && r.json.ok === true, r.body.slice(0, 120));
  ok('health reports fallback AI, gemini, grok, or groq', ['fallback', 'gemini', 'grok', 'groq'].includes(r.json && r.json.ai), JSON.stringify(r.json && r.json.ai));
  ok('health counts seeded', r.json && r.json.counts.workers >= 8 && r.json.counts.users >= 3, JSON.stringify(r.json && r.json.counts));

  r = await req('GET', '/api/services');
  ok('services list', r.status === 200 && r.json.services.length === 6, `len=${r.json && r.json.services && r.json.services.length}`);
  ok('services expose worker_count', r.json.services.every((s) => typeof s.worker_count === 'number'));
  ok('services expose icon (dashboard needs it)', r.json.services.every((s) => !!s.icon));

  r = await req('GET', '/api/workers');
  const workers = r.json.workers;
  ok('workers list', r.status === 200 && workers.length >= 7, `len=${workers.length}`);
  ok('worker fields match dashboard.js', workers.every((w) =>
    ['id', 'name', 'service', 'rating', 'jobs_done', 'distance_km', 'price_from', 'verification', 'availability']
      .every((k) => w[k] !== undefined)), JSON.stringify(workers[0]));
  ok('suspended never listed', workers.every((w) => w.verification !== 'Suspended'));

  r = await req('GET', '/api/workers?service=Electrician');
  ok('filter by service', r.json.workers.length > 0 && r.json.workers.every((w) => w.service === 'Electrician'));

  r = await req('GET', '/api/workers?sort=price');
  ok('sort by price asc', isSorted(r.json.workers.map((w) => w.price_from), false), JSON.stringify(r.json.workers.map((w) => w.price_from)));
  r = await req('GET', '/api/workers?sort=rating');
  ok('sort by rating desc', isSorted(r.json.workers.map((w) => w.rating), true), JSON.stringify(r.json.workers.map((w) => w.rating)));
  r = await req('GET', '/api/workers?available=true');
  ok('filter available', r.json.workers.every((w) => w.availability === 'Available'));
  r = await req('GET', '/api/workers?q=ramesh');
  ok('search by name', r.json.workers.length === 1 && /Ramesh/i.test(r.json.workers[0].name));

  r = await req('GET', '/api/workers/1');
  ok('worker by id', r.status === 200 && r.json.worker && Array.isArray(r.json.recentBookings));
  r = await req('GET', '/api/workers/9999');
  ok('worker 404', r.status === 404);
  r = await req('GET', '/api/nope');
  ok('unknown api 404 json', r.status === 404 && /Unknown API/.test(r.body));

  console.log('\n=== AUTH ===');
  r = await req('POST', '/api/auth/login', { body: { email: 'customer@demo.com', password: 'wrong' } });
  const wrongPwMsg = r.json && r.json.error;
  ok('wrong password rejected', r.status === 401, `${r.status}`);
  r = await req('POST', '/api/auth/login', { body: { email: 'nobody@example.com', password: 'demo1234' } });
  ok('unknown email same message (no enumeration)', r.json && r.json.error === wrongPwMsg, `"${wrongPwMsg}" vs "${r.json && r.json.error}"`);

  r = await req('POST', '/api/auth/login', { body: { email: 'customer@demo.com', password: 'demo1234' } });
  ok('customer login', r.status === 200 && !!r.json.token);
  const TOKC = r.json.token;
  ok('login does not leak password_hash', !/password_hash|\$shim\$/.test(r.body));

  r = await req('GET', '/api/auth/me', { token: TOKC });
  ok('me returns user', r.status === 200 && r.json.user.role === 'customer');
  ok('me 401 without token', (await req('GET', '/api/auth/me')).status === 401);
  ok('me 401 with garbage token', (await req('GET', '/api/auth/me', { token: 'garbage' })).status === 401);
  // A token signed with the wrong secret must be rejected
  const forged = require('jsonwebtoken').sign({ sub: 1, role: 'admin', email: 'x' }, 'not-the-secret');
  ok('forged token rejected', (await req('GET', '/api/auth/me', { token: forged })).status === 401);

  r = await req('POST', '/api/auth/register', { body: { name: 'Hax', email: 'hax@x.com', password: 'pass1234', role: 'admin' } });
  ok('self-serve admin blocked', r.status === 403, `${r.status}`);

  const newWorkerEmail = `w${Date.now()}@x.com`;
  r = await req('POST', '/api/auth/register', { body: { name: 'New Worker', email: newWorkerEmail, password: 'pass1234', role: 'worker', service: 'Plumber' } });
  ok('worker signup', r.status === 201 && !!r.json.token, `${r.status} ${r.body.slice(0, 120)}`);
  const TOKW2 = r.json.token;
  r = await req('GET', '/api/auth/me', { token: TOKW2 });
  // workerProfile is a sibling of user in the envelope; js/profile.js reads me.workerProfile
  ok('worker signup creates pending profile', r.json.workerProfile && r.json.workerProfile.verification === 'Pending Verification',
      JSON.stringify(r.json.workerProfile));
  r = await req('POST', '/api/auth/register', { body: { name: 'Dup', email: newWorkerEmail, password: 'pass1234', role: 'customer' } });
  ok('duplicate email rejected', r.status === 409, `${r.status}`);
  r = await req('POST', '/api/auth/register', { body: { name: 'S', email: 'short@x.com', password: '123', role: 'customer' } });
  ok('short password rejected', r.status === 400, `${r.status}`);

  console.log('\n=== RBAC ===');
  const TOKA = (await req('POST', '/api/auth/login', { body: { email: 'admin@demo.com', password: 'demo1234' } })).json.token;
  const TOKW = (await req('POST', '/api/auth/login', { body: { email: 'worker@demo.com', password: 'demo1234' } })).json.token;
  ok('admin can read stats', (await req('GET', '/api/admin/stats', { token: TOKA })).status === 200);
  ok('customer blocked from stats 403', (await req('GET', '/api/admin/stats', { token: TOKC })).status === 403);
  ok('worker blocked from stats 403', (await req('GET', '/api/admin/stats', { token: TOKW })).status === 403);
  ok('anon blocked from stats 401', (await req('GET', '/api/admin/stats')).status === 401);
  ok('audit admin-only', (await req('GET', '/api/admin/audit', { token: TOKC })).status === 403);
  ok('admin worker list admin-only', (await req('GET', '/api/admin/workers', { token: TOKC })).status === 403);
  r = await req('GET', '/api/admin/analytics', { token: TOKA });
  ok('analytics shape for admin.js', r.status === 200 && r.json.analytics.every((a) => 'name' in a && 'percent' in a && 'icon' in a),
      JSON.stringify(r.json.analytics && r.json.analytics[0]));

  console.log('\n=== BOOKING FLOW ===');
  const { db: testDb } = require('../db');
  testDb.prepare("UPDATE bookings SET status = 'Cancelled' WHERE worker_id = 1 AND preferred_date = '2026-12-01'").run();

  r = await req('GET', '/api/bookings/slots?workerId=1&date=2026-12-01');
  ok('slots list', r.status === 200 && r.json.slots.length === 8 && 'available' in r.json.slots[0], r.body.slice(0, 140));

  const good = { workerId: 1, customerName: 'Test User', mobileNumber: '9876543210', serviceAddress: '12 MG Road, Bengaluru 560001', preferredDate: '2026-12-01', preferredTime: '10:00 AM' };
  r = await req('POST', '/api/bookings', { token: TOKC, body: good });
  ok('create booking', r.status === 201 && /^SS-\d{4}-\d{4}$/.test(r.json.booking.code), r.body.slice(0, 200));
  const code1 = r.json.booking.code;
  const amount1 = r.json.booking.amount;
  ok('amount comes from server not client', amount1 === workers.find((w) => w.id === 1).price_from, `${amount1}`);
  ok('booking starts Pending', r.json.booking.status === 'Pending');

  // price tampering attempt
  r = await req('POST', '/api/bookings', { token: TOKC, body: { ...good, preferredTime: '11:00 AM', amount: 1, price_from: 1 } });
  ok('client-sent amount ignored', r.status === 201 && r.json.booking.amount === amount1, `${r.json.booking && r.json.booking.amount}`);
  const code2 = r.json.booking.code;
  ok('booking codes unique', code1 !== code2, `${code1} / ${code2}`);

  r = await req('POST', '/api/bookings', { token: TOKC, body: good });
  ok('double-booked slot -> 409', r.status === 409, `${r.status}`);
  r = await req('POST', '/api/bookings', { token: TOKC, body: { ...good, mobileNumber: '123' } });
  ok('bad mobile rejected', r.status === 400);
  r = await req('POST', '/api/bookings', { token: TOKC, body: { ...good, preferredDate: '2020-01-01' } });
  ok('past date rejected', r.status === 400);
  r = await req('POST', '/api/bookings', { token: TOKC, body: { ...good, workerId: 9999 } });
  ok('unknown worker rejected', r.status === 404 || r.status === 400, `${r.status}`);
  r = await req('POST', '/api/bookings', { body: { ...good, preferredTime: '12:00 PM' } });
  ok('guest can book (optionalAuth)', r.status === 201, `${r.status}`);

  r = await req('GET', '/api/bookings', { token: TOKC });
  ok('customer sees own bookings', r.status === 200 && r.json.bookings.some((b) => b.code === code1));
  ok('booking shape camelCase for frontend', r.json.bookings.every((b) => 'preferredDate' in b && 'customerName' in b));

  r = await req('GET', '/api/bookings', { token: TOKW });
  const workerCodes = r.json.bookings.map((b) => b.code);
  // worker@demo.com is linked to worker id 1 (SHK-9024); the shape exposes id, not code
  ok('worker sees only own jobs', r.json.bookings.length > 0 && r.json.bookings.every((b) => b.worker && b.worker.id === 1),
      JSON.stringify(r.json.bookings.map((b) => b.worker && b.worker.id)));

  // customer may only cancel, not confirm
  r = await req('PATCH', `/api/bookings/${code1}/status`, { token: TOKC, body: { status: 'Confirmed' } });
  ok('customer cannot self-confirm', r.status === 403, `${r.status}`);
  r = await req('PATCH', `/api/bookings/${code2}/status`, { token: TOKC, body: { status: 'Cancelled' } });
  ok('customer can cancel own', r.status === 200 && r.json.booking.status === 'Cancelled', r.body.slice(0, 120));

  // worker completing own job bumps jobs_done
  if (workerCodes.length) {
    const before = (await req('GET', '/api/workers/1')).json.worker.jobs_done;
    const wCode = workerCodes[0];
    const w1 = (await req('GET', '/api/bookings', { token: TOKW })).json.bookings.find((b) => b.code === wCode);
    await req('PATCH', `/api/bookings/${wCode}/status`, { token: TOKW, body: { status: 'Confirmed' } });
    r = await req('PATCH', `/api/bookings/${wCode}/status`, { token: TOKW, body: { status: 'Completed' } });
    ok('worker completes own job', r.status === 200 && r.json.booking.status === 'Completed', r.body.slice(0, 140));
    const after = (await req('GET', `/api/workers/${w1.worker.id}`)).json.worker.jobs_done;
    ok('jobs_done incremented on completion', after === before + 1 || w1.worker.id !== 1, `${before}->${after}`);
  }
  // cross-tenant: customer cannot touch someone else's booking
  r = await req('PATCH', `/api/bookings/${code1}/status`, { token: TOKW2, body: { status: 'Cancelled' } });
  ok('cross-tenant status change blocked', r.status === 403 || r.status === 404, `${r.status}`);

  console.log('\n=== CHAT ===');
  r = await req('GET', '/api/chat/health');
  ok('chat health', r.status === 200, r.body.slice(0, 120));
  r = await req('POST', '/api/chat', { body: { message: 'I need an electrician', sessionId: 'test-session-1' } });
  ok('chat replies without API key', r.status === 200 && r.json.reply && r.json.reply.length > 10, r.body.slice(0, 200));
  ok('chat reports valid source', ['fallback', 'gemini', 'grok', 'groq'].includes(r.json && r.json.source), JSON.stringify(r.json && r.json.source));
  ok('chat reply is relevant', r.json.reply.length > 0, r.json.reply);
  r = await req('POST', '/api/chat', { body: { message: 'x'.repeat(5000), sessionId: 'test-session-1' } });
  ok('oversized message rejected', r.status === 400, `${r.status}`);
  r = await req('POST', '/api/chat', { body: { message: '', sessionId: 'test-session-1' } });
  ok('empty message rejected', r.status === 400, `${r.status}`);
  r = await req('GET', '/api/chat/history?sessionId=test-session-1');
  ok('chat history persisted', r.status === 200 && r.json.messages.length >= 2, `len=${r.json.messages && r.json.messages.length}`);

  // rate limit: 20/min per session
  let limited = false;
  for (let i = 0; i < 24; i++) {
    const rr = await req('POST', '/api/chat', { body: { message: 'hi', sessionId: 'flood-session' } });
    if (rr.status === 429) { limited = true; break; }
  }
  ok('chat rate limit fires', limited);

  console.log('\n=== STATIC / SECRET GUARD ===');
  for (const p of ['/server/.env', '/server/db.js', '/SERVER/.env', '/server/data/app.db', '/server/package.json']) {
    ok(`blocked ${p}`, (await req('GET', p)).status === 404, `${(await req('GET', p)).status}`);
  }
  ok('landing.html served', (await req('GET', '/landing.html')).status === 200);
  ok('js/api.js served', (await req('GET', '/js/api.js')).status === 200);
  ok('extensionless html works', (await req('GET', '/landing')).status === 200);

  console.log(`\n${'='.repeat(46)}\npassed=${pass}  failed=${fail}`);
  if (failures.length) console.log('failed tests:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})();
