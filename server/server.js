/**
 * server.js — entry point.
 *
 * This does two jobs at once:
 *   1. serves the API under /api/*
 *   2. serves the existing HTML/CSS/JS pages from the parent folder
 *
 * Serving both from one place means the frontend and API share an origin, so
 * there are no CORS headaches. Start this, then open http://localhost:4000
 * instead of using Live Server.
 */

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const { db } = require('./db');
const authRoutes = require('./routes/auth');
const workerRoutes = require('./routes/workers');
const bookingRoutes = require('./routes/bookings');
const adminRoutes = require('./routes/admin');
const chatRoutes = require('./routes/chat');
const ai = require('./services/ai');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SITE_ROOT = path.join(__dirname, '..');

app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));

// Allow Live Server (127.0.0.1:5500) to call the API during development, in
// case you prefer keeping your existing workflow. In production the frontend
// is served from this same origin, so CORS is not needed at all — but if you
// ever host the pages elsewhere, list those origins in ALLOWED_ORIGINS
// (comma-separated, e.g. "https://sahayaksetu.onrender.com").
const DEV_ORIGINS = [
  'http://localhost:5500', 'http://127.0.0.1:5500',
  'http://localhost:3000', 'http://localhost:5173',
  `http://localhost:${PORT}`
];
const EXTRA_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: IS_PROD ? EXTRA_ORIGINS : [...DEV_ORIGINS, ...EXTRA_ORIGINS]
  })
);

// Small request log so you can see what the frontend is doing.
app.use((req, _res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`${new Date().toISOString().slice(11, 19)}  ${req.method} ${req.path}`);
  }
  next();
});

/* ---------------------------- API ---------------------------- */

app.get('/api/health', (_req, res) => {
  const counts = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    workers: db.prepare('SELECT COUNT(*) AS n FROM workers').get().n,
    bookings: db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n
  };
  // `demo` tells the login page whether the published demo logins actually
  // exist, so it can hide that box instead of offering credentials that fail.
  const demo = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE email IN ('customer@demo.com','worker@demo.com','admin@demo.com')")
    .get().n === 3;
  res.json({ ok: true, ai: ai.hasKey() ? 'openai' : 'fallback', demo, counts });
});

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', workerRoutes);
app.use('/api', bookingRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

/* ------------------------ Static frontend ------------------------ */

// The server folder holds .env and the database — never serve it over HTTP.
app.use((req, res, next) => {
  if (/^\/server(\/|$)/i.test(req.path)) return res.status(404).send('Not found');
  next();
});

app.use(express.static(SITE_ROOT, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(SITE_ROOT, 'landing.html')));

/* --------------------------- Errors --------------------------- */

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

app.listen(PORT, () => {
  const seeded = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  console.log(`
  SahayakSetu server running
  ──────────────────────────────────────────
  Open        http://localhost:${PORT}
  API health  http://localhost:${PORT}/api/health
  AI mode     ${ai.hasKey() ? `OpenAI (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})` : 'offline fallback — add OPENAI_API_KEY to .env for real AI'}
  Database    ${seeded ? 'ready' : 'EMPTY — run "npm run seed" in another terminal'}
  ──────────────────────────────────────────
`);
});
