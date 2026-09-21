/**
 * routes/maps.js — geographic services, real worker map data, live location tracking,
 * and complaint / service demand heatmap.
 */

const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/maps/workers
 * Returns real verified workers from SQLite with their geographic coordinates.
 * Hardcoded mock workers (Rahul/Amit) are removed.
 */
router.get('/workers', async (req, res) => {
  try {
    const workers = db.prepare(
      `SELECT w.id, w.code, w.name, w.service AS skill, w.rating, w.price_from,
              w.distance_km, w.availability, w.verification,
              COALESCE(loc.latitude, w.latitude) AS latitude,
              COALESCE(loc.longitude, w.longitude) AS longitude,
              loc.updated_at AS location_updated_at
         FROM workers w
         LEFT JOIN (
           SELECT worker_id, latitude, longitude, updated_at
             FROM worker_locations
            WHERE id IN (SELECT MAX(id) FROM worker_locations GROUP BY worker_id)
         ) loc ON loc.worker_id = w.id
        WHERE w.verification != 'Suspended'
          AND (COALESCE(loc.latitude, w.latitude) IS NOT NULL)
        ORDER BY w.rating DESC`
    ).all();

    res.json({ workers });
  } catch (error) {
    console.error('[maps] error loading workers:', error);
    res.status(500).json({ error: 'Could not load worker locations' });
  }
});

/**
 * PATCH /api/maps/workers/me/location
 * Authenticated worker updates their own live/near-live location.
 */
router.patch('/workers/me/location', requireAuth, (req, res) => {
  if (req.user.role !== 'worker') {
    return res.status(403).json({ error: 'Only worker accounts can update worker location.' });
  }

  const worker = db.prepare('SELECT id, name FROM workers WHERE user_id = ?').get(req.user.id);
  if (!worker) {
    return res.status(404).json({ error: 'No worker profile linked to this account.' });
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = req.body.accuracy !== undefined ? Number(req.body.accuracy) : null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }

  // Insert location record
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO worker_locations (worker_id, latitude, longitude, accuracy, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(worker.id, latitude, longitude, accuracy, nowIso);

  // Update base worker record
  db.prepare(
    `UPDATE workers SET latitude = ?, longitude = ? WHERE id = ?`
  ).run(latitude, longitude, worker.id);

  res.json({
    ok: true,
    location: {
      workerId: worker.id,
      latitude,
      longitude,
      accuracy,
      updatedAt: nowIso
    }
  });
});

/**
 * GET /api/maps/workers/:workerId/location
 * Authorization rules:
 * - Worker can see their own location.
 * - Admin can see operational location.
 * - Customer can view location ONLY IF they have an active/confirmed booking with that worker.
 */
router.get('/workers/:workerId/location', optionalAuth, (req, res) => {
  const workerId = Number(req.params.workerId);
  if (!Number.isInteger(workerId) || workerId <= 0) {
    return res.status(400).json({ error: 'Invalid worker ID.' });
  }

  const bookingCode = String(req.query.bookingCode || '').trim().toUpperCase();

  let authorized = false;
  let callerRole = req.user ? req.user.role : 'guest';

  if (callerRole === 'admin') {
    authorized = true;
  } else if (callerRole === 'worker') {
    const mine = db.prepare('SELECT id FROM workers WHERE user_id = ?').get(req.user.id);
    if (mine && mine.id === workerId) authorized = true;
  } else if (callerRole === 'customer') {
    const hasActiveBooking = db.prepare(
      `SELECT 1 FROM bookings
        WHERE customer_id = ? AND worker_id = ? AND status IN ('Pending', 'Confirmed')`
    ).get(req.user.id, workerId);
    if (hasActiveBooking) authorized = true;
  }

  // Allow explicit booking code check for authorized tracking
  if (!authorized && bookingCode) {
    const matchingBooking = db.prepare(
      `SELECT customer_id, worker_id, status FROM bookings WHERE code = ?`
    ).get(bookingCode);

    if (matchingBooking && matchingBooking.worker_id === workerId && ['Pending', 'Confirmed'].includes(matchingBooking.status)) {
      if (!matchingBooking.customer_id || (req.user && req.user.id === matchingBooking.customer_id)) {
        authorized = true;
      }
    }
  }

  if (!authorized) {
    return res.status(403).json({
      error: 'Worker live location is protected. You can view location once you have a confirmed booking with this worker.'
    });
  }

  const loc = db.prepare(
    `SELECT latitude, longitude, accuracy, updated_at
       FROM worker_locations
      WHERE worker_id = ?
      ORDER BY id DESC LIMIT 1`
  ).get(workerId);

  if (!loc) {
    return res.json({
      workerId,
      available: false,
      message: 'Worker location is currently unavailable.'
    });
  }

  const updated = Date.parse(loc.updated_at + (loc.updated_at.includes('T') ? '' : 'Z'));
  const secondsAgo = Number.isFinite(updated) ? Math.max(0, Math.round((Date.now() - updated) / 1000)) : 0;

  res.json({
    workerId,
    available: true,
    latitude: loc.latitude,
    longitude: loc.longitude,
    accuracy: loc.accuracy,
    updatedAt: loc.updated_at,
    secondsAgo,
    statusText: `Worker location updated ${secondsAgo} seconds ago`
  });
});

/**
 * GET /api/maps/complaints/heatmap
 * Return GeoJSON feature collection for complaint/service demand heatmap.
 */
router.get('/complaints/heatmap', (req, res) => {
  try {
    const { service, area } = req.query;
    const where = [];
    const params = [];

    if (service) {
      where.push('service = ?');
      params.push(String(service));
    }
    if (area) {
      where.push('area = ?');
      params.push(String(area));
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const complaints = db.prepare(
      `SELECT id, service, latitude, longitude, area, status, created_at
         FROM service_complaints
        ${whereClause}
        ORDER BY created_at DESC LIMIT 200`
    ).all(...params);

    // Calculate area density to classify demand level
    const areaCounts = {};
    for (const c of complaints) {
      const key = `${c.area}_${c.service}`;
      areaCounts[key] = (areaCounts[key] || 0) + 1;
    }

    const features = complaints.map((c) => {
      const count = areaCounts[`${c.area}_${c.service}`] || 1;
      const demandLevel = count >= 3 ? 'HIGH' : count >= 2 ? 'MEDIUM' : 'LOW';
      const weight = demandLevel === 'HIGH' ? 1.0 : demandLevel === 'MEDIUM' ? 0.6 : 0.3;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [c.longitude, c.latitude]
        },
        properties: {
          id: c.id,
          service: c.service,
          area: c.area || 'City Area',
          status: c.status,
          demandLevel,
          weight
        }
      };
    });

    res.json({
      type: 'FeatureCollection',
      features,
      summary: {
        total: complaints.length,
        services: [...new Set(complaints.map((c) => c.service))],
        areas: [...new Set(complaints.map((c) => c.area).filter(Boolean))]
      }
    });
  } catch (error) {
    console.error('[maps] heatmap error:', error);
    res.status(500).json({ error: 'Could not load complaint heatmap' });
  }
});

/**
 * GET /api/maps/geocode
 */
router.get('/geocode', async (req, res) => {
  const address = String(req.query.address || '').trim();

  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }

  try {
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: address,
        format: 'json',
        limit: '5'
      });

    const response = await fetch(url, {
      headers: { 'User-Agent': 'SahayakSetu/1.0' }
    });

    if (!response.ok) {
      throw new Error('Nominatim request failed');
    }

    const results = await response.json();
    res.json({ results });
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: 'Unable to find this location' });
  }
});

/**
 * GET /api/maps/route
 */
router.get('/route', async (req, res) => {
  const startLat = Number(req.query.startLat);
  const startLng = Number(req.query.startLng);
  const endLat = Number(req.query.endLat);
  const endLng = Number(req.query.endLng);

  if (!Number.isFinite(startLat) || !Number.isFinite(startLng) ||
      !Number.isFinite(endLat) || !Number.isFinite(endLng)) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const coordinates = `${startLng},${startLat};${endLng},${endLat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('OSRM request failed');
    }

    const data = await response.json();
    if (data.code !== 'Ok') {
      return res.status(400).json({ error: 'Route not found' });
    }

    const route = data.routes[0];
    res.json({
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry
    });
  } catch (error) {
    console.error('Routing error:', error);
    res.status(500).json({ error: 'Unable to calculate route' });
  }
});

module.exports = router;
