/**
 * middleware/auth.js — who is calling, and are they allowed?
 *
 * A JWT ("token") is a signed string the server hands out at login. The browser
 * sends it back on every request in the `Authorization: Bearer <token>` header.
 * Because it is signed with JWT_SECRET, the server can trust its contents
 * without storing sessions anywhere.
 */

const jwt = require('jsonwebtoken');
const { db } = require('../db');

/* The token secret. Locally you can leave JWT_SECRET unset and a throwaway
   dev value is used, so the app still runs out of the box. In production that
   would be a hole — anyone who knows the default string can forge a login for
   any account, admin included — so we refuse to boot without a real secret.
   The placeholder shipped in .env.example counts as "not set". */
const PLACEHOLDER = 'change-me-to-a-long-random-string';
const DEV_FALLBACK = 'dev-only-insecure-secret';
const configured = (process.env.JWT_SECRET || '').trim();
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD && (!configured || configured === PLACEHOLDER)) {
  console.error(
    '\n[fatal] JWT_SECRET is missing or still the placeholder.\n' +
    '        Set it to a long random string before deploying, e.g.\n' +
    '          node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n' +
    '        then put the result in your host\'s JWT_SECRET environment variable.\n'
  );
  process.exit(1);
}

const SECRET = configured || DEV_FALLBACK;
const TOKEN_TTL = '7d';

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, SECRET, {
    expiresIn: TOKEN_TTL
  });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Attaches req.user if a valid token is present. Never rejects. */
function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db
        .prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?')
        .get(payload.sub);
      if (user) req.user = user;
    } catch {
      /* expired or tampered token — treat as anonymous */
    }
  }
  next();
}

/** Rejects the request with 401 unless a valid token is present. */
function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Please log in to continue.' });
    }
    next();
  });
}

/** Rejects with 403 unless the logged-in user has one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!roles.includes(req.user.role)) {
        return res
          .status(403)
          .json({ error: `This action is restricted to: ${roles.join(', ')}.` });
      }
      next();
    });
  };
}

module.exports = { signToken, optionalAuth, requireAuth, requireRole };
