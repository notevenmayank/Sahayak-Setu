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
