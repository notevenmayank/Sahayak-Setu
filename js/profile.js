/**
 * js/profile.js — the worker's dashboard.
 *
 * Before: two fake requests in localStorage, and an earnings counter that
 * always animated to the same invented 45,200.
 *
 * Now: real bookings assigned to the logged-in worker. Accepting a job sets it
 * to Confirmed on the server, so the customer sees it too, and earnings are the
 * actual sum of completed jobs.
 *
 * The markup this file writes was a stack of shadowed cards, each opening with
 * a round icon that restated the label beside it. It now writes the shared
 * ledger rows and spec lists used by the booking slip and the account page, so
 * a job here reads like the same record the customer sees.
 */

document.addEventListener('DOMContentLoaded', async () => {
    if (!API.auth.guard('worker', 'admin')) return;

    const rupee = String.fromCharCode(8377);

    const requestList = document.getElementById('request-list');
    const upcomingList = document.getElementById('upcoming-list');
    const modal = document.getElementById('job-details-modal');
    const closeModalButton = document.getElementById('close-job-modal');
    const toggle = document.getElementById('availability-toggle');
    const statusText = document.getElementById('status-text');
    const counterElement = document.getElementById('earnings-counter');

    let bookings = [];

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Empty and error states share the site-wide shape: a dashed rule, a
        line of explanation, no large centred icon. */
    const emptyState = (title, body, isError) => `
        <div class="state${isError ? ' state-error' : ''}">
            <p class="state-title">${esc(title)}</p>
            ${body ? `<p class="state-body">${esc(body)}</p>` : ''}
        </div>`;

    /** "2026-08-25" -> "Today" / "Tomorrow" / "25 Aug 2026" */
    function friendlyDate(iso) {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        if (iso === today) return 'Today';
        if (iso === tomorrow) return 'Tomorrow';
        const d = new Date(iso + 'T00:00:00');
        return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    /* ----------------------------- rendering ----------------------------
       A request and an accepted job are the same object at two stages, so
       they are the same row: who and how much on the top baseline, the
       reference under it, then when and where, then what you can do about
       it. The Accept button is the only filled button in the list — reject
       is quiet, because a worker should not have to aim carefully to say
       yes. */

    function requestRow(b) {
        return `
            <div class="ledger-row">
                <div class="flex items-baseline justify-between gap-3">
                    <h3 class="font-title-md text-[16px] text-on-surface truncate">${esc(b.customerName)}</h3>
                    <span class="figure money text-[16px] flex-shrink-0">${rupee}${esc(b.amount)}</span>
                </div>
                <p class="rate-row-meta truncate">${esc(b.service)} &middot; ${esc(b.code)}</p>
                <p class="font-body-md text-[14px] text-on-surface mt-3">${esc(friendlyDate(b.preferredDate))}, ${esc(b.preferredTime)}</p>
                <p class="rate-row-meta">${esc(b.address)}</p>
                ${b.instructions ? `<p class="font-body-md text-[14px] text-on-surface-variant mt-2 pl-3 border-l-2 border-outline-variant">${esc(b.instructions)}</p>` : ''}
                <div class="mt-4 flex flex-wrap items-center gap-2">
                    <button class="request-action btn btn-primary btn-sm" data-code="${esc(b.code)}" data-action="accept" type="button">Accept</button>
                    <button class="request-action btn btn-quiet btn-sm" data-code="${esc(b.code)}" data-action="reject" type="button">Reject</button>
                </div>
            </div>`;
    }

    function upcomingRow(b) {
        return `
            <div class="ledger-row">
                <div class="flex items-baseline justify-between gap-3">
                    <h3 class="font-title-md text-[16px] text-on-surface truncate">${esc(b.service)}</h3>
                    <span class="figure money text-[16px] flex-shrink-0">${rupee}${esc(b.amount)}</span>
                </div>
                <p class="rate-row-meta truncate">${esc(b.customerName)} &middot; ${esc(b.code)}</p>
                <p class="font-body-md text-[14px] text-on-surface mt-3">${esc(friendlyDate(b.preferredDate))}, ${esc(b.preferredTime)}</p>
                <p class="rate-row-meta">${esc(b.address)}</p>
                <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span class="badge badge-good">Confirmed</span>
                    <span class="flex flex-wrap items-center gap-2">
                        <button class="view-job-button btn btn-quiet btn-sm" data-code="${esc(b.code)}" type="button">Job details</button>
                        <button class="complete-job-button btn btn-outline btn-sm" data-code="${esc(b.code)}" type="button">Mark done</button>
                    </span>
                </div>
            </div>`;
    }

    function renderDashboard() {
        const pending = bookings.filter((b) => b.status === 'Pending');
        const upcoming = bookings.filter((b) => b.status === 'Confirmed');

        requestList.innerHTML = pending.length
            ? `<div class="ledger">${pending.map(requestRow).join('')}</div>`
            : emptyState('Nothing waiting on you', 'New requests land here as customers book you.');

        setText('requests-count', pending.length
            ? `${pending.length} to answer`
            : '');

        // Soonest first — the job you have to leave for next should be on top.
        const sorted = upcoming.slice().sort((a, b) =>
            String(a.preferredDate).localeCompare(String(b.preferredDate)) ||
            String(a.preferredTime).localeCompare(String(b.preferredTime)));

        upcomingList.innerHTML = sorted.length
            ? `<div class="ledger">${sorted.map(upcomingRow).join('')}</div>`
            : emptyState('No jobs accepted yet', 'Once you accept a request it moves down here.');
    }

    /* --------------------------- identity + stats ----------------------- */

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
    }

    /**
     * The identity card and the four stat tiles used to be hardcoded to
     * "Ramesh Kumar / SHK-9024 / 18 jobs / Rs 45,200" no matter who logged in.
     * They now come from /api/auth/me and the worker's own bookings.
     */
    function renderIdentity(me) {
        const worker = me.workerProfile;
        setText('profile-initials', initials(me.user.name));
        setText('profile-name', me.user.name);

        const details = document.getElementById('listing-details');
        const note = document.getElementById('listing-note');

        if (!worker) {
            setText('profile-service', 'No worker listing on this account');
            setText('profile-code', 'Worker ID: —');
            setText('profile-rating', '');
            // An admin viewing this page has no listing, so a toggle that would
            // 404 should not be on screen at all.
            const availabilityCard = document.getElementById('availability-card');
            if (availabilityCard) availabilityCard.classList.add('hidden');
            if (details) details.innerHTML = '';
            if (note) {
                note.innerHTML = `This account is ${esc(me.user.role === 'admin' ? 'an admin' : 'a ' + me.user.role)}, so it has no worker listing. Admins can see every worker in the <a href="admin.html">console</a>.`;
                note.classList.remove('hidden');
            }
            return;
        }

        setText('profile-service', worker.service);
        setText('profile-code', `Worker ID: ${worker.code}`);
        setText('profile-rating', `${worker.rating} ${String.fromCharCode(9733)}`);
        setText('stat-rating', `${worker.rating} ${String.fromCharCode(9733)}`);

        // The tick was a green circle pinned to the avatar; verification is a
        // fact about the listing, so it is the same badge used everywhere else.
        const tick = document.getElementById('profile-verified-tick');
        if (tick) tick.classList.toggle('hidden', worker.verification !== 'Verified');

        if (details) {
            details.innerHTML = `
                <div><dt>Trade</dt><dd>${esc(worker.service)}</dd></div>
                <div><dt>Jobs completed</dt><dd class="figure">${esc(worker.jobs_done)}</dd></div>
                <div><dt>Verification</dt><dd><span class="badge ${worker.verification === 'Verified' ? 'badge-verified' : 'badge-wait'}">${esc(worker.verification)}</span></dd></div>
                <div class="spec-total"><dt>Starting price</dt><dd class="figure money">${rupee}${esc(worker.price_from)}</dd></div>`;
        }

        if (note) {
            const pending = worker.verification !== 'Verified';
            note.textContent = pending
                ? 'A federation admin reviews new listings. Customers can still find and book you while this is pending.'
                : '';
            note.classList.toggle('hidden', !pending);
        }
    }

    function renderStats() {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = today.slice(0, 7);

        const todayCount = bookings.filter(
            (b) => b.preferredDate === today && b.status !== 'Cancelled'
        ).length;
        const completed = bookings.filter((b) => b.status === 'Completed');
        const monthEarnings = completed
            .filter((b) => String(b.preferredDate || '').startsWith(thisMonth))
            .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

        setText('stat-today', todayCount);
        setText('stat-done', completed.length);
        setText('stat-month', `${rupee}${monthEarnings.toLocaleString('en-IN')}`);
    }

    /* ------------------------------ earnings ----------------------------
       This used to tick up from zero over about a second on every page load.
       It is a figure a worker checks, not a reveal, so it is simply printed. */

    function renderEarnings() {
        if (!counterElement) return;
        const completed = bookings.filter((b) => b.status === 'Completed');
        const total = completed.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

        counterElement.textContent = total.toLocaleString('en-IN');
        setText('earnings-note', completed.length
            ? `From ${completed.length} completed job${completed.length === 1 ? '' : 's'}`
            : 'No completed jobs yet');
    }

    /* ------------------------------- actions ---------------------------- */

    async function setStatus(code, status, button) {
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Saving…';
        try {
            const updated = await API.bookings.setStatus(code, status);
            const index = bookings.findIndex((b) => b.code === code);
            if (index > -1) bookings[index] = updated;
            renderDashboard();
            renderStats();
            if (status === 'Completed') renderEarnings();
        } catch (err) {
            alert(err.message);
            button.disabled = false;
            button.textContent = original;
        }
    }

    requestList.addEventListener('click', (event) => {
        const button = event.target.closest('.request-action');
        if (!button) return;
        setStatus(button.dataset.code, button.dataset.action === 'accept' ? 'Confirmed' : 'Cancelled', button);
    });

    upcomingList.addEventListener('click', (event) => {
        const completeButton = event.target.closest('.complete-job-button');
        if (completeButton) {
            return setStatus(completeButton.dataset.code, 'Completed', completeButton);
        }

        const viewButton = event.target.closest('.view-job-button');
        if (!viewButton || !modal) return;

        const job = bookings.find((b) => b.code === viewButton.dataset.code);
        if (!job) return;

        document.getElementById('modal-service').textContent = job.service;
        // Same ruled spec rows as the booking slip, rather than bolded
        // "Label:" prefixes running into the values.
        document.getElementById('modal-details').innerHTML = `
            <div><dt>Reference</dt><dd class="figure">${esc(job.code)}</dd></div>
            <div><dt>Customer</dt><dd>${esc(job.customerName)}</dd></div>
            <div><dt>Mobile</dt><dd class="figure">${esc(job.mobile)}</dd></div>
            <div><dt>When</dt><dd>${esc(friendlyDate(job.preferredDate))}, ${esc(job.preferredTime)}</dd></div>
            <div><dt>Where</dt><dd class="max-w-[60%]">${esc(job.address)}</dd></div>
            ${job.instructions ? `<div><dt>Notes</dt><dd class="max-w-[60%]">${esc(job.instructions)}</dd></div>` : ''}
            <div><dt>Status</dt><dd><span class="badge badge-good">${esc(job.status)}</span></dd></div>
            <div class="spec-total"><dt>Collect on the day</dt><dd class="figure money">${rupee}${esc(job.amount)}</dd></div>`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    });

    function closeModal() {
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    if (closeModalButton) closeModalButton.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
    });

    /* ---------------------------- availability --------------------------
       Off is grey, not red. Choosing not to work today is a normal state. */

    function paintAvailability(available) {
        if (!statusText) return;
        statusText.textContent = available ? 'Available for new jobs' : 'Not taking jobs right now';
        statusText.classList.toggle('text-primary', available);
        statusText.classList.toggle('text-on-surface-variant', !available);
    }

    if (toggle) {
        toggle.addEventListener('change', async () => {
            const available = toggle.checked;
            paintAvailability(available);
            toggle.disabled = true;
            try {
                await API.workers.setMyAvailability(available);
            } catch (err) {
                // Put the switch back if the server refused.
                toggle.checked = !available;
                paintAvailability(!available);
                alert(err.message);
            } finally {
                toggle.disabled = false;
            }
        });
    }

    /* ------------------- Worker Protection Center Logic ---------------- */

    let geoWatchId = null;
    let lastGeoPostTime = 0;
    let activeIncidentId = null;

    async function initProtectionCenter() {
        const scoreNum = document.getElementById('safety-score-number');
        const statusBadge = document.getElementById('safety-status-badge');
        const recText = document.getElementById('safety-recommendation');
        const workHours = document.getElementById('safety-working-hours');
        const consecJobs = document.getElementById('safety-consecutive');
        const btnTakeBreak = document.getElementById('btn-take-break');
        const btnEndBreak = document.getElementById('btn-end-break');

        // 1. Safety Score & Workload
        async function loadSafety() {
            try {
                const s = await API.safety.getMySafety();
                if (!s) return;
                if (scoreNum) scoreNum.textContent = `${s.safetyScore}%`;
                if (statusBadge) {
                    statusBadge.textContent = s.status.replace('_', ' ');
                    statusBadge.className = 'badge ' + (s.status === 'SAFE' ? 'badge-good' : s.status === 'CAUTION' ? 'badge-wait' : 'badge-stop');
                }
                if (recText) recText.textContent = s.recommendation || 'Workload within normal thresholds.';
                if (workHours) {
                    const h = Math.floor((s.workingMinutes || 0) / 60);
                    const m = (s.workingMinutes || 0) % 60;
                    workHours.textContent = `${h}h ${m ? m + 'm' : ''}`;
                }
                if (consecJobs) consecJobs.textContent = s.consecutiveJobs || '0';

                const inBreak = Boolean(s.activeBreak);
                if (btnTakeBreak) btnTakeBreak.classList.toggle('hidden', inBreak);
                if (btnEndBreak) btnEndBreak.classList.toggle('hidden', !inBreak);
            } catch (err) {
                console.warn('[safety] Could not load safety metrics:', err.message);
            }
        }

        if (btnTakeBreak) {
            btnTakeBreak.addEventListener('click', async () => {
                btnTakeBreak.disabled = true;
                try {
                    await API.safety.startBreak();
                    await loadSafety();
                } catch (e) {
                    alert(e.message);
                } finally {
                    btnTakeBreak.disabled = false;
                }
            });
        }

        if (btnEndBreak) {
            btnEndBreak.addEventListener('click', async () => {
                btnEndBreak.disabled = true;
                try {
                    await API.safety.endBreak();
                    await loadSafety();
                } catch (e) {
                    alert(e.message);
                } finally {
                    btnEndBreak.disabled = false;
                }
            });
        }

        // 2. Sahayak Suraksha Insurance
        const insBadge = document.getElementById('insurance-status-badge');
        const insPolicy = document.getElementById('insurance-policy-num');
        const btnEnroll = document.getElementById('btn-enroll-insurance');

        async function loadInsurance() {
            try {
                const res = await API.insurance.status();
                if (res && res.enrolled) {
                    if (insBadge) {
                        insBadge.textContent = 'Active Protection';
                        insBadge.className = 'badge badge-verified';
                    }
                    if (insPolicy) insPolicy.textContent = res.policy ? res.policy.policyNumber : 'Active';
                    if (btnEnroll) {
                        btnEnroll.textContent = 'Protection Active (₹49/mo)';
                        btnEnroll.disabled = true;
                        btnEnroll.className = 'btn btn-secondary btn-sm w-full';
                    }
                } else {
                    if (insBadge) {
                        insBadge.textContent = 'Not Enrolled';
                        insBadge.className = 'badge badge-wait';
                    }
                    if (insPolicy) insPolicy.textContent = 'None';
                    if (btnEnroll) {
                        btnEnroll.textContent = 'Enroll in Suraksha (₹49/mo)';
                        btnEnroll.disabled = false;
                    }
                }
            } catch (err) {
                console.warn('[insurance] Status error:', err.message);
            }
        }

        if (btnEnroll) {
            btnEnroll.addEventListener('click', async () => {
                if (!window.confirm('Enroll in Sahayak Suraksha (Basic Worker Protection)?\n\nBenefit: Up to ₹2,00,000 accidental protection.\nContribution: ₹49/month (prototype demo configuration).')) return;
                btnEnroll.disabled = true;
                btnEnroll.textContent = 'Enrolling…';
                try {
                    const res = await API.insurance.enroll('Basic Worker Protection');
                    alert(res.message || 'Successfully enrolled in Sahayak Suraksha!');
                    await loadInsurance();
                } catch (err) {
                    alert('Enrollment failed: ' + err.message);
                    btnEnroll.disabled = false;
                    btnEnroll.textContent = 'Enroll in Suraksha';
                }
            });
        }

        // 3. Location Sharing Toggle
        const locToggle = document.getElementById('loc-share-toggle');
        const locSubtext = document.getElementById('loc-status-subtext');
        const locBadge = document.getElementById('loc-sharing-badge');

        function stopLocationSharing() {
            if (geoWatchId !== null) {
                navigator.geolocation.clearWatch(geoWatchId);
                geoWatchId = null;
            }
            if (locBadge) locBadge.classList.add('hidden');
            if (locSubtext) locSubtext.textContent = 'Off (browser geolocation)';
        }

        function startLocationSharing() {
            if (!navigator.geolocation) {
                alert('Geolocation is not supported by your browser.');
                if (locToggle) locToggle.checked = false;
                return;
            }

            if (locSubtext) locSubtext.textContent = 'Requesting GPS signal…';

            geoWatchId = navigator.geolocation.watchPosition(
                async (pos) => {
                    const now = Date.now();
                    // Throttle updates: send at most once every 15 seconds
                    if (now - lastGeoPostTime < 14000) return;
                    lastGeoPostTime = now;

                    try {
                        const { latitude, longitude, accuracy } = pos.coords;
                        await API.maps.updateMyLocation(latitude, longitude, accuracy);
                        if (locBadge) locBadge.classList.remove('hidden');
                        if (locSubtext) locSubtext.textContent = `Sharing live GPS (accuracy: ±${Math.round(accuracy)}m)`;
                    } catch (err) {
                        console.warn('[location] update error:', err.message);
                    }
                },
                (err) => {
                    console.warn('[location] Geolocation error:', err.message);
                    alert('Location sharing permission denied or unavailable.');
                    stopLocationSharing();
                    if (locToggle) locToggle.checked = false;
                },
                { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
            );
        }

        if (locToggle) {
            locToggle.addEventListener('change', () => {
                if (locToggle.checked) {
                    startLocationSharing();
                } else {
                    stopLocationSharing();
                }
            });
        }

        // 4. Emergency SOS
        const btnSos = document.getElementById('btn-trigger-sos');
        const sosMsg = document.getElementById('sos-status-msg');
        const claimBox = document.getElementById('incident-claim-box');
        const btnClaim = document.getElementById('btn-start-claim');
        const incidentLabel = document.getElementById('recent-incident-label');

        async function checkIncidents() {
            try {
                const incidents = await API.safety.myIncidents();
                const active = incidents && incidents.find((i) => i.status === 'Active');
                if (active) {
                    activeIncidentId = active.id;
                    if (claimBox) claimBox.classList.remove('hidden');
                    if (incidentLabel) incidentLabel.textContent = `Emergency Incident #${active.id} Logged`;
                    if (sosMsg) sosMsg.textContent = 'Active emergency recorded. Emergency procedure initiated.';
                }
            } catch (err) {
                console.warn('[sos] Incidents check error:', err.message);
            }
        }

        if (btnSos) {
            btnSos.addEventListener('click', async () => {
                const confirmed = window.confirm(
                    '⚠️ CONFIRM EMERGENCY SOS ACTIVATION\n\n' +
                    'This will instantly log an emergency incident with your coordinates and alert federation administrators.\n\n' +
                    'Are you sure you want to trigger SOS?'
                );
                if (!confirmed) return;

                btnSos.disabled = true;
                btnSos.textContent = '🚨 Activating SOS…';

                let lat = null, lng = null;
                try {
                    const pos = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000 });
                    });
                    lat = pos.coords.latitude;
                    lng = pos.coords.longitude;
                } catch { /* GPS fallback if permission not yet granted */ }

                try {
                    const res = await API.safety.sos({ latitude: lat, longitude: lng, type: 'Emergency SOS' });
                    activeIncidentId = res.incidentId;
                    btnSos.textContent = '🚨 SOS ACTIVATED';
                    btnSos.classList.remove('bg-[#9c2f22]');
                    btnSos.classList.add('bg-black');
                    if (sosMsg) sosMsg.textContent = 'Emergency incident recorded. Follow your configured emergency procedure.';
                    if (claimBox) claimBox.classList.remove('hidden');
                    if (incidentLabel) incidentLabel.textContent = `Emergency Incident #${res.incidentId} Active`;
                    alert(res.message + '\n\n' + res.procedure);
                } catch (err) {
                    alert('SOS trigger error: ' + err.message);
                    btnSos.disabled = false;
                    btnSos.textContent = '🚨 Trigger Emergency SOS';
                }
            });
        }

        if (btnClaim) {
            btnClaim.addEventListener('click', async () => {
                btnClaim.disabled = true;
                btnClaim.textContent = 'Submitting claim assistance…';
                try {
                    const res = await API.insurance.claim(activeIncidentId, 'Emergency incident claim assistance request');
                    alert(res.message || 'Insurance claim assistance initiated successfully.');
                    btnClaim.textContent = 'Claim Assistance Submitted ✓';
                } catch (err) {
                    alert('Claim assistance error: ' + err.message);
                    btnClaim.disabled = false;
                    btnClaim.textContent = 'Start Insurance Claim Assistance';
                }
            });
        }

        // 5. Demand Insights ("Where demand is high")
        async function loadDemandInsights() {
            const grid = document.getElementById('demand-insights-grid');
            if (!grid) return;
            try {
                const insights = await API.safety.demandInsights();
                if (!insights || !insights.length) {
                    grid.innerHTML = '<p class="text-[13px] text-outline p-2 col-span-4">Demand data updating…</p>';
                    return;
                }
                grid.innerHTML = insights.slice(0, 4).map((item) => `
                    <div class="well p-3.5 flex flex-col justify-between">
                        <div>
                            <span class="eyebrow">${esc(item.service)}</span>
                            <h4 class="font-title-md text-[15px] text-on-surface mt-1">${esc(item.area)}</h4>
                        </div>
                        <div class="mt-3 pt-2 border-t border-outline-variant flex items-center justify-between">
                            <span class="text-[12px] text-outline">${esc(item.complaintsCount)} requests</span>
                            <span class="badge ${item.demandLevel === 'HIGH' ? 'badge-stop' : item.demandLevel === 'MEDIUM' ? 'badge-wait' : 'badge-good'} text-[11px]">
                                ${esc(item.demandLevel)} Demand
                            </span>
                        </div>
                    </div>
                `).join('');
            } catch (err) {
                console.warn('[demand] insights error:', err.message);
            }
        }

        await Promise.all([loadSafety(), loadInsurance(), checkIncidents(), loadDemandInsights()]);
    }

    /* -------------------------------- boot ------------------------------ */

    try {
        const [me, list] = await Promise.all([API.auth.me(), API.bookings.mine()]);
        bookings = list;

        if (toggle && me.workerProfile) {
            toggle.checked = me.workerProfile.availability === 'Available';
        }
        paintAvailability(toggle ? toggle.checked : true);

        renderIdentity(me);
        renderStats();
        renderDashboard();
        renderEarnings();

        if (me.user.role === 'worker') {
            await initProtectionCenter();
        } else {
            const pc = document.getElementById('protection-center');
            if (pc) pc.classList.add('hidden');
        }

        // Deep links like profile.html#requests should land on that section.
        if (window.location.hash) {
            const target = document.querySelector(window.location.hash);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (err) {
        requestList.innerHTML = emptyState('Could not load your jobs', err.message, true);
        upcomingList.innerHTML = '';
    }
});

