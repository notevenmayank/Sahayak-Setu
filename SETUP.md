# SahayakSetu — Setup Guide

Your project now has a real backend, a real database, and an AI chat assistant.
This guide is written assuming you have not run a backend before, so it explains
what each step actually does.

---

## 1. Install Node.js (one time)

Download the **LTS** version from [nodejs.org](https://nodejs.org) and install it.
Then open a new terminal and check it worked:

```bash
node --version
```

You should see something like `v22.x.x`. If you see "command not found", close the
terminal and open a fresh one — the installer only updates new terminals.

## 2. Install the project's packages (one time)

Open a terminal **inside the `server` folder** and run:

```bash
cd "C:\Users\HP\Desktop\New folder\server"
npm install
```

This downloads the six libraries listed in `package.json` into a `node_modules`
folder. It takes a minute. You never edit `node_modules`, and you never commit it.

### If PowerShell says "running scripts is disabled on this system"

You will see this the first time you use npm in PowerShell:

```
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because
running scripts is disabled on this system.
```

Nothing is wrong with Node or with this project. PowerShell has a safety setting
called the **execution policy** that blocks `.ps1` script files, and npm on
Windows ships as `npm.ps1`. Fix it once for your user account:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Press `Y` when it asks. `CurrentUser` means it only changes your account, not the
whole machine, and `RemoteSigned` still blocks unsigned scripts downloaded from
the internet. This is the normal setting for a Windows dev machine.

Alternatively, leave the setting alone and add `.cmd` to every npm command —
`npm.cmd install`, `npm.cmd run seed`, `npm.cmd run dev` — which runs the batch
version and skips PowerShell's script check. Command Prompt (`cmd.exe`) and Git
Bash are also unaffected.


## 3. Create your settings file (one time)

The server reads its secrets from a file called `.env`, which does not exist yet.
Copy the example:

```bash
copy .env.example .env
```

Then open `.env` in your editor. Change `JWT_SECRET` to any long random string —
this is what signs login tokens, so it should not stay as the placeholder:

```
PORT=4000
JWT_SECRET=paste-a-long-random-string-here
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Leave `OPENAI_API_KEY` blank for now. Section 6 covers turning on real AI.

## 4. Create the database and demo data (one time)

```bash
npm run seed
```

This creates `server/data/app.db` (a single-file SQLite database) and fills it
with 6 services, 8 workers, and 3 sample bookings. It prints the demo logins.

If you ever want to wipe everything and start fresh: `npm run reset`.

## 5. Start the server

```bash
npm run dev
```

You will see a banner confirming it is running. Now open this address in your
browser:

**http://localhost:4000**

That is the important part. **Stop using Live Server / opening the HTML files
directly.** The same server now delivers both your pages and the API, which is
why there are no CORS errors to fight. Leave this terminal open while you work —
`npm run dev` restarts automatically when you change a file in `server/`.

Press `Ctrl+C` in that terminal to stop it.

### Demo logins

All three use the password **`demo1234`**:

| Email | Role | Lands on |
|---|---|---|
| `customer@demo.com` | customer | dashboard.html |
| `worker@demo.com` | worker | profile.html |
| `admin@demo.com` | admin | admin.html |

## 5b. Check everything works (optional, but good before a demo)

With the server running in one terminal, open a **second** terminal in the
`server` folder and run:

```bash
npm test
```

This fires 145 real HTTP requests at your running server and prints a line per
check. It ends with `passed=145 failed=0` if the backend is healthy. It covers
login and password hashing, that a wrong password is rejected, that one user
cannot read or change another user's bookings, that a worker cannot mark
themselves Verified, that the booking price comes from the server rather than the
URL, and that `.env` and the database file cannot be downloaded over HTTP.

The tests write a few extra users and bookings into your database, which is
harmless. Run `npm run reset` if you want a clean demo afterwards.

---

## 6. Turning on the real AI (optional)

The chat bubble in the bottom-right corner **already works** without any API key.
Without a key it uses a rule-based brain that reads your live database, so it can
still name real workers and quote real prices. That means your demo never breaks
because of an expired key or no wifi.

To get true conversational answers, create a key at
[platform.openai.com/api-keys](https://platform.openai.com/api-keys), add credit
to the account, then paste the key into `.env`:

```
OPENAI_API_KEY=sk-your-key-here
```

Restart the server. The startup banner will change from `offline fallback` to
`OpenAI (gpt-4o-mini)`. If OpenAI ever errors or times out, it silently falls
back to the rule-based reply rather than showing the user an error.

**Never commit your key.** `server/.gitignore` already excludes `.env`.

---

## What changed in your project

**New backend** in `server/`:

- `server.js` — the entry point. Serves the API and your HTML pages together.
- `db.js` — creates the six database tables.
- `seed.js` — fills the database with demo data.
- `routes/auth.js` — register, login, "who am I".
- `routes/workers.js` — service list, worker list with filters.
- `routes/bookings.js` — time slots, create booking, change status.
- `routes/admin.js` — stats, analytics, verify/suspend workers, audit log.
- `routes/chat.js` — the chat endpoint, with a rate limit.
- `services/ai.js` — the AI prompt, the fallback brain, the OpenAI call.
- `middleware/auth.js` — checks login tokens and roles.

**New frontend files**:

- `account.html` + `js/account.js` — **My Profile**. Every page linked to this
  page before it existed, so those links used to 404. A signed-in person can now
  edit their name and phone, change their password, and see every booking they
  have made (with a Cancel button on the ones not yet done). A worker also gets a
  panel here to edit their trade, their starting price, and their availability.
- `js/nav.js` — one shared navigation script. Each page marks its nav containers
  with `data-nav="side|bottom|user|logout"`, and this file fills them in based on
  who is logged in, so a customer never sees a worker's menu. It also owns the
  logout button on every page.
- `js/api.js` — one small wrapper every page uses to talk to the API. It stores
  your login token and attaches it to each request.
- `js/chat-widget.js` — the floating assistant. It injects its own HTML and CSS,
  so it works on every page including `login.html`.
- `server/tests/` — the two test files `npm test` runs.

**Rewritten to use real data**: `js/landing.js`, `js/dashboard.js`,
`js/booking.js`, `js/profile.js`, `js/admin.js`, and the script inside
`login.html`.

### Real bugs this fixed

Your prototype had three problems that mattered:

Login accepted **any** password — it only checked that the email field was not
empty. Passwords are now hashed with bcrypt and genuinely verified.

Booking IDs came from `array.length`, so deleting a booking made the next one
reuse an existing ID. IDs are now generated from the database and are unique.

The worker's **price travelled in the URL**, so anyone could edit
`&price=450` to `&price=1` before booking. Only `?workerId=` is passed now, and
the server looks up the real price itself.

### The "nothing is linked, buttons do nothing" sweep

Twenty-six links across the site pointed at `href="#"`, which looks like a link
and goes nowhere. All of them now go somewhere real, and every page has a working
logout control. `account.html` was the biggest hole: five pages linked to it and
the file did not exist, so a customer could make a booking and then never see it
again.

Two search boxes were decoration. Typing on the landing page now carries your
words through to `dashboard.html?q=...`, and the dashboard has a real search over
worker names and trades, with a clear button.

Several numbers on screen were invented and would have been embarrassing if a
judge asked about them. The admin console showed a hardcoded `4.7 ★`, `85% of
workers`, `+12% this month`, and four fake worker rows; one card was titled
"Active Bookings" while displaying a rupee revenue figure. The worker page showed
"This Month Earnings +12% from last month" over a figure that was actually the
all-time total. Three of the faces on the landing page were stock photos loaded
from a Google URL, so they broke without internet. All of these now either read
from the database or are labelled honestly.

### How the login system works, briefly

When you log in, the server checks your password and hands back a **token** — a
signed string that proves who you are. `js/api.js` saves it in `localStorage` and
sends it with every later request. The server verifies the signature, so a user
cannot edit their own token to become an admin. Admin pages are protected twice:
`js/admin.js` redirects non-admins, and the API rejects them again with a 403.
The frontend check is only for tidiness; the server check is the real security.

---

## If something goes wrong

**"EADDRINUSE: address already in use"** — a server is already running on port
4000. Close the other terminal, or change `PORT` in `.env`.

**Pages load but every request fails** — you are probably opening the HTML file
directly (the address bar starts with `file:///`) or via Live Server. Use
http://localhost:4000 instead.

**"Database EMPTY" in the startup banner** — run `npm run seed`.

**`npm install` fails on `better-sqlite3`** — this one compiles native code. On
Windows, installing Node.js with the "Tools for Native Modules" checkbox ticked
fixes it. Re-run `npm install` afterwards.

**Chat says "offline assistant"** — expected when `OPENAI_API_KEY` is blank. See
section 6.

**You changed something and want a clean slate** — `npm run reset` rebuilds the
database from scratch.

---

## One decision still open

Your `README.md` says this UI is a service-booking product, but that the actual
problem statement you are targeting (**SIH26190**) is secure legal and
investigation **document management** — uploads, case files, document search,
audit logs.

I built the booking product, because that is what the UI and all your existing
code do. The backend is deliberately structured so a pivot is not a rewrite: the
auth system, roles, and the append-only `audit_log` table are exactly what a
document-management version needs. You would mainly add a `documents` table, file
upload handling, and swap the AI from "find me a worker" to "search and summarise
these documents".

**Worth deciding before you submit anything.** Tell me which direction you want
and I can take it from here.

## Sensible things to build next

The clearest gaps, roughly in order of value: worker profile pages with real
reviews, email or SMS notifications when a booking is accepted, payment
integration (Razorpay works well for UPI), file uploads so workers can submit ID
proof for verification, and pagination on the admin lists once there are more than
a few hundred bookings.
