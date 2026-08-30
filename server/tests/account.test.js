/**
 * accounttest.js — runtime tests for the endpoints account.html depends on.
 *
 * apitest.js already covers auth, RBAC, booking creation and chat. This suite
 * covers what was added when the profile page was built:
 *   PATCH  /api/auth/me            (edit your own name / phone)
 *   POST   /api/auth/me/password   (change password, current password required)
 *   PATCH  /api/workers/me         (a worker editing their own listing)
 *   PATCH  /api/bookings/:code/status  (a customer cancelling their own booking)
 *   GET    /api/admin/stats        (the new avgRating field)
 *
 * Every request is a real HTTP call against the server on port 4000.
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
  if (condition) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ' :: ' + detail : ''}`); }
}

const stamp = Date.now();
const email = (tag) => `acct-${tag}-${stamp}@test.com`;
const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

(async () => {
  /* ------------------------------------------------------------------ */
  console.log('=== PATCH /api/auth/me (anyone can maintain their profile) ===');

  let r = await req('POST', '/api/auth/register', {
    body: { name: 'Test Customer', email: email('cust'), phone: '9000000001',
            password: 'firstpass1', role: 'customer' }
  });
  ok('customer registered', r.status === 201 && !!r.json.token, `${r.status} ${r.body.slice(0, 120)}`);
  const custToken = r.json && r.json.token;

  r = await req('PATCH', '/api/auth/me', {
    token: custToken, body: { name: 'Renamed Customer', phone: '9000000002' }
  });
  ok('profile save 200', r.status === 200, `${r.status} ${r.body.slice(0, 120)}`);
  ok('returns the updated user', r.json && r.json.user && r.json.user.name === 'Renamed Customer',
     JSON.stringify(r.json && r.json.user));
  ok('never returns the password hash',
     r.json && r.json.user && r.json.user.password_hash === undefined && r.json.user.password === undefined);

  r = await req('GET', '/api/auth/me', { token: custToken });
  ok('change persisted', r.json.user.name === 'Renamed Customer' && r.json.user.phone === '9000000002',
     JSON.stringify(r.json.user));
  ok('customer has no workerProfile', r.json.workerProfile === null);

  r = await req('PATCH', '/api/auth/me', { token: custToken, body: { phone: '900000000' } });
  ok('9-digit phone rejected 400', r.status === 400, `${r.status}`);

  r = await req('PATCH', '/api/auth/me', { token: custToken, body: { name: 'A' } });
  ok('1-character name rejected 400', r.status === 400, `${r.status}`);

  r = await req('PATCH', '/api/auth/me', { token: custToken, body: { email: 'hacker@evil.com' } });
  ok('email is not editable here', r.status === 200);
  r = await req('GET', '/api/auth/me', { token: custToken });
  ok('login email unchanged', r.json.user.email === email('cust'), r.json.user.email);

  r = await req('PATCH', '/api/auth/me', { body: { name: 'No Token' } });
  ok('no token rejected 401', r.status === 401, `${r.status}`);

  r = await req('PATCH', '/api/auth/me', { token: 'not.a.real.token', body: { name: 'Forged' } });
  ok('forged token rejected 401', r.status === 401, `${r.status}`);

  /* ------------------------------------------------------------------ */
  console.log('\n=== POST /api/auth/me/password ===');

  r = await req('POST', '/api/auth/me/password', {
    token: custToken, body: { currentPassword: 'wrongpass1', newPassword: 'secondpass1' }
  });
  ok('wrong current password rejected 401', r.status === 401, `${r.status} ${r.body.slice(0, 120)}`);

  r = await req('POST', '/api/auth/me/password', {
    token: custToken, body: { currentPassword: 'firstpass1', newPassword: 'short' }
  });
  ok('new password under 8 chars rejected 400', r.status === 400, `${r.status}`);

  r = await req('POST', '/api/auth/me/password', {
    token: custToken, body: { currentPassword: 'firstpass1', newPassword: 'firstpass1' }
  });
  ok('unchanged password rejected 400', r.status === 400, `${r.status}`);

  r = await req('POST', '/api/auth/me/password', {
    token: custToken, body: { currentPassword: 'firstpass1', newPassword: 'secondpass1' }
  });
  ok('valid change 200', r.status === 200 && r.json.ok === true, `${r.status} ${r.body.slice(0, 120)}`);

  r = await req('POST', '/api/auth/login', { body: { email: email('cust'), password: 'firstpass1' } });
  ok('old password no longer works', r.status === 401, `${r.status}`);

  r = await req('POST', '/api/auth/login', { body: { email: email('cust'), password: 'secondpass1' } });
  ok('new password works', r.status === 200 && !!r.json.token, `${r.status}`);
  const custToken2 = r.json && r.json.token;

  /* ------------------------------------------------------------------ */
  console.log('\n=== PATCH /api/workers/me (worker edits own listing) ===');

  r = await req('POST', '/api/auth/register', {
    body: { name: 'Test Worker', email: email('work'), phone: '9111111111',
            password: 'workerpass1', role: 'worker', service: 'Plumber' }
  });
  ok('worker registered', r.status === 201 && !!r.json.token, `${r.status} ${r.body.slice(0, 120)}`);
  const workToken = r.json && r.json.token;

  r = await req('GET', '/api/auth/me', { token: workToken });
  const profile = r.json && r.json.workerProfile;
  ok('worker gets a listing on signup', !!profile, JSON.stringify(r.json));
  ok('new listing starts unverified', profile && profile.verification === 'Pending Verification',
     profile && profile.verification);
  ok('listing has the id fields account.html renders',
     profile && ['code', 'service', 'rating', 'jobs_done', 'price_from', 'distance_km', 'availability']
       .every((k) => profile[k] !== undefined), JSON.stringify(profile));
  const workerId = profile && profile.id;
  const startRating = profile && profile.rating;

  r = await req('PATCH', '/api/workers/me', { token: workToken, body: { service: 'Astronaut' } });
  ok('unknown service rejected 400', r.status === 400, `${r.status} ${r.body.slice(0, 120)}`);

  r = await req('PATCH', '/api/workers/me', { token: workToken, body: { priceFrom: 20 } });
  ok('price below floor rejected 400', r.status === 400, `${r.status}`);

  r = await req('PATCH', '/api/workers/me', { token: workToken, body: { priceFrom: 99999 } });
  ok('price above ceiling rejected 400', r.status === 400, `${r.status}`);

  r = await req('PATCH', '/api/workers/me', { token: workToken, body: { priceFrom: 'free' } });
  ok('non-numeric price rejected 400', r.status === 400, `${r.status}`);

  r = await req('PATCH', '/api/workers/me', {
    token: workToken, body: { service: 'Carpenter', priceFrom: 777 }
  });
  ok('valid listing edit 200', r.status === 200, `${r.status} ${r.body.slice(0, 140)}`);
  ok('service saved', r.json && r.json.worker.service === 'Carpenter', JSON.stringify(r.json && r.json.worker));
  ok('price saved', r.json && r.json.worker.price_from === 777, JSON.stringify(r.json && r.json.worker));

  // The security promise of this endpoint: a worker cannot promote themselves.
  r = await req('PATCH', '/api/workers/me', {
    token: workToken,
    body: { verification: 'Verified', rating: 5, jobs_done: 999, distance_km: 0.1 }
  });
  ok('self-promotion attempt returns 200 but ignores the fields', r.status === 200, `${r.status}`);
  r = await req('GET', '/api/auth/me', { token: workToken });
  const after = r.json.workerProfile;
  ok('verification NOT self-editable', after.verification === 'Pending Verification', after.verification);
  ok('rating NOT self-editable', after.rating === startRating, `${after.rating} vs ${startRating}`);
  ok('jobs_done NOT self-editable', after.jobs_done === 0, `${after.jobs_done}`);

  r = await req('PATCH', '/api/workers/me', { token: custToken2, body: { priceFrom: 500 } });
  ok('customer has no listing to edit 404', r.status === 404, `${r.status}`);

  // Renaming a worker must follow through to what customers see.
  r = await req('PATCH', '/api/auth/me', { token: workToken, body: { name: 'Renamed Worker' } });
  ok('worker rename 200', r.status === 200, `${r.status}`);
  r = await req('GET', `/api/workers/${workerId}`);
  ok('public listing shows the new name', r.status === 200 && r.json.worker.name === 'Renamed Worker',
     JSON.stringify(r.json && r.json.worker && r.json.worker.name));

  /* ------------------------------------------------------------------ */
  console.log('\n=== availability toggle ===');

  r = await req('PATCH', '/api/workers/me/availability', { token: workToken, body: { available: false } });
  ok('toggle off 200', r.status === 200 && r.json.availability === 'Unavailable', r.body.slice(0, 120));
  r = await req('GET', `/api/workers/${workerId}`);
  ok('public listing reflects Unavailable', r.json.worker.availability === 'Unavailable', r.json.worker.availability);

  r = await req('POST', '/api/bookings', {
    token: custToken2,
    body: { workerId, customerName: 'Renamed Customer', mobileNumber: '9000000002',
            serviceAddress: '12 Test Street, Nowhere', preferredDate: tomorrow,
            preferredTime: '10:00 AM' }
  });
  ok('unavailable worker cannot be booked 409', r.status === 409, `${r.status}`);

  r = await req('PATCH', '/api/workers/me/availability', { token: workToken, body: { available: true } });
  ok('toggle back on 200', r.status === 200 && r.json.availability === 'Available', r.body.slice(0, 120));

  r = await req('PATCH', '/api/workers/me/availability', { token: custToken2, body: { available: false } });
  ok('customer cannot toggle availability 404', r.status === 404, `${r.status}`);

  /* ------------------------------------------------------------------ */
  console.log('\n=== customer sees and cancels own booking (account.html) ===');

  r = await req('POST', '/api/bookings', {
    token: custToken2,
    body: { workerId, customerName: 'Renamed Customer', mobileNumber: '9000000002',
            serviceAddress: '12 Test Street, Nowhere', preferredDate: tomorrow,
            preferredTime: '10:00 AM', additionalInstructions: 'Ring the bell twice' }
  });
  ok('booking created 201', r.status === 201, `${r.status} ${r.body.slice(0, 140)}`);
  const code = r.json && r.json.booking && r.json.booking.code;
  ok('server priced the job, not the client', r.json && r.json.booking.amount === 777,
     JSON.stringify(r.json && r.json.booking.amount));
  ok('booking carries the worker object account.js reads',
     r.json && r.json.booking.worker && r.json.booking.worker.name === 'Renamed Worker',
     JSON.stringify(r.json && r.json.booking.worker));

  r = await req('GET', '/api/bookings', { token: custToken2 });
  ok('customer can list own bookings', r.status === 200 && r.json.bookings.some((b) => b.code === code),
     `${r.status} len=${r.json && r.json.bookings && r.json.bookings.length}`);
  ok('list rows have every field the card renders',
     r.json.bookings.every((b) => ['code', 'service', 'status', 'amount', 'customerName',
       'address', 'preferredDate', 'preferredTime', 'createdAt'].every((k) => b[k] !== undefined)));

  r = await req('GET', '/api/bookings', { token: workToken });
  ok('worker sees the job assigned to them', r.status === 200 && r.json.bookings.some((b) => b.code === code));

  r = await req('PATCH', `/api/bookings/${code}/status`, { token: custToken2, body: { status: 'Confirmed' } });
  ok('customer cannot self-confirm 403', r.status === 403, `${r.status} ${r.body.slice(0, 120)}`);

  r = await req('PATCH', `/api/bookings/${code}/status`, { token: custToken2, body: { status: 'Completed' } });
  ok('customer cannot mark Completed 403', r.status === 403, `${r.status}`);

  r = await req('PATCH', `/api/bookings/${code}/status`, { token: custToken2, body: { status: 'Deleted' } });
  ok('invalid status rejected 400', r.status === 400, `${r.status}`);

  r = await req('POST', '/api/auth/register', {
    body: { name: 'Other Customer', email: email('other'), phone: '9222222222',
            password: 'otherpass1', role: 'customer' }
  });
  const otherToken = r.json && r.json.token;
  r = await req('PATCH', `/api/bookings/${code}/status`, { token: otherToken, body: { status: 'Cancelled' } });
  ok('a stranger cannot cancel your booking 403', r.status === 403, `${r.status} ${r.body.slice(0, 120)}`);

  r = await req('PATCH', `/api/bookings/${code}/status`, { token: custToken2, body: { status: 'Cancelled' } });
  ok('customer cancels own booking 200', r.status === 200, `${r.status} ${r.body.slice(0, 140)}`);
  ok('status is Cancelled', r.json && r.json.booking.status === 'Cancelled', JSON.stringify(r.json && r.json.booking.status));

  r = await req('PATCH', `/api/bookings/${code}/status`, { body: { status: 'Cancelled' } });
  ok('anonymous cannot change status 401', r.status === 401, `${r.status}`);

  // Cancelling frees the slot again — otherwise the customer is locked out of it.
  r = await req('POST', '/api/bookings', {
    token: custToken2,
    body: { workerId, customerName: 'Renamed Customer', mobileNumber: '9000000002',
            serviceAddress: '12 Test Street, Nowhere', preferredDate: tomorrow,
            preferredTime: '10:00 AM' }
  });
  ok('cancelled slot is bookable again 201', r.status === 201, `${r.status} ${r.body.slice(0, 120)}`);
  const code2 = r.json && r.json.booking && r.json.booking.code;
  ok('booking codes are unique', code2 !== code, `${code} vs ${code2}`);

  // Worker completing the job is what feeds the earnings figure on profile.html.
  r = await req('PATCH', `/api/bookings/${code2}/status`, { token: workToken, body: { status: 'Confirmed' } });
  ok('worker accepts job 200', r.status === 200 && r.json.booking.status === 'Confirmed', `${r.status}`);
  r = await req('PATCH', `/api/bookings/${code2}/status`, { token: workToken, body: { status: 'Completed' } });
  ok('worker completes job 200', r.status === 200 && r.json.booking.status === 'Completed', `${r.status}`);
  r = await req('GET', '/api/auth/me', { token: workToken });
  ok('completing a job increments jobs_done', r.json.workerProfile.jobs_done === 1,
     `${r.json.workerProfile.jobs_done}`);

  /* ------------------------------------------------------------------ */
  console.log('\n=== GET /api/admin/stats (avgRating is real now) ===');

  r = await req('POST', '/api/auth/login', { body: { email: 'admin@demo.com', password: 'demo1234' } });
  ok('admin login', r.status === 200, `${r.status} ${r.body.slice(0, 120)}`);
  const adminToken = r.json && r.json.token;

  r = await req('GET', '/api/admin/stats', { token: adminToken });
  const stats = r.json && r.json.stats;
  ok('stats 200', r.status === 200 && !!stats, `${r.status} ${r.body.slice(0, 140)}`);
  ok('avgRating present and numeric', stats && typeof stats.avgRating === 'number', JSON.stringify(stats));
  ok('avgRating is a plausible star rating', stats && stats.avgRating > 0 && stats.avgRating <= 5,
     `${stats && stats.avgRating}`);
  ok('customers counted', stats && typeof stats.customers === 'number' && stats.customers >= 3,
     `${stats && stats.customers}`);
  ok('activeBookings counted', stats && typeof stats.activeBookings === 'number', `${stats && stats.activeBookings}`);
  ok('revenue counted', stats && typeof stats.revenue === 'number', `${stats && stats.revenue}`);
  ok('verified <= workers (the % card cannot exceed 100)',
     stats && stats.verifiedWorkers <= stats.workers, `${stats && stats.verifiedWorkers}/${stats && stats.workers}`);

  r = await req('GET', '/api/admin/stats', { token: custToken2 });
  ok('customer blocked from admin stats 403', r.status === 403, `${r.status}`);
  r = await req('GET', '/api/admin/stats', { token: workToken });
  ok('worker blocked from admin stats 403', r.status === 403, `${r.status}`);
  r = await req('GET', '/api/admin/stats');
  ok('anonymous blocked from admin stats 401', r.status === 401, `${r.status}`);

  /* ------------------------------------------------------------------ */
  console.log('\n=== new page is actually served ===');
  for (const p of ['/account.html', '/js/account.js', '/account']) {
    ok(`served ${p}`, (await req('GET', p)).status === 200);
  }

  console.log(`\n${'='.repeat(46)}\npassed=${pass}  failed=${fail}`);
  if (failures.length) console.log('failed tests:\n - ' + failures.join('\n - '));
  process.exit(fail ? 1 : 0);
})();
