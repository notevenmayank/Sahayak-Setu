# Sahayak Setu (सहायक सेतु)
### Intelligent Fair-Trade Worker Service & Safety Ecosystem

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-SQLite%203-blue.svg)](https://github.com/WiseLibs/better-sqlite3)
[![AI Engine](https://img.shields.io/badge/AI-Gemini%203.6%20Flash-orange.svg)](https://ai.google.dev/)
[![Mapping](https://img.shields.io/badge/maps-MapLibre%20GL%20JS-blueviolet.svg)](https://maplibre.org/)
[![Tests](https://img.shields.io/badge/tests-182%20passed-success.svg)](#-testing)

---

## 📖 Overview

**Sahayak Setu** is a decentralized, cooperative-style platform designed to connect verified local gig workers (electricians, plumbers, cleaners, carpenters, painters, drivers) with customers. Unlike extractive gig platforms, Sahayak Setu treats service workers as cooperative stakeholders, enforcing fair wages, transparent tariffs, operational fatigue prevention, and micro-insurance safety nets.

This release upgrades the platform with **Gemini AI function calling**, database-grounded responses, **real-time authorization-protected worker tracking**, **complaint/demand heatmaps**, **Worker Suraksha micro-insurance**, and a **one-touch Emergency SOS workflow**.

---

## ✨ Key Features

### 1. 🤖 Gemini AI Grounded Assistant
- **AI Brain**: Integrated with the official Google Gen AI SDK (`@google/genai`) running `gemini-3.6-flash`.
- **Database Grounding (12 Tools)**: The AI model never executes arbitrary SQL or hallucinates entities. It calls allowlisted backend functions (`find_workers`, `get_services`, `get_my_bookings`, `check_worker_availability`, etc.) that query SQLite server-side.
- **Multilingual Support**: Communicates fluently in English, Hindi, and Hinglish.
- **Interactive Action Pills**: Renders direct booking shortcuts (`[Book Worker]`, `[View Profile]`, `[Track Worker]`) inside assistant replies.
- **Resilient Fallback**: Gracefully falls back to an offline rule-based brain if an API key is not configured or network drops.

### 2. 📍 Live Worker Location Tracking
- **Worker Sharing**: Workers toggle GPS broadcasting with throttled coordinate updates (`PATCH /api/maps/workers/me/location`).
- **Authorization-Protected Customer Tracking**: `GET /api/maps/workers/:id/location` strictly restricts access:
  - Allowed **only** if the caller is the worker themselves, an admin, or a customer with an active/confirmed booking.
  - All other callers receive `403 Forbidden`.
- **MapLibre Tracking Modal**: On confirmed bookings in `account.html`, customers can open a modal displaying:
  - Live worker pin and customer address destination pin.
  - Real-time OSRM route line and ETA calculation.
  - Freshness indicator (*"Worker location updated 8s ago"*).
  - An interactive **`[DEMO] Simulate`** toggle to simulate worker arrival along the route.

### 3. 🗺️ Complaint & Demand Heatmap
- Visualizes citizen complaints and service demand hotspots across city sectors on MapLibre GL JS.
- Sourced from SQLite `service_complaints` via a standard GeoJSON endpoint (`GET /api/maps/complaints/heatmap`).
- Dynamic filtering by trade (e.g. Electrician, Plumber) with 3-tier intensity grading (High / Medium / Low).

### 4. 🛡️ Worker Suraksha Micro-Insurance Prototype
- Micro-coverage plan designed for gig workers: **₹49/month for ₹2,00,000 coverage** against accidental injury and hospitalization.
- Instant simulated enrollment generating unique policy IDs (e.g., `SURAKSHA-2026-W3412`).
- Integrated digital claim submission flow directly within the worker portal.

### 5. 🚨 Worker Emergency SOS Workflow
- Dedicated emergency distress button in the Worker Protection Center.
- Automatically captures current GPS coordinates, creates an urgent incident record in SQLite, provides immediate physical safety guidance, and connects to insurance claim assistance.

### 6. 🩺 Unified Worker Protection Center
- Integrated into `profile.html` alongside the operational fatigue management system (`workerSafety.js`).
- Computes worker fatigue scores (0–100) based on working hours, continuous jobs, and breaks.
- Provides break control buttons (*Take Break* / *End Break*) that protect workers from burnout.

---

## 🏗️ Architecture & Technology Stack

```
┌────────────────────────────────────────────────────────┐
│                   SAHAYAK SETU STACK                   │
├─────────────────┬──────────────────────────────────────┤
│ Frontend        │ Vanilla HTML5, CSS3, JavaScript (ES6)│
│                 │ Tailwind CSS (Utility classes)       │
│                 │ MapLibre GL JS & OpenStreetMap       │
├─────────────────┼──────────────────────────────────────┤
│ Backend         │ Node.js & Express.js                 │
│                 │ JWT Authentication (HMAC-SHA256)     │
│                 │ Role-Based Access (Customer, Worker, │
│                 │ Admin)                               │
├─────────────────┼──────────────────────────────────────┤
│ Database        │ SQLite via better-sqlite3 (WAL Mode) │
├─────────────────┼──────────────────────────────────────┤
│ AI Engine       │ Google Gen AI SDK (@google/genai)    │
│                 │ Gemini 3.6 Flash (Function Calling)  │
└─────────────────┴──────────────────────────────────────┘
```

---

## 🗂️ Project File Structure

```text
Sahayak Setu/
├── account.html                  # Customer profile, bookings ledger & tracking modal
├── admin.html                    # Cooperative admin dashboard & platform analytics
├── booking.html                  # Service booking flow & confirmation slip
├── dashboard.html                # Worker register & complaint demand heatmap
├── landing.html                  # Homepage, service tariff rate board & benefits
├── login.html                    # Authentication (Sign In & Registration)
├── profile.html                  # Worker dashboard & Worker Protection Center
├── README.md                     # Project documentation (this file)
├── SETUP.md                      # Backend setup and environment documentation
├── css/
│   └── style.css                 # Ink & paper design system, badges, and modals
├── js/
│   ├── account.js                # Account controller & tracking modal logic
│   ├── admin.js                  # Admin console metrics & audit controller
│   ├── api.js                    # Frontend API client methods
│   ├── booking.js                # Booking form controller & slot validation
│   ├── chat-widget.js            # Floating AI chat widget & action pills
│   ├── dashboard.js              # Worker filtering, sorting & search
│   ├── map.js                    # MapLibre map, markers, routes, and heatmap
│   ├── nav.js                    # Universal masthead and navigation bar
│   ├── profile.js                # Worker Protection Center & SOS controller
│   ├── tailwind-config.js        # Design tokens & color palette configuration
│   └── theme.js                  # Light / Dark mode toggle controller
└── server/
    ├── .env.example              # Template for environment variables
    ├── .gitignore                # Protects secrets, node_modules, and database
    ├── create-admin.js           # CLI script to bootstrap admin accounts
    ├── db.js                     # SQLite initialization, schemas, and migrations
    ├── package.json              # Backend dependencies and npm scripts
    ├── package-lock.json         # Dependency lockfile
    ├── seed.js                   # Seed data (users, workers, complaints, insurance)
    ├── server.js                 # Express server entry point & static hosting
    ├── middleware/
    │   └── auth.js               # JWT auth & role-based access control
    ├── routes/
    │   ├── admin.js              # Platform statistics and audit routes
    │   ├── auth.js               # Signup, login, and profile routes
    │   ├── bookings.js           # Booking creation and status lifecycle
    │   ├── chat.js               # Chat endpoints, health, and history
    │   ├── maps.js               # Worker location, tracking, and heatmap routes
    │   ├── safety.js             # SOS, insurance, breaks, and demand insights
    │   └── workers.js            # Worker directory and listing management
    ├── services/
    │   ├── ai.js                 # Gemini 3.6 Flash engine & 12 grounding tools
    │   └── workerSafety.js       # Operational fatigue & safety score algorithm
    └── tests/
        ├── account.test.js       # Profile and cancellation test suite (73 tests)
        ├── api.test.js           # Auth, RBAC, and booking test suite (72 tests)
        └── ecosystem.test.js     # Maps, tracking, insurance, SOS tests (37 tests)
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: Version `18.0.0` or higher
- **npm**: Version `8.0.0` or higher

### Step 1: Install Dependencies
Open your terminal and navigate to the `server/` directory:
```bash
cd "server"
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `server/.env` and configure your settings:
```env
PORT=4000
JWT_SECRET=your_long_random_jwt_secret_key_here
GEMINI_API_KEY=your_gemini_api_key_from_google_ai_studio
GEMINI_MODEL=gemini-3.6-flash
```
*(Note: If `GEMINI_API_KEY` is left blank, the app runs smoothly using the offline fallback assistant).*

### Step 3: Seed the Database
Initialize tables and pre-populate workers, coordinates, and complaints:
```bash
npm run reset
```

### Step 4: Start the Server
```bash
npm start
```
*(Or use `npm run dev` for auto-reloading during development).*

### Step 5: Open in Browser
Open your browser and visit:
👉 **`http://localhost:4000`**

---

## 🔑 Demo Logins

The database comes pre-seeded with 3 test accounts (password for all three is **`demo1234`**):

| Role | Email | Password | Key Features to Test |
| :--- | :--- | :--- | :--- |
| **Customer** | `customer@demo.com` | `demo1234` | • Browse verified workers<br>• Book appointments<br>• Track worker arrival via live MapLibre modal on confirmed bookings (`[DEMO]` toggle)<br>• Chat with Gemini AI assistant |
| **Worker** | `worker@demo.com` | `demo1234` | • Access **Worker Protection Center** (`/profile.html`)<br>• Monitor **Safety Score** & take fatigue breaks<br>• Enroll in **Suraksha Micro-Insurance** & submit claims<br>• Broadcast live GPS coordinates<br>• Trigger **🚨 Emergency SOS** |
| **Admin** | `admin@demo.com` | `demo1234` | • Access **Admin Console** (`/admin.html`)<br>• Monitor platform revenue, active bookings, worker fatigue distribution<br>• Inspect audit logs and verify new workers |

---

## 🧪 Testing

The backend includes comprehensive integration tests with real HTTP calls against SQLite:

```bash
cd "server"
npm test
```

### Test Coverage (182 / 182 Tests Passing):
- **`api.test.js` (72 tests)**: Public endpoints, JWT auth, RBAC permissions, booking slot conflicts, rate limiting, and secret guards.
- **`account.test.js` (73 tests)**: Profile updates, password changes, worker listing edits, availability toggles, and customer cancellations.
- **`ecosystem.test.js` (37 tests)**: Gemini AI status, real worker GPS, authorization-protected tracking (403 verification), GeoJSON heatmap, Suraksha insurance, Emergency SOS, and worker fatigue scoring.

---

## 🔒 Security Best Practices

1. **API Key Isolation**: `GEMINI_API_KEY` is strictly server-side. It is never transmitted across client network requests or exposed in frontend code.
2. **Database Integrity**: The Gemini AI assistant does not execute arbitrary SQL. All interactions pass through 12 strictly typed and verified parameterized queries.
3. **Tracking Privacy**: Live worker coordinates are protected. Unauthorized users cannot inspect worker GPS feeds without an active/confirmed booking.
4. **Credential Safety**: Passwords are encrypted using `bcryptjs` with salt rounds = 10. Passwords and hashes are stripped before returning user objects.
5. **Static File Guard**: Direct HTTP access to `server/`, `.env`, and `data/*.db` is explicitly blocked.

---

## 👥 Team & Contributions

- **AI Chatbot Engineer**: Gemini 3.6 Flash integration, 12 grounded tools, chat routes, action pills, and chat test verification.
- **Database Engineer**: SQLite schema definitions, indexes, migrations, seed datasets, and admin bootstrapping.
- **Backend & Systems Engineer**: Express server architecture, JWT authentication/RBAC, REST API domain routes, worker safety fatigue engine, and test suites.
- **Lead / Full-Stack Engineer**: System integration, MapLibre UI tracking, interactive documentation, and repository orchestration.

---

## 📄 License
This project is developed for educational and cooperative empowerment purposes.
