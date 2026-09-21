/**
 * map.js — MapLibre GL JS map for SahayakSetu.
 *
 * Features:
 *  - Verified worker markers from SQLite (real coordinates)
 *  - Route calculation using OSRM
 *  - Geocoding using Nominatim
 *  - Demand / Complaint heatmap mode with service filtering
 *  - Customer worker live tracking helper
 */

(function () {
  'use strict';

  const OSM_STYLE = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    },
    layers: [{
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19
    }]
  };

  const mapContainer = document.getElementById('map');
  if (!mapContainer || typeof maplibregl === 'undefined') return;

  let map;
  try {
    map = new maplibregl.Map({
      container: 'map',
      style: OSM_STYLE,
      center: [77.3740, 28.6270], // [longitude, latitude] — Noida/NCR
      zoom: 12,
      attributionControl: true
    });
  } catch (err) {
    console.error('[MAP] Failed to initialize map:', err);
    return;
  }

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true
    })
  );

  let currentCustomerLngLat = null;
  let currentCustomerMarker = null;
  let workerMarkers = [];
  let demandMarkers = [];
  let currentMapMode = 'workers'; // 'workers' | 'demand'

  /* ------------------------------------------------------------------ *
   * Worker Markers Layer
   * ------------------------------------------------------------------ */

  async function loadWorkers() {
    try {
      const workers = await window.API.maps.workers();
      clearWorkerMarkers();

      workers.forEach((worker) => {
        if (!worker.latitude || !worker.longitude) return;

        const popupEl = document.createElement('div');
        popupEl.style.cssText = 'font-family:Karla,sans-serif;min-width:170px;padding:4px;';
        popupEl.innerHTML = `
          <strong style="display:block;margin-bottom:2px;font-size:14px;color:#1f211d;">${worker.name}</strong>
          <span style="color:#6a6a62;font-size:12.5px;">${worker.skill} &middot; ⭐ ${worker.rating}</span><br>
          <span style="color:#8a6209;font-weight:600;font-size:13px;">₹${worker.price_from} onwards</span><br>
          <div style="margin-top:8px;display:flex;gap:6px;">
            <button
              onclick="handleShowRoute(${worker.latitude}, ${worker.longitude})"
              style="padding:4px 8px;background:#1f5140;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:12px;">
              Route
            </button>
            <a
              href="booking.html?workerId=${encodeURIComponent(worker.id)}"
              style="padding:4px 8px;background:#dfe9e4;color:#1f5140;border:1px solid #1f5140;border-radius:3px;cursor:pointer;font-size:12px;text-decoration:none;font-weight:500;">
              Book
            </a>
          </div>
        `;

        const marker = new maplibregl.Marker({ color: '#1f5140' })
          .setLngLat([worker.longitude, worker.latitude])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setDOMContent(popupEl));

        if (currentMapMode === 'workers') {
          marker.addTo(map);
        }
        workerMarkers.push(marker);
      });
    } catch (error) {
      console.error('[MAP] Worker loading error:', error);
    }
  }

  function clearWorkerMarkers() {
    workerMarkers.forEach((m) => m.remove());
    workerMarkers = [];
  }

  function showWorkerMarkers() {
    workerMarkers.forEach((m) => m.addTo(map));
  }

  function hideWorkerMarkers() {
    workerMarkers.forEach((m) => m.remove());
  }

  /* ------------------------------------------------------------------ *
   * Demand / Complaint Heatmap Layer
   * ------------------------------------------------------------------ */

  async function loadDemandHeatmap(serviceFilter = '') {
    try {
      const geojson = await window.API.maps.complaintHeatmap(serviceFilter ? { service: serviceFilter } : {});
      clearDemandMarkers();

      if (map.getSource('complaints-source')) {
        map.getSource('complaints-source').setData(geojson);
      } else {
        map.addSource('complaints-source', {
          type: 'geojson',
          data: geojson
        });

        map.addLayer({
          id: 'complaints-heat',
          type: 'heatmap',
          source: 'complaints-source',
          maxzoom: 15,
          paint: {
            'heatmap-weight': ['get', 'weight'],
            'heatmap-intensity': 1.2,
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(52, 168, 83, 0)',
              0.2, 'rgba(52, 168, 83, 0.6)',
              0.5, 'rgba(251, 188, 4, 0.8)',
              0.8, 'rgba(234, 67, 53, 0.9)'
            ],
            'heatmap-radius': 35,
            'heatmap-opacity': 0.85
          }
        });

        map.addLayer({
          id: 'complaints-point',
          type: 'circle',
          source: 'complaints-source',
          minzoom: 12,
          paint: {
            'circle-radius': 8,
            'circle-color': [
              'match',
              ['get', 'demandLevel'],
              'HIGH', '#ea4335',
              'MEDIUM', '#fbbc04',
              '#34a853'
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-opacity': 0.9
          }
        });

        // Click tooltip for complaint circles
        map.on('click', 'complaints-point', (e) => {
          const props = e.features[0].properties;
          const coords = e.features[0].geometry.coordinates.slice();
          new maplibregl.Popup({ offset: 15 })
            .setLngLat(coords)
            .setHTML(`
              <div style="font-family:Karla,sans-serif;padding:3px;">
                <strong style="color:#1f211d;">📍 ${props.area}</strong><br>
                <span style="font-size:12px;color:#6a6a62;">Service: ${props.service}</span><br>
                <span style="display:inline-block;margin-top:4px;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;
                  background:${props.demandLevel === 'HIGH' ? '#fce8e6' : props.demandLevel === 'MEDIUM' ? '#fef7e0' : '#e6f4ea'};
                  color:${props.demandLevel === 'HIGH' ? '#c5221f' : props.demandLevel === 'MEDIUM' ? '#b06000' : '#137333'};">
                  ${props.demandLevel} Demand Area
                </span>
              </div>
            `)
            .addTo(map);
        });

        map.on('mouseenter', 'complaints-point', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'complaints-point', () => { map.getCanvas().style.cursor = ''; });
      }

      setDemandLayerVisibility(true);
    } catch (err) {
      console.error('[MAP] Error loading demand heatmap:', err);
    }
  }

  function setDemandLayerVisibility(visible) {
    const val = visible ? 'visible' : 'none';
    if (map.getLayer('complaints-heat')) map.setLayoutProperty('complaints-heat', 'visibility', val);
    if (map.getLayer('complaints-point')) map.setLayoutProperty('complaints-point', 'visibility', val);
  }

  function clearDemandMarkers() {
    demandMarkers.forEach((m) => m.remove());
    demandMarkers = [];
  }

  /* ------------------------------------------------------------------ *
   * Map Mode Toggling
   * ------------------------------------------------------------------ */

  const btnWorkers = document.getElementById('map-view-workers');
  const btnDemand = document.getElementById('map-view-demand');
  const selectService = document.getElementById('map-demand-service');
  const legendEl = document.getElementById('demand-legend');

  function setMapMode(mode) {
    currentMapMode = mode;
    if (btnWorkers) btnWorkers.setAttribute('aria-pressed', String(mode === 'workers'));
    if (btnDemand) btnDemand.setAttribute('aria-pressed', String(mode === 'demand'));

    if (mode === 'workers') {
      if (selectService) selectService.classList.add('hidden');
      if (legendEl) legendEl.classList.add('hidden');
      setDemandLayerVisibility(false);
      showWorkerMarkers();
    } else {
      if (selectService) selectService.classList.remove('hidden');
      if (legendEl) legendEl.classList.remove('hidden');
      hideWorkerMarkers();
      loadDemandHeatmap(selectService ? selectService.value : '');
    }
  }

  if (btnWorkers) btnWorkers.addEventListener('click', () => setMapMode('workers'));
  if (btnDemand) btnDemand.addEventListener('click', () => setMapMode('demand'));
  if (selectService) {
    selectService.addEventListener('change', () => {
      if (currentMapMode === 'demand') loadDemandHeatmap(selectService.value);
    });
  }

  /* ------------------------------------------------------------------ *
   * Search and Geocoding
   * ------------------------------------------------------------------ */

  const searchBtn = document.getElementById('searchLocation');
  const locationInput = document.getElementById('locationInput');

  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      const address = (locationInput && locationInput.value || '').trim();
      if (!address) return;

      try {
        const results = await window.API.maps.geocode(address);
        if (!results || !results.length) {
          alert('Location not found. Try a more specific address.');
          return;
        }

        const location = results[0];
        const longitude = Number(location.lon);
        const latitude = Number(location.lat);
        currentCustomerLngLat = [longitude, latitude];

        map.flyTo({ center: [longitude, latitude], zoom: 14 });

        if (currentCustomerMarker) currentCustomerMarker.remove();

        const customerEl = document.createElement('div');
        customerEl.innerHTML = `
          <strong style="display:block;margin-bottom:2px;font-size:13px;">📍 Your Location</strong>
          <span style="color:#6a6a62;font-size:12px;">${location.display_name}</span>
        `;

        currentCustomerMarker = new maplibregl.Marker({ color: '#ea4335' })
          .setLngLat([longitude, latitude])
          .setPopup(new maplibregl.Popup({ offset: 25 }).setDOMContent(customerEl))
          .addTo(map);
      } catch (error) {
        console.error('[MAP] Search error:', error);
        alert('Could not search location: ' + error.message);
      }
    });
  }

  if (locationInput) {
    locationInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('searchLocation')?.click();
    });
  }

  /* ------------------------------------------------------------------ *
   * Routing
   * ------------------------------------------------------------------ */

  window.handleShowRoute = async function (workerLat, workerLng) {
    if (!currentCustomerLngLat) {
      alert('Please search for your location first, then click View Route.');
      return;
    }

    try {
      const start = { lat: workerLat, lng: workerLng };
      const end = { lat: currentCustomerLngLat[1], lng: currentCustomerLngLat[0] };

      const data = await window.API.maps.route(start, end);
      const geojsonData = { type: 'Feature', geometry: data.geometry };

      if (map.getSource('worker-route')) {
        map.getSource('worker-route').setData(geojsonData);
      } else {
        map.addSource('worker-route', { type: 'geojson', data: geojsonData });
        map.addLayer({
          id: 'worker-route-line',
          type: 'line',
          source: 'worker-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#0b57d0', 'line-width': 5, 'line-opacity': 0.85 }
        });
      }

      const coords = data.geometry.coordinates;
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 60 });
    } catch (error) {
      console.error('[MAP] Routing error:', error);
      alert('Could not calculate route: ' + error.message);
    }
  };

  /* ------------------------------------------------------------------ *
   * Map Initialization
   * ------------------------------------------------------------------ */

  map.on('load', () => {
    map.resize();
    loadWorkers();
  });
})();
