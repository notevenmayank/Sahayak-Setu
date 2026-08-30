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
                    <span class="badge ${badge}">${esc(booking.status)}</span>
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
