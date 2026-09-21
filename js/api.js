/**
 * js/api.js — the single place the frontend talks to the backend.
 *
 * Load this before any other page script:
 *   <script src="js/api.js"></script>
 *
 * It gives you a global `API` object. Every call returns a promise and throws
 * an Error with a human-readable .message when the server rejects it, so pages
 * can just do:  try { await API.bookings.create(...) } catch (e) { show(e.message) }
 */

window.API = (function () {
  'use strict';

  // When the page is served by the Node server (locally or in cloud deployment like Railway/Render),
  // the frontend and API share the same origin, so BASE is empty string.
  // Only when opening through Live Server (port 5500/3000/5173) or file://, point at 4000.
  const BASE = (function () {
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:') return 'http://localhost:4000';
    if (['5500', '3000', '5173'].includes(port)) {
      return `http://${hostname || 'localhost'}:4000`;
    }
    return '';
  })();

  const TOKEN_KEY = 'sahayak_token';
  const USER_KEY = 'sahayak_user'; // same key the old prototype used

  /* ----------------------------- session ----------------------------- */

  const session = {
    get token() {
      try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
    },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
    },
    get isLoggedIn() {
      return Boolean(session.token && session.user);
    },
    save(token, user) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
        // loggedIn is kept so any older code still reading this key keeps working.
        localStorage.setItem(USER_KEY, JSON.stringify({ ...user, loggedIn: true }));
      } catch { /* private browsing */ }
    },
    clear() {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch { /* ignore */ }
    }
  };

  /* ---------------------------- transport ---------------------------- */

  async function request(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session.token) headers.Authorization = `Bearer ${session.token}`;

    let response;
    try {
      response = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new Error('Cannot reach the server. Is it running? Start it with "npm start" in the server folder.');
    }

    // 204 or an empty body
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }

    if (!response.ok) {
      // An expired or invalid token means the stored session is useless.
      if (response.status === 401 && session.token) session.clear();
      throw Object.assign(
        new Error((data && data.error) || `Request failed (${response.status}).`),
        { status: response.status }
      );
    }
    return data;
  }

  const get = (p) => request('GET', p);
  const post = (p, b) => request('POST', p, b || {});
  const patch = (p, b) => request('PATCH', p, b || {});

  const qs = (params) => {
    const usable = Object.entries(params || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '');
    return usable.length ? '?' + new URLSearchParams(usable).toString() : '';
  };

  /* ------------------------------ API ------------------------------- */

  const auth = {
    async register(details) {
      const data = await post('/api/auth/register', details);
      session.save(data.token, data.user);
      return data.user;
    },
    async login(email, password, role) {
      const data = await post('/api/auth/login', { email, password, role });
      session.save(data.token, data.user);
      return data.user;
    },
    me: () => get('/api/auth/me'),
    /** Update your own name / phone. Keeps the cached session user in step. */
    async updateMe(changes) {
      const data = await patch('/api/auth/me', changes);
      if (session.token) session.save(session.token, data.user);
      return data.user;
    },
    changePassword: (currentPassword, newPassword) =>
      post('/api/auth/me/password', { currentPassword, newPassword }),
    logout(redirectTo) {
      session.clear();
      if (redirectTo) window.location.href = redirectTo;
    },
    /** Landing page for a role after login. */
    homeFor(role) {
      return role === 'admin' ? 'admin.html' : role === 'worker' ? 'profile.html' : 'dashboard.html';
    },
    /**
     * Page guard. Put at the top of a protected page:
     *   API.auth.guard('admin');            // admin only
     *   API.auth.guard('worker','admin');   // either
     * Redirects to login.html when the check fails. Returns the user, or null.
     */
    guard(...roles) {
      const user = session.user;
      if (!session.isLoggedIn) {
        const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'dashboard.html');
        window.location.replace(`login.html?next=${next}`);
        return null;
      }
      if (roles.length && !roles.includes(user.role)) {
        window.location.replace(auth.homeFor(user.role));
        return null;
      }
      return user;
    }
  };

  const services = {
    list: () => get('/api/services').then((d) => d.services)
  };

  const workers = {
    list: (filters) => get('/api/workers' + qs(filters)).then((d) => d.workers),
    byId: (id) => get(`/api/workers/${id}`),
    setMyAvailability: (available) => patch('/api/workers/me/availability', { available }),
    /** Worker editing their own listing (service, starting price). */
    updateMine: (changes) => patch('/api/workers/me', changes).then((d) => d.worker)
  };

  const bookings = {
    create: (details) => post('/api/bookings', details).then((d) => d.booking),
    mine: () => get('/api/bookings').then((d) => d.bookings),
    byCode: (code) => get(`/api/bookings/${encodeURIComponent(code)}`).then((d) => d.booking),
    slots: (workerId, date) => get('/api/bookings/slots' + qs({ workerId, date })).then((d) => d.slots),
    setStatus: (code, status) =>
      patch(`/api/bookings/${encodeURIComponent(code)}/status`, { status }).then((d) => d.booking)
  };

  const admin = {
    stats: () => get('/api/admin/stats').then((d) => d.stats),
    analytics: () => get('/api/admin/analytics').then((d) => d.analytics),
    workers: (params) => get('/api/admin/workers' + qs(params)).then((d) => d.workers),
    blacklistWorker: (id, reason) => post(`/api/admin/workers/${id}/blacklist`, { reason }).then((d) => d.worker),
    unblacklistWorker: (id) => post(`/api/admin/workers/${id}/unblacklist`).then((d) => d.worker),
    updateWorker: (id, changes) => patch(`/api/admin/workers/${id}`, changes).then((d) => d.worker),
    bookings: (params) => get('/api/admin/bookings' + qs(params)).then((d) => d.bookings),
    cancelBooking: (id, reason) => post(`/api/admin/bookings/${id}/cancel`, { reason }).then((d) => d.booking),
    users: (params) => get('/api/admin/users' + qs(params)).then((d) => d.users),
    setUserStatus: (id, status, reason) => patch(`/api/admin/users/${id}/status`, { status, reason }).then((d) => d.user),
    audit: (limit, action, q) => get('/api/admin/audit' + qs({ limit, action, q })).then((d) => d.entries)
  };

  const chat = {
    send: (message, sessionId) => post('/api/chat', { message, sessionId }),
    history: (sessionId) => get('/api/chat/history' + qs({ sessionId })).then((d) => d.messages),
    health: () => get('/api/chat/health')
  };

  const maps = {
    workers: () => get('/api/maps/workers').then((d) => d.workers),
    updateMyLocation: (latitude, longitude, accuracy) =>
      patch('/api/maps/workers/me/location', { latitude, longitude, accuracy }),
    workerLocation: (workerId, bookingCode) =>
      get(`/api/maps/workers/${workerId}/location` + qs({ bookingCode })),
    complaintHeatmap: (filters) =>
      get('/api/maps/complaints/heatmap' + qs(filters)),
    geocode: (address) => get('/api/maps/geocode' + qs({ address })).then((d) => d.results),
    route: (start, end) => get('/api/maps/route' + qs({
      startLat: start.lat, startLng: start.lng,
      endLat: end.lat, endLng: end.lng
    }))
  };

  const insurance = {
    getPlan: () => get('/api/safety/insurance/plan').then((d) => d.plan),
    status: () => get('/api/safety/insurance/status'),
    enroll: (planName) => post('/api/safety/insurance/enroll', { planName }),
    claim: (incidentId, description) => post('/api/safety/insurance/claim', { incidentId, description })
  };

  const safety = {
    getMySafety: () => get('/api/workers/me/safety'),
    sos: (details) => post('/api/safety/sos', details || {}),
    myIncidents: () => get('/api/safety/incidents/me').then((d) => d.incidents),
    demandInsights: (service) => get('/api/safety/demand-insights' + qs({ service })).then((d) => d.insights),
    startBreak: () => post('/api/workers/me/breaks/start'),
    endBreak: () => post('/api/workers/me/breaks/end'),
    notifications: () => get('/api/workers/me/notifications').then((d) => d.notifications)
  };

  return { BASE, session, auth, services, workers, bookings, admin, chat, maps, insurance, safety, get, post, patch, health: () => get('/api/health') };
})();
