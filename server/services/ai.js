/**
 * services/ai.js — the brain behind the chatbox.
 *
 * Two modes, same output shape:
 *   1. OPENAI_API_KEY is set  -> real language model, grounded in live database facts
 *   2. no key                 -> rule-based fallback so the chatbox never looks broken
 *
 * "Grounded" matters: instead of hoping the model remembers your service list,
 * we read the real rows out of SQLite and paste them into the system prompt.
 * That is what stops it inventing workers and prices.
 */

const { db } = require('../db');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const RUPEE = '₹';

function hasKey() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

/* ------------------------------------------------------------------ *
 * Live facts pulled from the database on every request
 * ------------------------------------------------------------------ */

function buildContext(user) {
  const services = db
    .prepare(
      `SELECT s.name, s.base_price,
              (SELECT COUNT(*) FROM workers w
                WHERE w.service = s.name AND w.availability = 'Available'
                  AND w.verification = 'Verified') AS available
         FROM services s ORDER BY s.demand DESC`
    )
    .all();

  const workers = db
    .prepare(
      `SELECT name, service, rating, distance_km, price_from
         FROM workers
        WHERE availability = 'Available' AND verification = 'Verified'
        ORDER BY rating DESC LIMIT 12`
    )
    .all();

  let bookings = [];
  if (user) {
    bookings = db
      .prepare(
        `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, w.name AS worker
           FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id
          WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 5`
      )
      .all(user.id);
  }

  return { services, workers, bookings, user };
}

function contextToText({ services, workers, bookings, user }) {
  const lines = [];

  lines.push('SERVICES (name | starting price | verified workers free now):');
  for (const s of services) {
    lines.push(`- ${s.name} | ${RUPEE}${s.base_price} | ${s.available}`);
  }

  lines.push('', 'TOP AVAILABLE WORKERS (name | service | rating | distance | from):');
  for (const w of workers) {
    lines.push(`- ${w.name} | ${w.service} | ${w.rating} | ${w.distance_km} km | ${RUPEE}${w.price_from}`);
  }

  if (user) {
    lines.push('', `SIGNED-IN USER: ${user.name} (${user.email}), role ${user.role}.`);
    if (bookings.length) {
      lines.push('THEIR RECENT BOOKINGS:');
      for (const b of bookings) {
        lines.push(`- ${b.code} | ${b.service} with ${b.worker || 'unassigned'} | ${b.status} | ${b.preferred_date} ${b.preferred_time}`);
      }
    } else {
      lines.push('THEIR RECENT BOOKINGS: none yet.');
    }
  } else {
    lines.push('', 'SIGNED-IN USER: nobody, this is a guest. Do not reveal other people\'s booking details.');
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are Sahayak, the assistant for SahayakSetu — an Indian cooperative platform that connects households with verified local service workers (electricians, plumbers, cleaners, drivers, carpenters, painters).

How to behave:
- Be warm, brief and practical. Two or three short sentences is usually plenty.
- Use only the FACTS block below for services, workers, prices and bookings. Never invent a worker name, price, rating or booking ID.
- If a fact is not in the FACTS block, say you don't have it rather than guessing.
- Prices are in Indian rupees (${RUPEE}). Write them as ${RUPEE}450.
- When someone describes a problem in plain words ("fan is sparking", "tap is leaking", "need help moving"), work out the right service category and name one or two suitable available workers with rating and starting price.
- To book, tell them to pick the worker on the dashboard and press Book Now, or that you can point them to the right service.
- Only discuss the booking of the signed-in user. If a guest asks about a booking, ask them for the booking ID (format SS-YYYY-####).
- Never ask for or repeat passwords, OTPs, card or UPI details. If asked, refuse and say payment is settled with the worker after the job.
- Reply in the language the user writes in. If they write Hindi in Roman letters, reply the same way.
- Plain text only, no markdown formatting or bullet characters.`;

/* ------------------------------------------------------------------ *
 * Rule-based fallback — used when there is no API key
 * ------------------------------------------------------------------ */

// Words people actually use, mapped to a service category.
const INTENT_WORDS = {
  Electrician: ['electric', 'electrician', 'fan', 'light', 'bulb', 'wiring', 'wire', 'switch', 'socket', 'short circuit', 'spark', 'mcb', 'fuse', 'inverter', 'bijli', 'current'],
  Plumber:     ['plumb', 'plumber', 'tap', 'leak', 'pipe', 'water', 'drain', 'toilet', 'flush', 'basin', 'geyser', 'motor', 'nal', 'paani'],
  Cleaner:     ['clean', 'cleaner', 'cleaning', 'sweep', 'mop', 'dust', 'sofa', 'bathroom clean', 'deep clean', 'safai', 'jhadu'],
  Driver:      ['driver', 'drive', 'car', 'taxi', 'trip', 'airport', 'pick up', 'drop', 'gaadi'],
  Carpenter:   ['carpenter', 'wood', 'furniture', 'door', 'cupboard', 'almirah', 'hinge', 'table', 'chair', 'bed frame', 'lakdi'],
  Painter:     ['paint', 'painter', 'painting', 'wall', 'whitewash', 'putty', 'distemper', 'rang']
};

/** "an electrician" vs "a plumber" */
function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function detectService(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [service, words] of Object.entries(INTENT_WORDS)) {
    const score = words.reduce((n, w) => (lower.includes(w) ? n + 1 : n), 0);
    if (score > bestScore) { best = service; bestScore = score; }
  }
  return best;
}

function fallbackReply(message, ctx) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  // Booking ID lookup, e.g. "status of SS-2026-1001"
  const codeMatch = text.toUpperCase().match(/SS-\d{4}-\d{3,}/);
  if (codeMatch) {
    const row = db
      .prepare(
        `SELECT b.code, b.service, b.status, b.preferred_date, b.preferred_time, w.name AS worker
           FROM bookings b LEFT JOIN workers w ON w.id = b.worker_id WHERE b.code = ?`
      )
      .get(codeMatch[0]);
    return row
      ? `Booking ${row.code} is ${row.status.toLowerCase()}. ${row.service} with ${row.worker || 'a worker yet to be assigned'}, scheduled for ${row.preferred_date} at ${row.preferred_time}.`
      : `I could not find a booking with the ID ${codeMatch[0]}. Please double-check it — the format is SS-2026-1001.`;
  }

  if (/^(hi|hello|hey|namaste|namaskar|hii|hlo)\b/.test(lower)) {
    return 'Namaste! I am Sahayak. Tell me what needs fixing at home and I will find you a verified worker nearby. You can also ask about prices or check a booking with its ID.';
  }

  if (lower.includes('price') || lower.includes('cost') || lower.includes('charge') ||
      lower.includes('rate') || lower.includes('kitna') || lower.includes('fees')) {
    const list = ctx.services.map((s) => `${s.name} from ${RUPEE}${s.base_price}`).join(', ');
    return `Starting prices right now: ${list}. The final amount depends on the job, and you pay the worker directly after the work is done.`;
  }

  if (lower.includes('my booking') || lower.includes('my bookings') ||
      lower.includes('my order') || lower.includes('booking status')) {
    if (!ctx.user) return 'Please log in to see your bookings, or give me the booking ID (it looks like SS-2026-1001) and I will check it for you.';
    if (!ctx.bookings.length) return 'You have no bookings yet. Pick a service on the dashboard and I will help you from there.';
    return 'Here are your latest bookings: ' + ctx.bookings
      .map((b) => `${b.code} — ${b.service} with ${b.worker || 'unassigned'}, ${b.status}, on ${b.preferred_date} at ${b.preferred_time}`)
      .join('. ') + '.';
  }

  if (lower.includes('cancel')) {
    return 'You can cancel from your bookings list, or give me the booking ID and I will tell you its current status. Cancelling is free until the worker is on the way.';
  }

  if (lower.includes('verif') || lower.includes('safe') || lower.includes('trust') || lower.includes('bharosa')) {
    return 'Every worker marked Verified has had their ID and skills checked by the cooperative, and ratings come only from completed jobs. You can see the rating and job count on each worker card.';
  }

  if (lower.includes('service') && (lower.includes('what') || lower.includes('which') || lower.includes('list'))) {
    return `We currently cover ${ctx.services.map((s) => s.name).join(', ')}. Which one do you need?`;
  }

  // Problem description -> suggest workers
  const service = detectService(text);
  if (service) {
    const noun = service.toLowerCase();
    const matches = ctx.workers.filter((w) => w.service === service).slice(0, 2);
    if (matches.length) {
      const who = matches
        .map((w) => `${w.name} (${w.rating} stars, ${w.distance_km} km away, from ${RUPEE}${w.price_from})`)
        .join(' and ');
      return `That sounds like a job for ${article(noun)} ${noun}. ${who} ${matches.length > 1 ? 'are' : 'is'} available near you. Open the dashboard and press Book Now on whoever suits you.`;
    }
    return `That sounds like a job for ${article(noun)} ${noun}. No verified ${noun} is free at the moment — please check again shortly, or tell me if something else needs doing.`;
  }

  return `I can help you find a verified worker, tell you starting prices, or check a booking by its ID. We cover ${ctx.services.map((s) => s.name).join(', ')}. What do you need?`;
}

/* ------------------------------------------------------------------ *
 * OpenAI call
 * ------------------------------------------------------------------ */

async function callOpenAI(history, ctx) {
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n--- FACTS (live from the database, trust only this) ---\n${contextToText(ctx)}` },
    ...history.map((m) => ({ role: m.role, content: m.content }))
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: 350 }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      const err = new Error(`OpenAI ${response.status}: ${body.slice(0, 300)}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('OpenAI returned an empty message.');
    return reply;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Main entry point. Always resolves with { reply, source }.
 * source is 'openai' or 'fallback' — handy for debugging and shown in dev.
 */
async function getReply(history, user) {
  const ctx = buildContext(user);
  const lastUserMessage = [...history].reverse().find((m) => m.role === 'user');
  const text = lastUserMessage ? lastUserMessage.content : '';

  if (!hasKey()) {
    return { reply: fallbackReply(text, ctx), source: 'fallback' };
  }

  try {
    return { reply: await callOpenAI(history, ctx), source: 'openai' };
  } catch (err) {
    // Quota exhausted, bad key, network down — the user still gets an answer.
    console.error('[ai] OpenAI failed, using fallback:', err.message);
    return { reply: fallbackReply(text, ctx), source: 'fallback', warning: err.message };
  }
}

module.exports = { getReply, hasKey, buildContext, fallbackReply, detectService };
