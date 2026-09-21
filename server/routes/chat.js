/**
 * routes/chat.js — the chatbox endpoint.
 *
 * Conversation state lives in the database keyed by sessionId (a random id the
 * browser generates), so a reload does not lose the thread and you can inspect
 * real conversations later.
 */

const express = require('express');
const crypto = require('crypto');
const { db, audit } = require('../db');
const { optionalAuth } = require('../middleware/auth');
const ai = require('../services/ai');

const router = express.Router();

const MAX_MESSAGE_CHARS = 1000;
const HISTORY_TURNS = 10;          // how much of the thread the model sees
const RATE_LIMIT = 20;             // messages...
const RATE_WINDOW_MS = 60 * 1000;  // ...per minute, per session

const hits = new Map();

function rateLimited(key) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(key, list);

  // Stop the map growing forever on a long-running server.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
    }
  }
  return list.length > RATE_LIMIT;
}

// GET /api/chat/health — lets the widget show which brain is active
router.get('/health', (_req, res) => {
  const provider = ai.getActiveProvider();
  const model = provider === 'groq'
    ? (process.env.GROQ_MODEL || (process.env.GROK_MODEL && !process.env.GROK_MODEL.startsWith('grok') ? process.env.GROK_MODEL : 'qwen/qwen3.8-27b'))
    : provider === 'grok'
    ? (process.env.GROK_MODEL || 'grok-2-latest')
    : provider === 'gemini'
    ? (process.env.GEMINI_MODEL || 'gemini-1.5-flash')
    : undefined;

  res.json({
    ok: true,
    ai: provider,
    ...(model ? { model } : {})
  });
});

// GET /api/chat/history?sessionId=...
router.get('/history', (req, res) => {
  const sessionId = String(req.query.sessionId || '');
  if (!sessionId) return res.json({ messages: [] });

  const messages = db
    .prepare(
      `SELECT role, content, created_at FROM chat_messages
        WHERE session_id = ? ORDER BY id ASC LIMIT 100`
    )
    .all(sessionId);

  res.json({ messages });
});

// POST /api/chat   { message, sessionId? }
router.post('/', optionalAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  const sessionId = String(req.body.sessionId || '').trim() || crypto.randomUUID();

  if (!message) return res.status(400).json({ error: 'Please type a message.' });
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Please keep it under ${MAX_MESSAGE_CHARS} characters.` });
  }

  const rateKey = req.user ? `u${req.user.id}` : `s${sessionId}`;
  if (rateLimited(rateKey)) {
    return res.status(429).json({ error: 'That is a lot of messages at once. Give me a minute to catch up.' });
  }

  const userId = req.user ? req.user.id : null;

  db.prepare('INSERT INTO chat_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)')
    .run(sessionId, userId, 'user', message);

  // Oldest-first slice of the recent thread, including the message just saved.
  const history = db
    .prepare(
      `SELECT role, content FROM chat_messages
        WHERE session_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(sessionId, HISTORY_TURNS * 2)
    .reverse();

  try {
    const { reply, source, actions, warning } = await ai.getReply(history, req.user || null);

    db.prepare('INSERT INTO chat_messages (session_id, user_id, role, content) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, 'assistant', reply);

    audit('chat.message', {
      userId, entity: 'chat', entityId: sessionId,
      details: { source, chars: message.length }, ip: req.ip
    });

    res.json({
      reply,
      sessionId,
      source,
      actions: actions || [],
      ...(warning && process.env.NODE_ENV !== 'production' ? { warning } : {})
    });
  } catch (err) {
    console.error('[chat] unexpected failure:', err);
    res.status(500).json({ error: 'The assistant is having trouble right now. Please try again.' });
  }
});

module.exports = router;
