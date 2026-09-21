/**
 * admin.test.js — Integration & security test suite for Sahayak Setu Admin Dashboard:
 *  1. RBAC & Security: 401 for anon, 403 for customer/worker across all admin routes
 *  2. Admin Stats: Total users, workers, active/blacklisted workers, bookings, revenue
 *  3. Workers Management: Search, Blacklist (with reason), Booking block, Reactivate/Unblacklist
 *  4. Bookings Management: View all, Filter by status, Admin Cancel booking with reason
 *  5. Users Management: View users, Suspend user, Reject login for suspended user, Reactivate user
 *  6. Audit Trail: Verify BLACKLIST_WORKER, UNBLACKLIST_WORKER, CANCEL_BOOKING, SUSPEND_USER, ACTIVATE_USER
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
const email = (tag) => `adm-${tag}-${stamp}@test.com`;

(async () => {
  console.log('=== 1. ADMIN AUTH SETUP & RBAC GUARDS ===');
  // 1. Admin login
  let r = await req('POST', '/api/auth/login', { body: { email: 'admin@demo.com', password: 'demo1234' } });
  const adminToken = r.json?.token;
  ok('admin login 200', r.status === 200 && !!adminToken);

  // Register a customer and worker to test RBAC rejection
  const custEmail = email('cust');
  r = await req('POST', '/api/auth/register', { body: { name: 'Test Customer', email: custEmail, phone: '9810011111', password: 'password123', role: 'customer' } });
  const custToken = r.json?.token;
  const custId = r.json?.user?.id;
  ok('customer registered', r.status === 201 && !!custToken);

  const workEmail = email('work');
  r = await req('POST', '/api/auth/register', { body: { name: 'Test Worker', email: workEmail, phone: '9810022222', password: 'password123', role: 'worker', service: 'Plumber' } });
  const workToken = r.json?.token;
  ok('worker registered', r.status === 201 && !!workToken);

  // RBAC checks: customer and worker must be rejected with 403 on admin endpoints
  r = await req('GET', '/api/admin/stats');
  ok('anon rejected 401 from /api/admin/stats', r.status === 401);

  r = await req('GET', '/api/admin/stats', { token: custToken });
  ok('customer rejected 403 from /api/admin/stats', r.status === 403);

  r = await req('GET', '/api/admin/workers', { token: workToken });
  ok('worker rejected 403 from /api/admin/workers', r.status === 403);

  r = await req('GET', '/api/admin/bookings', { token: custToken });
  ok('customer rejected 403 from /api/admin/bookings', r.status === 403);

  r = await req('GET', '/api/admin/users', { token: workToken });
  ok('worker rejected 403 from /api/admin/users', r.status === 403);

  console.log('\n=== 2. ADMIN STATS & FEDERATION METRICS ===');
  r = await req('GET', '/api/admin/stats', { token: adminToken });
  ok('admin stats 200', r.status === 200 && r.json?.stats);
  const s = r.json?.stats || {};
  ok('stats has totalUsers', typeof s.totalUsers === 'number' && s.totalUsers >= 3);
  ok('stats has totalWorkers', typeof s.totalWorkers === 'number');
  ok('stats has activeWorkers', typeof s.activeWorkers === 'number');
  ok('stats has blacklistedWorkers', typeof s.blacklistedWorkers === 'number');
  ok('stats has totalBookings', typeof s.totalBookings === 'number');
  ok('stats has cancelledBookings', typeof s.cancelledBookings === 'number');

  console.log('\n=== 3. WORKERS MANAGEMENT & BLACKLISTING ===');
  r = await req('GET', '/api/admin/workers', { token: adminToken });
  ok('admin workers list 200', r.status === 200 && Array.isArray(r.json?.workers) && r.json.workers.length > 0);
  const targetWorker = r.json.workers.find((w) => w.verification === 'Verified' && !w.is_blacklisted) || r.json.workers[0];
  ok('found target worker for blacklist test', !!targetWorker);

  // Blacklist without reason -> 400
  r = await req('POST', `/api/admin/workers/${targetWorker.id}/blacklist`, { token: adminToken, body: {} });
  ok('blacklist without reason rejected 400', r.status === 400);

  // Blacklist with reason -> 200
  const blacklistReason = 'Repeated customer complaints and safety non-compliance.';
  r = await req('POST', `/api/admin/workers/${targetWorker.id}/blacklist`, { token: adminToken, body: { reason: blacklistReason } });
  ok('blacklist worker 200', r.status === 200 && r.json?.ok === true);
  ok('worker is_blacklisted = 1', r.json?.worker?.is_blacklisted === 1);
  ok('worker blacklist_reason matches', r.json?.worker?.blacklist_reason === blacklistReason);

  // Blacklisted worker cannot be booked -> 409
  r = await req('POST', '/api/bookings', {
    token: custToken,
    body: {
      workerId: targetWorker.id,
      customerName: 'Test Customer',
      mobile: '9810011111',
      address: 'Sector 62, Noida, Uttar Pradesh',
      preferredDate: '2026-12-01',
      preferredTime: '10:00 AM'
    }
  });
  ok('booking blacklisted worker rejected 409', r.status === 409, r.json?.error);

  // Blacklisted worker excluded from public search
  r = await req('GET', `/api/workers?q=${encodeURIComponent(targetWorker.name)}`);
  const inPublic = r.json?.workers?.some((w) => w.id === targetWorker.id);
  ok('blacklisted worker excluded from public /api/workers', inPublic === false);

  // Filter workers in admin by status=blacklisted
  r = await req('GET', '/api/admin/workers?status=blacklisted', { token: adminToken });
  ok('admin filter status=blacklisted returns blacklisted workers', r.status === 200 && r.json?.workers?.some((w) => w.id === targetWorker.id));

  // Reactivate / Unblacklist worker -> 200
  r = await req('POST', `/api/admin/workers/${targetWorker.id}/unblacklist`, { token: adminToken });
  ok('unblacklist worker 200', r.status === 200 && r.json?.ok === true);
  ok('worker is_blacklisted = 0', r.json?.worker?.is_blacklisted === 0);
  ok('worker blacklist_reason is null', r.json?.worker?.blacklist_reason === null);

  console.log('\n=== 4. BOOKINGS MANAGEMENT & ADMIN CANCELLATION ===');
  // Create a booking with unblacklisted worker
  r = await req('POST', '/api/bookings', {
    token: custToken,
    body: {
      workerId: targetWorker.id,
      customerName: 'Test Customer',
      mobile: '9810011111',
      address: 'Sector 62, Noida, Uttar Pradesh',
      preferredDate: '2026-12-05',
      preferredTime: '11:00 AM'
    }
  });
  const newBooking = r.json?.booking;
  ok('booking created successfully 201', (r.status === 201 || r.status === 200) && !!newBooking);

  // Admin lists bookings
  r = await req('GET', '/api/admin/bookings', { token: adminToken });
  ok('admin bookings list 200', r.status === 200 && Array.isArray(r.json?.bookings));

  if (newBooking) {
    // Admin cancels booking without reason -> 400
    r = await req('POST', `/api/admin/bookings/${newBooking.id}/cancel`, { token: adminToken, body: {} });
    ok('cancel booking without reason rejected 400', r.status === 400);

    // Admin cancels booking with reason -> 200
    const cancelReason = 'Customer requested cancellation via admin hotline.';
    r = await req('POST', `/api/admin/bookings/${newBooking.id}/cancel`, { token: adminToken, body: { reason: cancelReason } });
    ok('admin cancel booking 200', r.status === 200 && r.json?.ok === true);
    ok('booking status is Cancelled', r.json?.booking?.status === 'Cancelled');
    ok('cancellation_reason saved', r.json?.booking?.cancellation_reason === cancelReason);

    // Filter bookings by status=Cancelled
    r = await req('GET', '/api/admin/bookings?status=Cancelled', { token: adminToken });
    ok('admin bookings filtered by status=Cancelled', r.status === 200 && r.json?.bookings?.some((b) => b.id === newBooking.id));
  }

  console.log('\n=== 5. USERS MANAGEMENT & SUSPENSION ===');
  // Admin lists users
  r = await req('GET', '/api/admin/users', { token: adminToken });
  ok('admin users list 200', r.status === 200 && Array.isArray(r.json?.users) && r.json.users.length > 0);
  ok('users never leak password_hash', r.json.users.every((u) => u.password_hash === undefined));

  // Admin cannot suspend own account -> 400
  const adminUser = r.json.users.find((u) => u.email === 'admin@demo.com');
  if (adminUser) {
    r = await req('PATCH', `/api/admin/users/${adminUser.id}/status`, { token: adminToken, body: { status: 'Suspended' } });
    ok('self-suspension blocked 400', r.status === 400);
  }

  // Admin suspends test customer -> 200
  r = await req('PATCH', `/api/admin/users/${custId}/status`, { token: adminToken, body: { status: 'Suspended', reason: 'Abuse of platform' } });
  ok('suspend user 200', r.status === 200 && r.json?.user?.status === 'Suspended');

  // Suspended user login rejected with 403
  r = await req('POST', '/api/auth/login', { body: { email: custEmail, password: 'password123' } });
  ok('suspended user login blocked 403', r.status === 403, r.json?.error);

  // Admin reactivates test customer -> 200
  r = await req('PATCH', `/api/admin/users/${custId}/status`, { token: adminToken, body: { status: 'Active' } });
  ok('reactivate user 200', r.status === 200 && r.json?.user?.status === 'Active');

  // Reactivated user can log in again -> 200
  r = await req('POST', '/api/auth/login', { body: { email: custEmail, password: 'password123' } });
  ok('reactivated user login succeeds 200', r.status === 200 && !!r.json?.token);

  console.log('\n=== 6. AUDIT TRAIL VERIFICATION ===');
  r = await req('GET', '/api/admin/audit?limit=100', { token: adminToken });
  ok('admin audit list 200', r.status === 200 && Array.isArray(r.json?.entries));
  const actions = r.json?.entries?.map((e) => e.action) || [];

  ok('audit recorded BLACKLIST_WORKER', actions.includes('BLACKLIST_WORKER'));
  ok('audit recorded UNBLACKLIST_WORKER', actions.includes('UNBLACKLIST_WORKER'));
  ok('audit recorded CANCEL_BOOKING', actions.includes('CANCEL_BOOKING'));
  ok('audit recorded SUSPEND_USER', actions.includes('SUSPEND_USER'));
  ok('audit recorded ACTIVATE_USER', actions.includes('ACTIVATE_USER'));

  // Filter audit by action
  r = await req('GET', '/api/admin/audit?action=BLACKLIST_WORKER', { token: adminToken });
  ok('audit filter by action works', r.status === 200 && r.json?.entries?.every((e) => e.action === 'BLACKLIST_WORKER'));

  console.log('\n==================================================');
  console.log(`ADMIN TEST RESULTS: PASSED=${pass}  FAILED=${fail}`);
  if (fail > 0) {
    console.error('FAILURES:', failures);
    process.exit(1);
  }
})();
