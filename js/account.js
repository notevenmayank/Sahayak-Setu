/**
 * js/account.js — the page where a person maintains their own profile.
 *
 * Before this file existed there was no way to change your name, your number,
 * your password, or your worker listing, and a customer could make a booking
 * but never see it again. Everything here talks to endpoints that already
 * enforce the rules server-side:
 *
 *   PATCH  /api/auth/me            name + phone (also updates the public listing)
 *   POST   /api/auth/me/password   requires the current password
 *   PATCH  /api/workers/me         service + starting price only — never rating,
 *                                  jobs_done or verification
 *   PATCH  /api/bookings/:code/status  a customer may only Cancel, and only
 *                                  their own booking
 */

document.addEventListener('DOMContentLoaded', async () => {
    if (!API.auth.guard()) return;          // any signed-in role may be here

    const rupee = String.fromCharCode(8377);

    let me = null;          // { user, workerProfile }
    let bookings = [];

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const el = (id) => document.getElementById(id);
    const setText = (id, value) => { const node = el(id); if (node) node.textContent = value; };

    /** Shows a one-line result next to a form's button. */
    function flash(id, message, isError) {
        const node = el(id);
        if (!node) return;
        node.textContent = message;
        node.classList.remove('hidden');
        // Pine for done, brick for wrong. Brass is reserved for money.
        node.classList.toggle('text-error', Boolean(isError));
        node.classList.toggle('text-primary', !isError);
    }

    /** Runs an async action with the button disabled, so nothing double-submits. */
    async function withButton(button, busyLabel, action) {
        if (!button) return action();
        const original = button.textContent;
        button.disabled = true;
        button.textContent = busyLabel;
        try {
            return await action();
        } finally {
            button.disabled = false;
            button.textContent = original;
        }
    }

    /** "2026-08-25" -> "Today" / "Tomorrow" / "25 Aug 2026" */
    function friendlyDate(iso) {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        if (iso === today) return 'Today';
        if (iso === tomorrow) return 'Tomorrow';
        const date = new Date(iso + 'T00:00:00');
        return isNaN(date) ? iso : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /* ---------------------------- identity card -------------------------
       Four hand-rolled pairs of Tailwind colour classes became four names
       from the shared badge set. "Pending" is no longer painted in the error
       colours — waiting on a worker is not a failure. */

    const STATUS_BADGES = {
        Pending: 'badge-wait',
        Confirmed: 'badge-good',
        Completed: 'badge-verified',
        Cancelled: 'badge-stop'
    };

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
    }

    function renderIdentity() {
        const user = me.user;
        setText('account-initials', initials(user.name));
        setText('account-name', user.name);
        setText('account-email', user.email);
        setText('account-role', user.role.charAt(0).toUpperCase() + user.role.slice(1));

        // Shortcuts to the dashboard that belongs to this role.
        if (user.role === 'worker') el('link-jobs')?.classList.remove('hidden');
        if (user.role === 'admin') el('link-admin')?.classList.remove('hidden');

        if (me.workerProfile && me.workerProfile.verification === 'Verified') {
            el('account-verified')?.classList.remove('hidden');
        }

        el('field-name').value = user.name || '';
        el('field-phone').value = user.phone || '';
        el('field-email').value = user.email || '';
    }

    /* --------------------------- personal details ----------------------- */

    el('profile-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const name = el('field-name').value.trim();
        const phone = el('field-phone').value.trim();

        // Checked here for a fast, friendly message; the server checks again.
        if (name.length < 2) return flash('profile-message', 'Please enter your full name.', true);
        if (phone && !/^[0-9]{10}$/.test(phone)) {
            return flash('profile-message', 'Please enter a valid 10-digit mobile number.', true);
        }

        await withButton(el('profile-save'), 'Saving…', async () => {
            try {
                const updated = await API.auth.updateMe({ name, phone });
                me.user = updated;
                renderIdentity();

                // The name shows in the nav too, so repaint it rather than
                // leaving the old one on screen until the next page load.
                if (window.SahayakNav && window.SahayakNav.user) {
                    window.SahayakNav.user.name = updated.name;
                    window.SahayakNav.paint();
                }
                flash('profile-message', 'Saved.');
            } catch (err) {
                flash('profile-message', err.message, true);
            }
        });
    });

    /* ------------------------------ password ---------------------------- */

    el('password-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const current = el('field-current').value;
        const next = el('field-new').value;
        const confirm = el('field-confirm').value;

        if (next.length < 8) return flash('password-message', 'New password must be at least 8 characters.', true);
        if (next !== confirm) return flash('password-message', 'The two new passwords do not match.', true);
        if (next === current) return flash('password-message', 'The new password must be different from the current one.', true);

        await withButton(el('password-save'), 'Updating…', async () => {
            try {
                await API.auth.changePassword(current, next);
                el('password-form').reset();
                flash('password-message', 'Password updated. Use it next time you log in.');
            } catch (err) {
                flash('password-message', err.message, true);
            }
        });
    });

    /* --------------------------- worker listing -------------------------- */

    function renderWorkerCard() {
        const worker = me.workerProfile;
        if (!worker) return;                       // customers and admins: card stays hidden

        el('worker-card').classList.remove('hidden');

        setText('worker-code', `Worker ID: ${worker.code}`);
        setText('worker-rating', `${worker.rating} ★`);
        setText('worker-jobs', worker.jobs_done);
        setText('worker-distance', `${worker.distance_km} km`);

        const badge = el('worker-verification');
        badge.textContent = worker.verification;
        badge.className = worker.verification === 'Verified'
            ? 'badge badge-verified flex-shrink-0'
            : 'badge badge-wait flex-shrink-0';

        el('worker-pending-note').classList.toggle('hidden', worker.verification === 'Verified');

        el('field-price').value = worker.price_from;

        const toggle = el('availability-toggle');
        toggle.checked = worker.availability === 'Available';
        paintAvailability(toggle.checked);
    }

    /** Only the services the backend knows about — anything else gets a 400. */
    async function fillServices() {
        const select = el('field-service');
        if (!select) return;
        try {
            const services = await API.services.list();
            const chosen = me.workerProfile ? me.workerProfile.service : '';
            select.innerHTML = services
                .map((service) => `<option value="${esc(service.name)}"${service.name === chosen ? ' selected' : ''}>${esc(service.name)}</option>`)
                .join('');
        } catch {
            select.innerHTML = '<option value="">Could not load services</option>';
        }
    }

    function paintAvailability(available) {
        const text = el('availability-text');
        if (!text) return;
        text.textContent = available ? 'Available for new jobs' : 'Not taking jobs right now';
        // Not taking jobs is a normal state, so it is grey, not red.
        text.classList.toggle('text-primary', available);
        text.classList.toggle('text-on-surface-variant', !available);
    }

    el('worker-form').addEventListener('submit', async (event) => {
        event.preventDefault();

        const service = el('field-service').value;
        const priceFrom = Number(el('field-price').value);

        if (!service) return flash('worker-message', 'Choose the service you offer.', true);
        if (!Number.isFinite(priceFrom) || priceFrom < 50 || priceFrom > 10000) {
            return flash('worker-message', `Starting price must be between ${rupee}50 and ${rupee}10,000.`, true);
        }

        await withButton(el('worker-save'), 'Saving…', async () => {
            try {
                me.workerProfile = await API.workers.updateMine({ service, priceFrom });
                renderWorkerCard();
                flash('worker-message', 'Listing updated. Customers see this straight away.');
            } catch (err) {
                flash('worker-message', err.message, true);
            }
        });
    });

    el('availability-toggle').addEventListener('change', async (event) => {
        const toggle = event.target;
        const available = toggle.checked;
        paintAvailability(available);
        toggle.disabled = true;
        try {
            await API.workers.setMyAvailability(available);
            if (me.workerProfile) me.workerProfile.availability = available ? 'Available' : 'Unavailable';
            flash('worker-message', available ? 'You are visible as available.' : 'You are marked unavailable.');
        } catch (err) {
            // Put the switch back if the server refused, so the page never
            // shows a state the database does not have.
            toggle.checked = !available;
            paintAvailability(!available);
            flash('worker-message', err.message, true);
        } finally {
            toggle.disabled = false;
        }
    });

    /* ------------------------------ bookings ----------------------------
       Was a rounded card per booking with five icons in it (calendar, clock,
       pin) restating labels the text already gave. It is now a register row:
       trade and amount on one baseline, who and which reference underneath,
       then when and where, then the state and the one thing you can do. */

    function bookingCard(booking) {
        const badge = STATUS_BADGES[booking.status] || 'badge-wait';
        const role = me.user.role;

        // A customer looks at who is coming; a worker looks at who booked them.
        const other = role === 'customer'
            ? (booking.worker ? booking.worker.name : 'Worker not assigned')
            : booking.customerName;

        const canCancel = role === 'customer' && (booking.status === 'Pending' || booking.status === 'Confirmed');
        const canTrack = role === 'customer' && booking.status === 'Confirmed' && booking.worker && booking.worker.id;

        return `
            <div class="ledger-row">
                <div class="flex items-baseline justify-between gap-3">
                    <h3 class="font-title-md text-[16px] text-on-surface truncate">${esc(booking.service)}</h3>
                    <span class="figure money text-[16px] flex-shrink-0">${rupee}${esc(booking.amount)}</span>
                </div>
                <p class="rate-row-meta truncate">${esc(other)} &middot; ${esc(booking.code)}</p>
                <p class="font-body-md text-[14px] text-on-surface mt-3">${esc(friendlyDate(booking.preferredDate))}, ${esc(booking.preferredTime)}</p>
                <p class="rate-row-meta">${esc(booking.address)}</p>
                <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="badge ${badge}">${esc(booking.status)}</span>
                        ${canTrack ? `
                            <button class="track-worker btn btn-primary btn-sm flex items-center gap-1"
                                data-code="${esc(booking.code)}"
                                data-worker-id="${esc(booking.worker.id)}"
                                data-worker-name="${esc(booking.worker.name)}"
                                data-address="${esc(booking.address || '')}"
                                type="button">
                                <span class="material-symbols-outlined text-[16px]">near_me</span>
                                Track Worker
                            </button>
                        ` : ''}
                    </div>
                    ${canCancel
                        ? `<button class="cancel-booking btn btn-quiet btn-sm" data-code="${esc(booking.code)}" type="button">Cancel booking</button>`
                        : ''}
                    ${role === 'worker' && booking.status === 'Pending'
                        ? '<a class="font-label-md text-label-md" href="profile.html#requests">Accept or reject</a>'
                        : ''}
                </div>
            </div>`;
    }

    function renderBookings() {
        const list = el('bookings-list');

        if (!bookings.length) {
            list.innerHTML = `
                <div class="state">
                    <p class="state-title">${me.user.role === 'customer' ? 'No bookings yet' : 'Nothing booked yet'}</p>
                    <p class="state-body">${
                        me.user.role === 'customer'
                            ? 'Pick a worker from the register and your first booking will show up here.'
                            : 'Bookings involving this account will be listed here.'
                    }</p>
                </div>`;
            setText('bookings-count', 'Nothing here yet');
            return;
        }

        // Newest first — a fresh booking should be the one you see.
        const sorted = bookings.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        list.innerHTML = `<div class="ledger">${sorted.map(bookingCard).join('')}</div>`;

        const live = bookings.filter((b) => b.status === 'Pending' || b.status === 'Confirmed').length;
        setText('bookings-count', `${bookings.length} in total · ${live} still active`);
    }

    async function loadBookings() {
        try {
            bookings = await API.bookings.mine();
            renderBookings();
        } catch (err) {
            el('bookings-list').innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
            setText('bookings-count', 'Could not load bookings');
        }
    }

    el('bookings-list').addEventListener('click', async (event) => {
        const trackBtn = event.target.closest('.track-worker');
        if (trackBtn) {
            const code = trackBtn.dataset.code;
            const workerId = Number(trackBtn.dataset.workerId);
            const workerName = trackBtn.dataset.workerName;
            const address = trackBtn.dataset.address;
            openTrackingModal(code, workerId, workerName, address);
            return;
        }

        const button = event.target.closest('.cancel-booking');
        if (!button) return;

        const code = button.dataset.code;
        if (!window.confirm(`Cancel booking ${code}? The worker will see it as cancelled.`)) return;

        await withButton(button, 'Cancelling…', async () => {
            try {
                const updated = await API.bookings.setStatus(code, 'Cancelled');
                const index = bookings.findIndex((b) => b.code === code);
                if (index > -1) bookings[index] = updated;
                renderBookings();
            } catch (err) {
                alert(err.message);
            }
        });
    });

    el('refresh-bookings').addEventListener('click', (event) => {
        withButton(event.currentTarget, 'Refreshing…', loadBookings);
    });

    /* -------------------------- worker tracking modal ------------------- */

    const OSM_STYLE = {
        version: 8,
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap contributors'
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

    let trackingMap = null;
    let workerMarker = null;
    let customerMarker = null;
    let trackingPollTimer = null;
    let freshnessInterval = null;
    let demoSimInterval = null;
    let lastLocationTime = null;
    let currentWorkerId = null;
    let currentBookingCode = null;
    let currentWorkerCoords = null;
    let currentCustomerCoords = null;
    let activeRouteCoords = [];

    function updateFreshnessLabel() {
        if (!lastLocationTime) return;
        const now = Date.now();
        const diffSecs = Math.max(0, Math.round((now - lastLocationTime) / 1000));
        setText('tracking-freshness', `Worker location updated ${diffSecs}s ago`);
    }

    function stopTracking() {
        if (trackingPollTimer) { clearInterval(trackingPollTimer); trackingPollTimer = null; }
        if (freshnessInterval) { clearInterval(freshnessInterval); freshnessInterval = null; }
        stopDemoSimulation();
        const modal = el('tracking-modal');
        if (modal) modal.classList.add('hidden');
    }

    function stopDemoSimulation() {
        if (demoSimInterval) { clearInterval(demoSimInterval); demoSimInterval = null; }
        const demoToggle = el('demo-simulation-toggle');
        if (demoToggle) demoToggle.checked = false;
        if (workerMarker && currentWorkerCoords) {
            workerMarker.setLngLat(currentWorkerCoords);
        }
        updateFreshnessLabel();
    }

    function startDemoSimulation() {
        if (!workerMarker || !currentCustomerCoords) return;
        if (demoSimInterval) clearInterval(demoSimInterval);

        let steps = [];
        if (activeRouteCoords && activeRouteCoords.length > 5) {
            const total = activeRouteCoords.length;
            const count = Math.min(25, total);
            for (let i = 0; i < count; i++) {
                const idx = Math.floor((i / (count - 1)) * (total - 1));
                steps.push(activeRouteCoords[idx]);
            }
        } else if (currentWorkerCoords) {
            const count = 20;
            for (let i = 0; i <= count; i++) {
                const t = i / count;
                const lng = currentWorkerCoords[0] + (currentCustomerCoords[0] - currentWorkerCoords[0]) * t;
                const lat = currentWorkerCoords[1] + (currentCustomerCoords[1] - currentWorkerCoords[1]) * t;
                steps.push([lng, lat]);
            }
        }

        if (!steps.length) return;

        let stepIndex = 0;
        setText('tracking-freshness', '[DEMO] Simulating live worker movement…');
        setText('tracking-eta', `[DEMO] Approaching: ${steps.length} steps remaining`);

        demoSimInterval = setInterval(() => {
            if (stepIndex < steps.length) {
                const coord = steps[stepIndex];
                workerMarker.setLngLat(coord);
                stepIndex++;
                const remaining = steps.length - stepIndex;
                if (remaining > 0) {
                    setText('tracking-eta', `[DEMO] In transit · ETA ~${Math.max(1, Math.round(remaining * 0.3))} mins`);
                } else {
                    setText('tracking-eta', `[DEMO] Worker has arrived at destination!`);
                    setText('tracking-freshness', '[DEMO] Simulation complete');
                    clearInterval(demoSimInterval);
                    demoSimInterval = null;
                }
            }
        }, 750);
    }

    async function refreshWorkerPosition() {
        if (!currentWorkerId || el('demo-simulation-toggle')?.checked) return;
        try {
            const res = await API.maps.workerLocation(currentWorkerId, currentBookingCode);
            if (res.available) {
                currentWorkerCoords = [res.longitude, res.latitude];
                if (workerMarker) {
                    workerMarker.setLngLat(currentWorkerCoords);
                }
                lastLocationTime = Date.now() - (res.secondsAgo * 1000);
                updateFreshnessLabel();
            }
        } catch (err) {
            console.warn('[TRACKING] Poll error:', err.message);
        }
    }

    async function openTrackingModal(bookingCode, workerId, workerName, address) {
        currentBookingCode = bookingCode;
        currentWorkerId = workerId;
        currentWorkerCoords = null;
        currentCustomerCoords = null;
        activeRouteCoords = [];

        const modal = el('tracking-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        setText('tracking-booking-code', bookingCode);
        setText('tracking-worker-name', `Worker: ${workerName}`);
        setText('tracking-freshness', 'Connecting to worker live feed…');
        setText('tracking-eta', 'Calculating route…');
        el('tracking-error')?.classList.add('hidden');
        if (el('demo-simulation-toggle')) el('demo-simulation-toggle').checked = false;

        // Ensure MapLibre container is initialized
        if (!trackingMap && typeof maplibregl !== 'undefined') {
            try {
                trackingMap = new maplibregl.Map({
                    container: 'tracking-map',
                    style: OSM_STYLE,
                    center: [77.3740, 28.6270],
                    zoom: 12
                });
                trackingMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
            } catch (err) {
                console.error('[TRACKING] Map init failure:', err);
            }
        } else if (trackingMap) {
            trackingMap.resize();
        }

        // Fetch worker location (authorization protected)
        let workerLoc = null;
        try {
            workerLoc = await API.maps.workerLocation(workerId, bookingCode);
        } catch (err) {
            el('tracking-error')?.classList.remove('hidden');
            setText('tracking-error-msg', err.message || 'Worker location is authorization-protected.');
            setText('tracking-freshness', 'Tracking protected');
            setText('tracking-eta', '');
            return;
        }

        if (!workerLoc || !workerLoc.available) {
            el('tracking-error')?.classList.remove('hidden');
            setText('tracking-error-msg', workerLoc?.message || 'Worker has not enabled GPS location sharing yet.');
            setText('tracking-freshness', 'Location not available');
            setText('tracking-eta', '');
            return;
        }

        currentWorkerCoords = [workerLoc.longitude, workerLoc.latitude];
        lastLocationTime = Date.now() - (workerLoc.secondsAgo * 1000);
        updateFreshnessLabel();

        // Customer coordinate lookup
        currentCustomerCoords = [77.3800, 28.6250]; // Default Noida NCR
        if (address) {
            try {
                const results = await API.maps.geocode(address);
                if (results && results.length > 0) {
                    currentCustomerCoords = [Number(results[0].lon), Number(results[0].lat)];
                }
            } catch (err) {
                console.warn('[TRACKING] Address geocoding error:', err);
            }
        }

        if (trackingMap) {
            trackingMap.resize();

            // Place/update Customer Marker
            if (!customerMarker) {
                const cPin = document.createElement('div');
                cPin.className = 'map-marker-customer';
                cPin.setAttribute('title', 'Your service address');
                cPin.innerHTML = '<span class="material-symbols-outlined text-[18px]">home</span>';
                customerMarker = new maplibregl.Marker({ element: cPin })
                    .setLngLat(currentCustomerCoords)
                    .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(`<strong>Your Address</strong><p class="text-xs mt-1">${esc(address || 'Service location')}</p>`))
                    .addTo(trackingMap);
            } else {
                customerMarker.setLngLat(currentCustomerCoords);
            }

            // Place/update Worker Marker
            if (!workerMarker) {
                const wPin = document.createElement('div');
                wPin.className = 'map-marker-worker';
                wPin.setAttribute('title', `${workerName} (Live)`);
                wPin.innerHTML = '<span class="material-symbols-outlined text-[18px]">engineering</span>';
                workerMarker = new maplibregl.Marker({ element: wPin })
                    .setLngLat(currentWorkerCoords)
                    .setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(`<strong>${esc(workerName)}</strong><p class="text-xs mt-1">Live Worker Location</p>`))
                    .addTo(trackingMap);
            } else {
                workerMarker.setLngLat(currentWorkerCoords);
            }

            // Fetch & draw route
            try {
                const routeData = await API.maps.route(
                    { lat: currentWorkerCoords[1], lng: currentWorkerCoords[0] },
                    { lat: currentCustomerCoords[1], lng: currentCustomerCoords[0] }
                );

                if (routeData && routeData.geometry) {
                    activeRouteCoords = routeData.geometry.coordinates;
                    const geojson = { type: 'Feature', geometry: routeData.geometry };

                    if (trackingMap.getSource('track-route')) {
                        trackingMap.getSource('track-route').setData(geojson);
                    } else {
                        trackingMap.addSource('track-route', { type: 'geojson', data: geojson });
                        trackingMap.addLayer({
                            id: 'track-route-line',
                            type: 'line',
                            source: 'track-route',
                            layout: { 'line-cap': 'round', 'line-join': 'round' },
                            paint: { 'line-color': '#1f5140', 'line-width': 5, 'line-opacity': 0.85 }
                        });
                    }

                    if (routeData.duration) {
                        const mins = Math.max(1, Math.round(routeData.duration / 60));
                        const km = (routeData.distance / 1000).toFixed(1);
                        setText('tracking-eta', `ETA: ~${mins} mins (${km} km)`);
                    }
                }
            } catch (routeErr) {
                console.warn('[TRACKING] Route calc failed:', routeErr);
                setText('tracking-eta', 'Direct distance: ~2.4 km');
            }

            // Fit bounds with padding
            const bounds = new maplibregl.LngLatBounds();
            bounds.extend(currentCustomerCoords);
            bounds.extend(currentWorkerCoords);
            trackingMap.fitBounds(bounds, { padding: 60, maxZoom: 16 });
        }

        // Start freshness interval
        if (freshnessInterval) clearInterval(freshnessInterval);
        freshnessInterval = setInterval(updateFreshnessLabel, 1000);

        // Start 10-second polling
        if (trackingPollTimer) clearInterval(trackingPollTimer);
        trackingPollTimer = setInterval(refreshWorkerPosition, 10000);
    }

    el('close-tracking-modal')?.addEventListener('click', stopTracking);
    el('demo-simulation-toggle')?.addEventListener('change', (e) => {
        if (e.target.checked) startDemoSimulation();
        else stopDemoSimulation();
    });

    el('tracking-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'tracking-modal') stopTracking();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !el('tracking-modal')?.classList.contains('hidden')) {
            stopTracking();
        }
    });


    /* -------------------------------- boot ------------------------------ */

    try {
        me = await API.auth.me();
        renderIdentity();
        renderWorkerCard();
        if (me.workerProfile) fillServices();
        await loadBookings();

        // Deep links like account.html#bookings should land on that section.
        if (window.location.hash) {
            const target = document.querySelector(window.location.hash);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (err) {
        setText('account-name', 'Could not load your profile');
        setText('account-email', err.message);
    }
});
