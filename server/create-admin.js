/**
 * create-admin.js — make (or reset) a real admin account.
 *
 *   npm run create-admin
 *
 * Why this exists: the public signup form deliberately refuses to create admin
 * accounts, and a production seed creates no logins at all. So without this
 * there would be no way to get an admin into a fresh deployment.
 *
 * It reads two environment variables:
 *   ADMIN_EMAIL     the account to create
 *   ADMIN_PASSWORD  its password (at least 8 characters)
 *
 * Run it once after your first deploy. If the account already exists it
 * resets that account's password instead of erroring, so it doubles as a
 * "I locked myself out" recovery tool.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, audit } = require('./db');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = (process.env.ADMIN_NAME || 'Cooperative Admin').trim();

function fail(message) {
  console.error(`\n[create-admin] ${message}\n`);
  process.exit(1);
}

if (!email || !email.includes('@')) {
  fail('Set ADMIN_EMAIL to a valid email address.\n' +
       '  Local:  set ADMIN_EMAIL=you@example.com  (Windows)\n' +
       '  Host:   add it in the environment-variables panel.');
}
if (password.length < 8) {
  fail('Set ADMIN_PASSWORD to at least 8 characters.');
}

const hash = bcrypt.hashSync(password, 10);
const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE id = ?')
    .run(hash, 'admin', existing.id);
  audit('admin.password_reset_cli', { userId: existing.id, entity: 'user', entityId: existing.id });
  console.log(`\n[create-admin] Reset the password for ${email} and confirmed the admin role.\n`);
} else {
  const info = db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`
  ).run(name, email, null, hash);
  audit('admin.created_cli', { userId: info.lastInsertRowid, entity: 'user', entityId: info.lastInsertRowid });
  console.log(`\n[create-admin] Created admin ${email}.\n`);
}

console.log('Sign in at /login.html with the Admin role selected.\n');
