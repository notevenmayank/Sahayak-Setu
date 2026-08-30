/**
 * js/admin.js — cooperative admin dashboard.
 *
 * Before: mock arrays, stats hardcoded to invented numbers, anyone who typed
 * admin.html into the address bar saw the whole page, and the figures ticked
 * up from zero on every load.
 *
 * Now: every number comes from /api/admin/*, and the page is admin-only — the
 * guard below bounces anyone else, and the API rejects them again with 403.
 * The numbers are printed, not animated: a figure an admin reads is not a
 * reveal. Rows, badges and messages are the shared register components used
 * across the rest of the site.
 */

document.addEventListener('DOMContentLoaded', () => {
    if (!API.auth.guard('admin')) return;   // redirects, then stops here

    const rupee = String.fromCharCode(8377);
    const star = String.fromCharCode(9733);

    const workerList = document.getElementById('worker-management-list');
    const bookingList = document.getElementById('booking-overview-list');
    const analyticsList = document.getElementById('service-analytics-list');
    const messageBox = document.getElementById('admin-action-message');

    let workers = [];

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    /** One message shape — the shared notice, brick only when something failed. */
    function showMessage(message, isError) {
        if (!messageBox) return;
        messageBox.textContent = message;
        messageBox.classList.remove('hidden');
        messageBox.classList.toggle('notice-error', Boolean(isError));
        messageBox.classList.toggle('notice-good', !isError);
    }

    /* ------------------------------ stats ------------------------------
       Printed straight from the database. The count-up animation is gone. */

    async function loadStats() {
        try {
            const stats = await API.admin.stats();
            setText('stat-workers', Number(stats.workers || 0).toLocaleString('en-IN'));
            setText('stat-verified-workers', Number(stats.verifiedWorkers || 0).toLocaleString('en-IN'));
            setText('stat-revenue', `${rupee}${Number(stats.revenue || 0).toLocaleString('en-IN')}`);
            setText('stat-completed', Number(stats.completedBookings || 0).toLocaleString('en-IN'));
            setText('stat-monthly-revenue', `${rupee}${Number(stats.monthRevenue || 0).toLocaleString('en-IN')}`);
            setText('stat-customers', Number(stats.customers || 0).toLocaleString('en-IN'));
            setText('stat-active', Number(stats.activeBookings || 0).toLocaleString('en-IN'));

            // These two used to be typed into the HTML as "85% of workers" and
            // "4.7 ★" regardless of what the database actually held.
            setText('stat-verified-pct', stats.workers
                ? `${Math.round((stats.verifiedWorkers / stats.workers) * 100)}%`
                : '0%');
            setText('stat-avg-rating', `${stats.avgRating || 0} ${star}`);
        } catch (err) {
            showMessage(err.message, true);
        }
    }

    /* ----------------------------- badges ------------------------------
       The shared badge set. Waiting on verification is brass/wait, not the
       error red it used to be painted — a new listing is not a failure. */

    const BADGE_CLASS = {
        Verified: 'badge-verified',
        'Pending Verification': 'badge-wait',
        Suspended: 'badge-stop',
        Available: 'badge-good',
        Unavailable: 'badge-wait',
        Confirmed: 'badge-good',
        Pending: 'badge-wait',
        Completed: 'badge-verified',
        Cancelled: 'badge-stop'
    };

    function statusBadge(status) {
        return `<span class="badge ${BADGE_CLASS[status] || 'badge-wait'}">${esc(status)}</span>`;
    }

    /* ----------------------------- workers -----------------------------
       Was a stack of bordered cards, each opening with a round initial chip.
       It is now a ledger: name and trade on one baseline, the verification
       badge on the right, the actions on a quiet row beneath. */

    function workerRow(worker) {
        return `
            <div class="ledger-row">
                <div class="flex items-baseline justify-between gap-3">
                    <h3 class="font-title-md text-[15px] text-on-surface truncate">${esc(worker.name)}</h3>
                    ${statusBadge(worker.verification)}
                </div>
                <p class="rate-row-meta truncate">${esc(worker.service)} &middot; ${esc(worker.rating)} ${star} &middot; ${esc(worker.jobs_done)} jobs &middot; ${esc(worker.code)}</p>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                    ${statusBadge(worker.availability)}
                    <span class="flex-1"></span>
                    <button class="worker-action btn btn-quiet btn-sm" data-id="${esc(worker.id)}" data-action="view" type="button">View</button>
                    ${worker.verification !== 'Verified'
                        ? `<button class="worker-action btn btn-outline btn-sm" data-id="${esc(worker.id)}" data-action="verify" type="button">Verify</button>`
                        : ''}
                    ${worker.verification !== 'Suspended'
                        ? `<button class="worker-action btn btn-danger btn-sm" data-id="${esc(worker.id)}" data-action="suspend" type="button">Suspend</button>`
                        : `<button class="worker-action btn btn-outline btn-sm" data-id="${esc(worker.id)}" data-action="reinstate" type="button">Reinstate</button>`}
                </div>
            </div>`;
    }

    function renderWorkers() {
        if (!workers.length) {
            workerList.innerHTML = `
                <div class="state">
                    <p class="state-title">No workers yet</p>
                    <p class="state-body">Workers appear here as they sign up and choose the Worker role.</p>
                </div>`;
            return;
        }
        workerList.innerHTML = `<div class="ledger">${workers.map(workerRow).join('')}</div>`;
    }

    async function loadWorkers() {
        try {
            workers = await API.admin.workers();
            renderWorkers();
        } catch (err) {
            workerList.innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    }

    workerList.addEventListener('click', async (event) => {
        const button = event.target.closest('.worker-action');
        if (!button) return;

        const worker = workers.find((item) => String(item.id) === button.dataset.id);
        if (!worker) return;

        if (button.dataset.action === 'view') {
            return showMessage(
                `${worker.name} (${worker.code}) — ${worker.service}, ${worker.rating} ${star}, ${worker.jobs_done} jobs completed, ${worker.availability.toLowerCase()}, ${worker.verification.toLowerCase()}.`
            );
        }

        const changes =
            button.dataset.action === 'verify'    ? { verification: 'Verified' }  :
            button.dataset.action === 'suspend'   ? { verification: 'Suspended' } :
            button.dataset.action === 'reinstate' ? { verification: 'Verified' }  : null;
        if (!changes) return;

        button.disabled = true;
        try {
            const updated = await API.admin.updateWorker(worker.id, changes);
            Object.assign(worker, updated);
            renderWorkers();
            showMessage(`${updated.name} is now ${updated.verification.toLowerCase()}.`);
            loadStats();
        } catch (err) {
            showMessage(err.message, true);
            button.disabled = false;
        }
    });

    /* ---------------------------- bookings -----------------------------
       Ruled table rows: brass for money, the shared badge for status. */

    async function loadBookings() {
        try {
            const bookings = await API.bookings.mine();   // admin sees all
            bookingList.innerHTML = bookings.length
                ? bookings.map((booking) => `
                    <tr class="table-row-hover">
                        <td class="py-3 pr-4 figure">${esc(booking.code)}</td>
                        <td class="py-3 pr-4 text-on-surface">${esc(booking.customerName)}</td>
                        <td class="py-3 pr-4 text-on-surface">${esc(booking.worker ? booking.worker.name : 'Unassigned')}</td>
                        <td class="py-3 pr-4 text-on-surface-variant">${esc(booking.service)}</td>
                        <td class="py-3 pr-4 text-right figure money">${rupee}${esc(booking.amount)}</td>
                        <td class="py-3">${statusBadge(booking.status)}</td>
                    </tr>`).join('')
                : '<tr><td colspan="6" class="py-6 text-center font-body-md text-[14px] text-on-surface-variant">No bookings yet.</td></tr>';
        } catch (err) {
            bookingList.innerHTML = `<tr><td colspan="6" class="py-6 text-center font-body-md text-[14px] text-error">${esc(err.message)}</td></tr>`;
        }
    }

    /* ---------------------------- analytics ----------------------------
       A trade, a share bar, a percentage. No leading icon restating the name. */

    async function loadAnalytics() {
        try {
            const analytics = await API.admin.analytics();
            analyticsList.innerHTML = analytics.length
                ? analytics.map((row) => `
                    <div>
                        <div class="flex items-baseline justify-between gap-3 mb-1.5">
                            <span class="font-body-md text-[14px] text-on-surface truncate">${esc(row.name)}</span>
                            <span class="figure text-[14px] text-on-surface-variant flex-shrink-0">${Number(row.percent) || 0}%</span>
                        </div>
                        <div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                            <div class="h-full rounded-full bg-primary" style="width:${Number(row.percent) || 0}%"></div>
                        </div>
                    </div>`).join('')
                : '<p class="font-body-md text-[14px] text-on-surface-variant">No bookings to break down yet.</p>';
        } catch (err) {
            analyticsList.innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    }

    /* ---------------------------- activity log -------------------------- */

    // Plain-English labels, so the log reads as history rather than as event names.
    const ACTION_LABELS = {
        'user.register': 'New account created',
        'user.login': 'Signed in',
        'user.login_failed': 'Failed sign-in attempt',
        'user.update_profile': 'Profile updated',
        'user.password_changed': 'Password changed',
        'user.password_change_failed': 'Failed password change',
        'booking.create': 'Booking created',
        'booking.status': 'Booking status changed',
        'chat.message': 'Assistant question asked',
        'worker.update_own_listing': 'Worker updated their listing',
        'admin.worker_update': 'Admin updated a worker'
    };

    async function loadAudit() {
        const list = document.getElementById('audit-list');
        if (!list) return;
        try {
            const entries = await API.admin.audit(60);
            list.innerHTML = entries.length
                ? `<div class="ledger">${entries.map((entry) => {
                    const label = ACTION_LABELS[entry.action] || entry.action;
                    const failed = String(entry.action).includes('failed');
                    const when = new Date(entry.created_at).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    });
                    return `
                    <div class="ledger-row flex items-baseline justify-between gap-3">
                        <div class="min-w-0">
                            <p class="font-body-md text-[14px] ${failed ? 'text-error' : 'text-on-surface'}">${esc(label)}</p>
                            <p class="rate-row-meta truncate">${esc(entry.email || 'system')}${entry.entity_id ? ` &middot; ${esc(entry.entity)} #${esc(entry.entity_id)}` : ''}</p>
                        </div>
                        <span class="font-body-md text-[13px] text-outline whitespace-nowrap flex-shrink-0">${esc(when)}</span>
                    </div>`;
                }).join('')}</div>`
                : '<p class="font-body-md text-[14px] text-on-surface-variant">Nothing has happened yet.</p>';
        } catch (err) {
            list.innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    }

    const auditSection = document.getElementById('audit-log');
    const openAudit = document.getElementById('open-audit');
    const refreshAudit = document.getElementById('refresh-audit');

    if (openAudit) {
        openAudit.addEventListener('click', () => {
            loadAudit();
            if (auditSection) auditSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
    if (refreshAudit) {
        refreshAudit.addEventListener('click', () => {
            refreshAudit.textContent = 'Refreshing…';
            loadAudit().finally(() => { refreshAudit.textContent = 'Refresh'; });
        });
    }

    /* -------------------------- action buttons ------------------------- */

    document.querySelectorAll('.admin-action').forEach((button) => {
        button.addEventListener('click', async () => {
            const action = button.dataset.action;

            if (action === 'bookings') {
                await loadBookings();
                return showMessage('Booking list refreshed.');
            }

            if (action === 'export') {
                try {
                    const entries = await API.admin.audit(200);
                    const header = 'id,action,entity,entity_id,email,created_at\n';
                    const rows = entries.map((e) =>
                        [e.id, e.action, e.entity || '', e.entity_id || '', e.email || '', e.created_at]
                            .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
                    ).join('\n');

                    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `sahayaksetu-audit-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                    return showMessage(`Exported ${entries.length} audit entries.`);
                } catch (err) {
                    return showMessage(err.message, true);
                }
            }

            if (action === 'register') {
                return showMessage('Workers register themselves on the login page — pick "Create an account" and choose Worker. New signups appear here as Pending Verification.');
            }
        });
    });

    /* ------------------------------ boot ------------------------------- */

    loadStats();
    loadWorkers();
    loadBookings();
    loadAnalytics();
    loadAudit();
});
