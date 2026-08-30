/**
 * routes/auth.js — register, login, and "who am I".
 *
 * Passwords are stored as bcrypt hashes, never as plain text. Even with the
 * database file in hand you cannot read anyone's password.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['customer', 'worker', 'admin'];

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const role = String(req.body.role || 'customer');
  const service = String(req.body.service || '').trim();

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  // Nobody gets to hand themselves admin rights through the public form.
  if (role === 'admin') return res.status(403).json({ error: 'Admin accounts are created by the cooperative, not through signup.' });

  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });

  const password_hash = bcrypt.hashSync(password, 10);

  const created = db.transaction(() => {
    const id = db
      .prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, phone, password_hash, role).lastInsertRowid;

    // A worker signup also creates their listing, pending verification.
    if (role === 'worker') {
      const svc = service || 'Electrician';
      const base = db.prepare('SELECT base_price FROM services WHERE name = ?').get(svc);
      const code = `SHK-${9000 + Number(id)}`;
      db.prepare(
        `INSERT INTO workers (code, user_id, name, service, phone, rating, distance_km, price_from, verification, availability)
         VALUES (?, ?, ?, ?, ?, 4.5, 2.0, ?, 'Pending Verification', 'Available')`
      ).run(code, id, name, svc, phone, base ? base.base_price : 300);
    }

    return db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(id);
  })();

  audit('user.register', { userId: created.id, entity: 'user', entityId: created.id, details: { role }, ip: req.ip });

  res.status(201).json({ token: signToken(created), user: publicUser(created) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const expectedRole = req.body.role ? String(req.body.role) : null;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  // Same message whether the email is unknown or the password is wrong —
  // otherwise the response tells an attacker which emails are registered.
  const ok = user && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    audit('user.login_failed', { entity: 'user', details: { email }, ip: req.ip });
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  if (expectedRole && expectedRole !== user.role) {
    return res.status(403).json({
      error: `This account is registered as a ${user.role}, not a ${expectedRole}.`
    });
  }

  audit('user.login', { userId: user.id, entity: 'user', entityId: user.id, ip: req.ip });

  res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const worker = db
    .prepare(
      `SELECT id, code, service, rating, verification, availability, jobs_done,
              price_from, distance_km
         FROM workers WHERE user_id = ?`
    )
    .get(req.user.id);
  res.json({ user: publicUser(req.user), workerProfile: worker || null });
});

// PATCH /api/auth/me   { name, phone }
// Lets a signed-in person maintain their own profile.
router.patch('/me', requireAuth, (req, res) => {
  const name = req.body.name === undefined ? req.user.name : String(req.body.name).trim();
  const phone = req.body.phone === undefined ? req.user.phone : String(req.body.phone).trim();

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (phone && !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  }

  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);

  // A worker's public listing shows their name and phone, so keep it in step.
  db.prepare('UPDATE workers SET name = ?, phone = ? WHERE user_id = ?').run(name, phone, req.user.id);

  audit('user.update_profile', { userId: req.user.id, entity: 'user', entityId: req.user.id, ip: req.ip });

  const updated = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(updated) });
});

// POST /api/auth/me/password   { currentPassword, newPassword }
router.post('/me/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one.' });
  }

  // Knowing the current password is required — a stolen token alone must not be
  // enough to lock the real owner out of their account.
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    audit('user.password_change_failed', { userId: req.user.id, entity: 'user', entityId: req.user.id, ip: req.ip });
    return res.status(401).json({ error: 'Your current password is incorrect.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), req.user.id);

  audit('user.password_changed', { userId: req.user.id, entity: 'user', entityId: req.user.id, ip: req.ip });

  res.json({ ok: true, message: 'Password updated.' });
});

module.exports = router;
