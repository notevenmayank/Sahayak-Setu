/**
 * js/admin.js — cooperative admin dashboard & federation controller.
 *
 * All operations connect directly to /api/admin/* and are secured by requireRole('admin').
 * Provides tabbed management across Dashboard, Workers (blacklist/unblacklist),
 * Bookings (cancellation with reason), Users (status management), and Audit trail.
 */

document.addEventListener('DOMContentLoaded', () => {
    if (!API.auth.guard('admin')) return;

    const rupee = String.fromCharCode(8377);
    const star = String.fromCharCode(9733);
    const currentUser = API.session.user || {};

    /* ------------------------------ state ------------------------------ */
    let currentTab = 'dashboard';
    let cachedWorkers = [];
    let cachedBookings = [];
    let cachedUsers = [];
    let cachedAudit = [];

    // Active modal targets
    let pendingBlacklistWorker = null;
    let pendingUnblacklistWorker = null;
    let pendingCancelBooking = null;
    let pendingUserStatus = null;

    /* ------------------------------ helpers ---------------------------- */
    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    const noticeEl = document.getElementById('admin-global-notice');
    let noticeTimeout = null;

    function showNotice(message, isError = false) {
        if (!noticeEl) return;
        if (noticeTimeout) clearTimeout(noticeTimeout);
        noticeEl.textContent = message;
        noticeEl.className = `notice mb-6 transition-all ${isError ? 'notice-error' : 'notice-good'}`;
        noticeEl.classList.remove('hidden');
        noticeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        noticeTimeout = setTimeout(() => {
            noticeEl.classList.add('hidden');
        }, 6000);
    }

    const BADGE_CLASS = {
        Verified: 'badge-verified',
        'Pending Verification': 'badge-wait',
        Suspended: 'badge-stop',
        Available: 'badge-good',
        Unavailable: 'badge-wait',
        Active: 'badge-good',
        Confirmed: 'badge-good',
        Pending: 'badge-wait',
        Completed: 'badge-verified',
        Cancelled: 'badge-stop'
    };

    function statusBadge(status) {
        return `<span class="badge ${BADGE_CLASS[status] || 'badge-wait'}">${esc(status)}</span>`;
    }

    function blacklistBadge(isBlacklisted) {
        return isBlacklisted
            ? `<span class="badge badge-stop flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">block</span>Blacklisted</span>`
            : `<span class="badge badge-good flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">check</span>Active</span>`;
    }

    /* --------------------------- tab switcher -------------------------- */
    const TAB_HEADINGS = {
        dashboard: { title: 'Dashboard Overview', subtitle: 'Live metrics and cooperative performance across the federation.' },
        workers:   { title: 'Worker Management', subtitle: 'Inspect, verify, or blacklist cooperative service workers.' },
        bookings:  { title: 'Federation Bookings', subtitle: 'Inspect all customer bookings, track progress, or issue admin cancellations.' },
        users:     { title: 'User Directory', subtitle: 'Overview of all registered customers, workers, and administrators.' },
        audit:     { title: 'Federation Audit Trail', subtitle: 'Append-only system activity log of all sensitive admin & user actions.' }
    };

    function switchTab(tabId) {
        if (!TAB_HEADINGS[tabId]) tabId = 'dashboard';
        currentTab = tabId;

        // Hide all views
        document.querySelectorAll('.tab-view').forEach((view) => view.classList.add('hidden'));

        // Show target view
        const targetView = document.getElementById(`view-${tabId}`);
        if (targetView) targetView.classList.remove('hidden');

        // Update headers
        setText('admin-view-title', TAB_HEADINGS[tabId].title);
        setText('admin-view-subtitle', TAB_HEADINGS[tabId].subtitle);

        // Update sidebar buttons
        document.querySelectorAll('#admin-sidebar-nav .admin-nav-item').forEach((btn) => {
            const match = btn.dataset.tab === tabId;
            btn.classList.toggle('nav-side-active', match);
            btn.classList.toggle('text-on-surface', match);
            btn.classList.toggle('font-semibold', match);
            btn.classList.toggle('text-on-surface-variant', !match);
            const icon = btn.querySelector('.material-symbols-outlined');
            if (icon) icon.style.fontVariationSettings = match ? "'FILL' 1" : "'FILL' 0";
        });

        // Update mobile tabs
        document.querySelectorAll('#admin-mobile-tabs button').forEach((btn) => {
            const match = btn.dataset.tab === tabId;
            btn.classList.toggle('text-primary', match);
            btn.classList.toggle('font-semibold', match);
            btn.classList.toggle('text-on-surface-variant', !match);
        });

        // Load data for active view
        refreshCurrentTab();

        // Update URL hash quietly
        try { history.replaceState(null, '', `#${tabId}`); } catch (_) {}
    }

    function refreshCurrentTab() {
        if (currentTab === 'dashboard') {
            loadStats();
            loadAnalytics();
        } else if (currentTab === 'workers') {
            loadWorkers();
        } else if (currentTab === 'bookings') {
            loadBookings();
        } else if (currentTab === 'users') {
            loadUsers();
        } else if (currentTab === 'audit') {
            loadAudit();
        }
    }

    // Bind sidebar clicks
    document.querySelectorAll('#admin-sidebar-nav [data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Bind mobile tabs clicks
    document.querySelectorAll('#admin-mobile-tabs [data-tab]').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Top refresh button
    document.getElementById('btn-refresh-view')?.addEventListener('click', () => {
        refreshCurrentTab();
        showNotice(`Refreshed ${TAB_HEADINGS[currentTab]?.title || 'view'}.`);
    });

    // Dashboard shortcuts
    document.getElementById('btn-quick-manage-workers')?.addEventListener('click', () => switchTab('workers'));
    document.getElementById('btn-quick-manage-bookings')?.addEventListener('click', () => switchTab('bookings'));
    document.getElementById('btn-quick-manage-users')?.addEventListener('click', () => switchTab('users'));
    document.getElementById('btn-quick-export-audit')?.addEventListener('click', exportAuditCsv);

    /* ----------------------------- modals ------------------------------ */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            const focusInput = modal.querySelector('textarea, input');
            if (focusInput) setTimeout(() => focusInput.focus(), 50);
        }
    }

    function closeModal(modalId) {
        const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    document.querySelectorAll('.close-modal').forEach((btn) => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('[role="dialog"]');
            if (modal) closeModal(modal);
        });
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('[role="dialog"]:not(.hidden)').forEach((m) => closeModal(m));
        }
    });

    document.querySelectorAll('[role="dialog"]').forEach((modal) => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
    });

    /* -------------------------- 1. dashboard --------------------------- */
    async function loadStats() {
        try {
            const stats = await API.admin.stats();
            setText('stat-total-users', Number(stats.totalUsers || 0).toLocaleString('en-IN'));
            setText('stat-customers', Number(stats.customers || 0).toLocaleString('en-IN'));
            setText('stat-suspended-users', Number(stats.suspendedUsers || 0).toLocaleString('en-IN'));

            setText('stat-total-workers', Number(stats.totalWorkers || stats.workers || 0).toLocaleString('en-IN'));
            setText('stat-verified-workers', Number(stats.verifiedWorkers || 0).toLocaleString('en-IN'));
            setText('stat-pending-workers', Number(stats.pendingVerification || 0).toLocaleString('en-IN'));

            setText('stat-active-workers', Number(stats.activeWorkers !== undefined ? stats.activeWorkers : stats.workers).toLocaleString('en-IN'));
            setText('stat-blacklisted-workers', Number(stats.blacklistedWorkers || 0).toLocaleString('en-IN'));

            setText('stat-total-bookings', Number(stats.totalBookings || 0).toLocaleString('en-IN'));
            setText('stat-active-bookings', Number(stats.activeBookings || 0).toLocaleString('en-IN'));
            setText('stat-cancelled-bookings', Number(stats.cancelledBookings || 0).toLocaleString('en-IN'));
            setText('stat-completed-bookings', Number(stats.completedBookings || 0).toLocaleString('en-IN'));

            setText('stat-total-revenue', `${rupee}${Number(stats.revenue || 0).toLocaleString('en-IN')}`);
            setText('stat-month-revenue', `${rupee}${Number(stats.monthRevenue || 0).toLocaleString('en-IN')}`);
            setText('stat-avg-rating', `${stats.avgRating || 0} ${star}`);
        } catch (err) {
            showNotice(err.message, true);
        }
    }

    async function loadAnalytics() {
        const container = document.getElementById('service-analytics-list');
        if (!container) return;
        try {
            const analytics = await API.admin.analytics();
            container.innerHTML = analytics.length
                ? analytics.map((row) => `
                    <div>
                        <div class="flex items-baseline justify-between gap-3 mb-1.5">
                            <span class="font-body-md text-[14px] text-on-surface truncate">${esc(row.name)}</span>
                            <span class="figure text-[13px] text-on-surface-variant flex-shrink-0">${Number(row.percent) || 0}% (${row.bookings} bookings)</span>
                        </div>
                        <div class="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                            <div class="h-full rounded-full bg-primary" style="width:${Number(row.percent) || 0}%"></div>
                        </div>
                    </div>`).join('')
                : '<p class="font-body-md text-[14px] text-on-surface-variant">No booking demand recorded yet.</p>';
        } catch (err) {
            container.innerHTML = `<div class="notice notice-error">${esc(err.message)}</div>`;
        }
    }

    /* --------------------------- 2. workers ---------------------------- */
    const workerSearchInput = document.getElementById('worker-search-input');
    const workerStatusFilter = document.getElementById('worker-status-filter');
    const workersTableBody = document.getElementById('workers-table-body');

    let workerDebounce = null;
    function triggerWorkerSearch() {
        if (workerDebounce) clearTimeout(workerDebounce);
        workerDebounce = setTimeout(loadWorkers, 250);
    }

    workerSearchInput?.addEventListener('input', triggerWorkerSearch);
    workerStatusFilter?.addEventListener('change', loadWorkers);

    async function loadWorkers() {
        if (!workersTableBody) return;
        const q = workerSearchInput ? workerSearchInput.value.trim() : '';
        const status = workerStatusFilter ? workerStatusFilter.value : '';

        try {
            const workers = await API.admin.workers({ q, status });
            cachedWorkers = workers;
            setText('worker-count-badge', `${workers.length} Worker${workers.length === 1 ? '' : 's'}`);

            if (!workers.length) {
                workersTableBody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-on-surface-variant">No workers matching filters.</td></tr>`;
                return;
            }

            workersTableBody.innerHTML = workers.map((w) => `
                <tr class="hover:bg-surface-container-low transition-colors">
                    <td class="py-3 px-4">
                        <div class="font-semibold text-on-surface">${esc(w.name)}</div>
                        <div class="text-[12px] text-outline font-mono">${esc(w.code)} ${w.phone ? '&middot; ' + esc(w.phone) : ''}</div>
                    </td>
                    <td class="py-3 px-4 text-on-surface">${esc(w.service)}</td>
                    <td class="py-3 px-4">
                        <span class="rating-value">${esc(w.rating)} ${star}</span>
                        <span class="text-outline text-[12px]">(${esc(w.jobs_done)} jobs)</span>
                    </td>
                    <td class="py-3 px-4">${statusBadge(w.verification)}</td>
                    <td class="py-3 px-4">
                        ${blacklistBadge(Boolean(w.is_blacklisted))}
                        ${w.blacklist_reason ? `<div class="text-[11px] text-error mt-0.5 max-w-xs truncate" title="${esc(w.blacklist_reason)}">Reason: ${esc(w.blacklist_reason)}</div>` : ''}
                    </td>
                    <td class="py-3 px-4 text-right">
                        <div class="flex items-center justify-end gap-1.5">
                            ${w.verification === 'Pending Verification'
                                ? `<button class="btn btn-outline btn-sm !h-8 !px-2.5 action-verify-worker" data-id="${esc(w.id)}" type="button" title="Verify worker credentials">Verify</button>`
                                : ''}
                            ${w.is_blacklisted
                                ? `<button class="btn btn-primary btn-sm !h-8 !px-2.5 action-unblacklist-worker" data-id="${esc(w.id)}" type="button" title="Remove blacklist and reactivate">Reactivate</button>`
                                : `<button class="btn btn-danger btn-sm !h-8 !px-2.5 action-blacklist-worker" data-id="${esc(w.id)}" type="button" title="Blacklist worker from federation">Blacklist</button>`}
                        </div>
                    </td>
                </tr>`).join('');
        } catch (err) {
            workersTableBody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-error">${esc(err.message)}</td></tr>`;
        }
    }

    // Workers Actions delegation
    workersTableBody?.addEventListener('click', async (e) => {
        const verifyBtn = e.target.closest('.action-verify-worker');
        if (verifyBtn) {
            const workerId = verifyBtn.dataset.id;
            verifyBtn.disabled = true;
            try {
                const updated = await API.admin.updateWorker(workerId, { verification: 'Verified' });
                showNotice(`${updated.name} has been verified.`);
                loadWorkers();
                loadStats();
            } catch (err) {
                showNotice(err.message, true);
                verifyBtn.disabled = false;
            }
            return;
        }

        const blacklistBtn = e.target.closest('.action-blacklist-worker');
        if (blacklistBtn) {
            const worker = cachedWorkers.find((w) => String(w.id) === blacklistBtn.dataset.id);
            if (!worker) return;
            pendingBlacklistWorker = worker;
            setText('blacklist-worker-name', worker.name);
            setText('blacklist-worker-code', worker.code);
            const reasonInput = document.getElementById('blacklist-reason');
            if (reasonInput) reasonInput.value = '';
            openModal('modal-blacklist-worker');
            return;
        }

        const unblacklistBtn = e.target.closest('.action-unblacklist-worker');
        if (unblacklistBtn) {
            const worker = cachedWorkers.find((w) => String(w.id) === unblacklistBtn.dataset.id);
            if (!worker) return;
            pendingUnblacklistWorker = worker;
            setText('unblacklist-worker-name', worker.name);
            setText('unblacklist-worker-code', worker.code);
            openModal('modal-unblacklist-worker');
            return;
        }
    });

    // Confirm Blacklist Button
    document.getElementById('btn-confirm-blacklist')?.addEventListener('click', async () => {
        if (!pendingBlacklistWorker) return;
        const reasonInput = document.getElementById('blacklist-reason');
        const reason = reasonInput ? reasonInput.value.trim() : '';

        if (reason.length < 3) {
            alert('Please provide a reason for blacklisting (minimum 3 characters).');
            return;
        }

        const btn = document.getElementById('btn-confirm-blacklist');
        if (btn) btn.disabled = true;

        try {
            await API.admin.blacklistWorker(pendingBlacklistWorker.id, reason);
            closeModal('modal-blacklist-worker');
            showNotice(`${pendingBlacklistWorker.name} is now blacklisted. New bookings are blocked.`);
            pendingBlacklistWorker = null;
            loadWorkers();
            loadStats();
        } catch (err) {
            showNotice(err.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // Confirm Unblacklist Button
    document.getElementById('btn-confirm-unblacklist')?.addEventListener('click', async () => {
        if (!pendingUnblacklistWorker) return;
        const btn = document.getElementById('btn-confirm-unblacklist');
        if (btn) btn.disabled = true;

        try {
            await API.admin.unblacklistWorker(pendingUnblacklistWorker.id);
            closeModal('modal-unblacklist-worker');
            showNotice(`${pendingUnblacklistWorker.name} has been reactivated.`);
            pendingUnblacklistWorker = null;
            loadWorkers();
            loadStats();
        } catch (err) {
            showNotice(err.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    /* --------------------------- 3. bookings --------------------------- */
    const bookingSearchInput = document.getElementById('booking-search-input');
    const bookingStatusFilter = document.getElementById('booking-status-filter');
    const bookingsTableBody = document.getElementById('bookings-table-body');

    let bookingDebounce = null;
    function triggerBookingSearch() {
        if (bookingDebounce) clearTimeout(bookingDebounce);
        bookingDebounce = setTimeout(loadBookings, 250);
    }

    bookingSearchInput?.addEventListener('input', triggerBookingSearch);
    bookingStatusFilter?.addEventListener('change', loadBookings);

    async function loadBookings() {
        if (!bookingsTableBody) return;
        const q = bookingSearchInput ? bookingSearchInput.value.trim() : '';
        const status = bookingStatusFilter ? bookingStatusFilter.value : '';

        try {
            const bookings = await API.admin.bookings({ q, status });
            cachedBookings = bookings;
            setText('booking-count-badge', `${bookings.length} Booking${bookings.length === 1 ? '' : 's'}`);

            if (!bookings.length) {
                bookingsTableBody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-on-surface-variant">No bookings matching filter.</td></tr>`;
                return;
            }

            bookingsTableBody.innerHTML = bookings.map((b) => `
                <tr class="hover:bg-surface-container-low transition-colors">
                    <td class="py-3 px-4 font-mono font-semibold text-on-surface">${esc(b.code)}</td>
                    <td class="py-3 px-4">
                        <div class="font-semibold text-on-surface">${esc(b.customerName)}</div>
                        <div class="text-[12px] text-outline">${esc(b.mobile)}</div>
                    </td>
                    <td class="py-3 px-4">
                        ${b.worker ? `<div class="font-semibold text-on-surface">${esc(b.worker.name)}</div><div class="text-[12px] text-outline">${esc(b.worker.code || '')}</div>` : '<span class="text-outline italic">Unassigned</span>'}
                    </td>
                    <td class="py-3 px-4 text-on-surface">${esc(b.service)}</td>
                    <td class="py-3 px-4 text-[13px]">${esc(b.preferredDate)} <span class="text-outline">&middot;</span> ${esc(b.preferredTime)}</td>
                    <td class="py-3 px-4 text-right figure money">${rupee}${Number(b.amount || 0).toLocaleString('en-IN')}</td>
                    <td class="py-3 px-4">
                        ${statusBadge(b.status)}
                        ${b.cancellationReason ? `<div class="text-[11px] text-error mt-1 max-w-xs truncate" title="${esc(b.cancellationReason)}">Reason: ${esc(b.cancellationReason)}</div>` : ''}
                    </td>
                    <td class="py-3 px-4 text-right">
                        ${['Pending', 'Confirmed'].includes(b.status)
                            ? `<button class="btn btn-danger btn-sm !h-8 !px-2.5 action-cancel-booking" data-id="${esc(b.id)}" type="button" title="Cancel this booking with admin reason">Cancel</button>`
                            : `<span class="text-[12px] text-outline italic">Locked</span>`}
                    </td>
                </tr>`).join('');
        } catch (err) {
            bookingsTableBody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-error">${esc(err.message)}</td></tr>`;
        }
    }

    // Bookings Actions delegation
    bookingsTableBody?.addEventListener('click', (e) => {
        const cancelBtn = e.target.closest('.action-cancel-booking');
        if (cancelBtn) {
            const booking = cachedBookings.find((b) => String(b.id) === cancelBtn.dataset.id);
            if (!booking) return;
            pendingCancelBooking = booking;
            setText('cancel-booking-code', booking.code);
            setText('cancel-booking-customer', `${booking.customerName} (${booking.mobile})`);
            setText('cancel-booking-service', `${booking.service} with ${booking.worker ? booking.worker.name : 'Unassigned'}`);
            const reasonInput = document.getElementById('cancel-booking-reason');
            if (reasonInput) reasonInput.value = '';
            openModal('modal-cancel-booking');
        }
    });

    // Confirm Booking Cancellation Button
    document.getElementById('btn-confirm-cancel-booking')?.addEventListener('click', async () => {
        if (!pendingCancelBooking) return;
        const reasonInput = document.getElementById('cancel-booking-reason');
        const reason = reasonInput ? reasonInput.value.trim() : '';

        if (reason.length < 3) {
            alert('Please provide a reason for cancellation (minimum 3 characters).');
            return;
        }

        const btn = document.getElementById('btn-confirm-cancel-booking');
        if (btn) btn.disabled = true;

        try {
            await API.admin.cancelBooking(pendingCancelBooking.id, reason);
            closeModal('modal-cancel-booking');
            showNotice(`Booking ${pendingCancelBooking.code} has been cancelled.`);
            pendingCancelBooking = null;
            loadBookings();
            loadStats();
        } catch (err) {
            showNotice(err.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    /* ---------------------------- 4. users ----------------------------- */
    const userSearchInput = document.getElementById('user-search-input');
    const userRoleFilter = document.getElementById('user-role-filter');
    const userStatusFilter = document.getElementById('user-status-filter');
    const usersTableBody = document.getElementById('users-table-body');

    let userDebounce = null;
    function triggerUserSearch() {
        if (userDebounce) clearTimeout(userDebounce);
        userDebounce = setTimeout(loadUsers, 250);
    }

    userSearchInput?.addEventListener('input', triggerUserSearch);
    userRoleFilter?.addEventListener('change', loadUsers);
    userStatusFilter?.addEventListener('change', loadUsers);

    async function loadUsers() {
        if (!usersTableBody) return;
        const q = userSearchInput ? userSearchInput.value.trim() : '';
        const role = userRoleFilter ? userRoleFilter.value : '';
        const status = userStatusFilter ? userStatusFilter.value : '';

        try {
            const users = await API.admin.users({ q, role, status });
            cachedUsers = users;
            setText('user-count-badge', `${users.length} User${users.length === 1 ? '' : 's'}`);

            if (!users.length) {
                usersTableBody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-on-surface-variant">No users matching filter.</td></tr>`;
                return;
            }

            usersTableBody.innerHTML = users.map((u) => {
                const isSelf = currentUser && currentUser.id === u.id;
                const regDate = new Date(u.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric'
                });
                return `
                <tr class="hover:bg-surface-container-low transition-colors">
                    <td class="py-3 px-4">
                        <div class="font-semibold text-on-surface">${esc(u.name)}</div>
                        <div class="text-[12px] text-outline font-mono">ID #${esc(u.id)}</div>
                    </td>
                    <td class="py-3 px-4 font-mono text-[13px] text-on-surface">${esc(u.email)}</td>
                    <td class="py-3 px-4 text-on-surface">${esc(u.phone || '—')}</td>
                    <td class="py-3 px-4">
                        <span class="badge ${u.role === 'admin' ? 'badge-verified' : u.role === 'worker' ? 'badge-good' : 'badge-wait'} capitalize">${esc(u.role)}</span>
                    </td>
                    <td class="py-3 px-4">
                        ${statusBadge(u.status || 'Active')}
                    </td>
                    <td class="py-3 px-4 text-[13px] text-outline">${esc(regDate)}</td>
                    <td class="py-3 px-4 text-right">
                        ${isSelf
                            ? `<span class="text-[12px] text-primary italic">Current Admin</span>`
                            : u.status === 'Suspended'
                            ? `<button class="btn btn-primary btn-sm !h-8 !px-2.5 action-toggle-user" data-id="${esc(u.id)}" data-action="Active" type="button">Reactivate</button>`
                            : `<button class="btn btn-danger btn-sm !h-8 !px-2.5 action-toggle-user" data-id="${esc(u.id)}" data-action="Suspended" type="button">Suspend</button>`}
                    </td>
                </tr>`;
            }).join('');
        } catch (err) {
            usersTableBody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-error">${esc(err.message)}</td></tr>`;
        }
    }

    // Users Actions delegation
    usersTableBody?.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.action-toggle-user');
        if (!toggleBtn) return;
        const targetUser = cachedUsers.find((u) => String(u.id) === toggleBtn.dataset.id);
        if (!targetUser) return;

        const targetStatus = toggleBtn.dataset.action; // 'Active' or 'Suspended'
        pendingUserStatus = { user: targetUser, targetStatus };

        setText('user-status-email', targetUser.email);
        setText('user-status-role', targetUser.role);
        setText('user-status-action-verb', targetStatus === 'Suspended' ? 'suspend' : 'reactivate');

        const reasonInput = document.getElementById('user-status-reason');
        if (reasonInput) reasonInput.value = '';

        const confirmBtn = document.getElementById('btn-confirm-user-status');
        if (confirmBtn) {
            confirmBtn.className = `btn btn-sm ${targetStatus === 'Suspended' ? 'btn-danger' : 'btn-primary'}`;
            confirmBtn.textContent = targetStatus === 'Suspended' ? 'Confirm Suspension' : 'Confirm Reactivation';
        }

        openModal('modal-user-status');
    });

    // Confirm User Status Button
    document.getElementById('btn-confirm-user-status')?.addEventListener('click', async () => {
        if (!pendingUserStatus) return;
        const { user, targetStatus } = pendingUserStatus;
        const reasonInput = document.getElementById('user-status-reason');
        const reason = reasonInput ? reasonInput.value.trim() : '';

        const btn = document.getElementById('btn-confirm-user-status');
        if (btn) btn.disabled = true;

        try {
            await API.admin.setUserStatus(user.id, targetStatus, reason);
            closeModal('modal-user-status');
            showNotice(`Account ${user.email} is now ${targetStatus}.`);
            pendingUserStatus = null;
            loadUsers();
            loadStats();
        } catch (err) {
            showNotice(err.message, true);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    /* ---------------------------- 5. audit ----------------------------- */
    const auditSearchInput = document.getElementById('audit-search-input');
    const auditActionFilter = document.getElementById('audit-action-filter');
    const auditLogList = document.getElementById('audit-log-list');

    let auditDebounce = null;
    function triggerAuditSearch() {
        if (auditDebounce) clearTimeout(auditDebounce);
        auditDebounce = setTimeout(loadAudit, 250);
    }

    auditSearchInput?.addEventListener('input', triggerAuditSearch);
    auditActionFilter?.addEventListener('change', loadAudit);
    document.getElementById('btn-export-audit')?.addEventListener('click', exportAuditCsv);

    async function loadAudit() {
        if (!auditLogList) return;
        const q = auditSearchInput ? auditSearchInput.value.trim() : '';
        const action = auditActionFilter ? auditActionFilter.value : '';

        try {
            const entries = await API.admin.audit(100, action, q);
            cachedAudit = entries;
            setText('audit-count-badge', `${entries.length} Event${entries.length === 1 ? '' : 's'}`);

            if (!entries.length) {
                auditLogList.innerHTML = `<p class="py-8 text-center text-on-surface-variant font-body-md text-[14px]">No audit events found.</p>`;
                return;
            }

            auditLogList.innerHTML = entries.map((e) => {
                const isDestructive = ['BLACKLIST_WORKER', 'CANCEL_BOOKING', 'SUSPEND_USER'].includes(e.action);
                const isPositive = ['UNBLACKLIST_WORKER', 'ACTIVATE_USER'].includes(e.action);
                const badgeClass = isDestructive ? 'badge-stop' : isPositive ? 'badge-good' : 'badge-wait';

                let detailsObj = null;
                try {
                    if (e.details) detailsObj = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
                } catch (_) {}

                const when = new Date(e.created_at).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                });

                let detailSummary = '';
                if (detailsObj) {
                    if (detailsObj.reason) detailSummary = `Reason: ${detailsObj.reason}`;
                    else if (detailsObj.workerName) detailSummary = `Worker: ${detailsObj.workerName}`;
                    else if (detailsObj.customerName) detailSummary = `Customer: ${detailsObj.customerName}`;
                }

                return `
                <div class="p-4 flex flex-wrap items-start justify-between gap-3 hover:bg-surface-container-low transition-colors">
                    <div class="space-y-1 min-w-0 max-w-xl">
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="badge ${badgeClass} font-mono text-[11px]">${esc(e.action)}</span>
                            ${e.entity ? `<span class="eyebrow">${esc(e.entity)} #${esc(e.entity_id || '')}</span>` : ''}
                        </div>
                        <p class="font-body-md text-[14px] text-on-surface font-medium">${esc(detailSummary || e.action)}</p>
                        <p class="text-[12px] text-outline">
                            Performed by: <span class="font-mono text-on-surface">${esc(e.email || 'system')}</span>
                            ${e.ip ? `&middot; IP: ${esc(e.ip)}` : ''}
                        </p>
                    </div>
                    <span class="text-[12px] text-outline flex-shrink-0 font-mono">${esc(when)}</span>
                </div>`;
            }).join('');
        } catch (err) {
            auditLogList.innerHTML = `<p class="py-6 text-center text-error font-body-md text-[14px]">${esc(err.message)}</p>`;
        }
    }

    async function exportAuditCsv() {
        try {
            const entries = await API.admin.audit(300);
            if (!entries.length) return showNotice('No audit events to export.', true);

            const header = 'id,action,entity,entity_id,email,details,created_at\n';
            const rows = entries.map((e) =>
                [e.id, e.action, e.entity || '', e.entity_id || '', e.email || '', e.details || '', e.created_at]
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
            ).join('\n');

            const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `sahayaksetu-audit-${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
            URL.revokeObjectURL(url);
            showNotice(`Exported ${entries.length} audit entries.`);
        } catch (err) {
            showNotice(err.message, true);
        }
    }

    /* ------------------------------ boot ------------------------------- */
    // Check URL hash for initial tab
    const initialHash = window.location.hash.replace('#', '').toLowerCase();
    const startTab = ['dashboard', 'workers', 'bookings', 'users', 'audit'].includes(initialHash)
        ? initialHash
        : 'dashboard';

    switchTab(startTab);
});

