/**
 * js/nav.js — one place that owns navigation for the whole site.
 *
 * Every page used to ship the template's placeholder menu: eleven links all
 * pointing at href="#", a hardcoded "Raj Patel" user chip, and no way to log
 * out. Rather than fix that page by page (and drift apart again), each page now
 * just marks its containers and this file fills them in:
 *
 *   <nav data-nav="side">      desktop sidebar
 *   <nav data-nav="bottom">    mobile bottom bar
 *   <div data-nav="user">      the signed-in user chip
 *   <button data-nav="logout"> optional explicit logout button
 *
 * Links shown depend on who is signed in, so a customer never sees the admin
 * console in their menu (and the API would refuse them anyway).
 *
 * Load after js/api.js.
 */

(function () {
    if (typeof API === 'undefined') {
        console.warn('[nav] js/api.js must be loaded before js/nav.js');
        return;
    }

    const PAGE = (window.location.pathname.split('/').pop() || 'landing.html').toLowerCase();

    /* Destination lists per role. `match` marks the item active on those pages. */
    const LINKS = {
        guest: [
            { label: 'Home',         icon: 'home',    href: 'landing.html',  match: ['landing.html', ''] },
            { label: 'Find Workers', icon: 'search',  href: 'dashboard.html', match: ['dashboard.html', 'booking.html'] },
            { label: 'Log in',       icon: 'login',   href: 'login.html',    match: ['login.html'] }
        ],
        customer: [
            { label: 'Home',         icon: 'home',       href: 'landing.html',  match: ['landing.html', ''] },
            { label: 'Find Workers', icon: 'search',     href: 'dashboard.html', match: ['dashboard.html', 'booking.html'] },
            { label: 'My Bookings',  icon: 'assignment', href: 'account.html#bookings', match: [] },
            { label: 'My Profile',   icon: 'person',     href: 'account.html',  match: ['account.html'] }
        ],
        worker: [
            { label: 'Home',       icon: 'home',   href: 'landing.html', match: ['landing.html', ''] },
            { label: 'My Jobs',    icon: 'work',   href: 'profile.html', match: ['profile.html'] },
            { label: 'Browse',     icon: 'search', href: 'dashboard.html', match: ['dashboard.html', 'booking.html'] },
            { label: 'My Profile', icon: 'person', href: 'account.html', match: ['account.html'] }
        ],
        admin: [
            { label: 'Console',    icon: 'admin_panel_settings', href: 'admin.html', match: ['admin.html'] },
            { label: 'Workers',    icon: 'search', href: 'dashboard.html', match: ['dashboard.html', 'booking.html'] },
            { label: 'Jobs',       icon: 'work',   href: 'profile.html', match: ['profile.html'] },
            { label: 'My Profile', icon: 'person', href: 'account.html', match: ['account.html'] }
        ]
    };

    const user = API.session.isLoggedIn ? API.session.user : null;
    const role = user ? user.role : 'guest';
    const links = LINKS[role] || LINKS.guest;

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    const isActive = (link) => link.match.includes(PAGE);

    /* ------------------------------ sidebar -----------------------------
       The active item is marked by a solid pine bar down its left edge —
       the tab on a filing divider. It used to be a filled pill, which made
       the whole rail read as a row of floating buttons. */

    const SIDE_ACTIVE = 'nav-side-item nav-side-active flex items-center gap-3 py-2.5 pl-3 pr-3 text-on-surface font-semibold transition-colors';
    const SIDE_IDLE = 'nav-side-item flex items-center gap-3 py-2.5 pl-3 pr-3 text-on-surface-variant hover:text-on-surface transition-colors';

    function renderSide(container) {
        container.innerHTML = links.map((link) => `
            <a class="${isActive(link) ? SIDE_ACTIVE : SIDE_IDLE}" href="${link.href}"${isActive(link) ? ' aria-current="page"' : ''}>
                <span class="material-symbols-outlined text-[20px]"${isActive(link) ? " style=\"font-variation-settings: 'FILL' 1;\"" : ''}>${link.icon}</span>
                <span class="font-label-md text-label-md">${esc(link.label)}</span>
            </a>`).join('') +
            (user ? `
            <button class="nav-logout nav-side-item flex items-center gap-3 py-2.5 pl-3 pr-3 w-full text-left text-on-surface-variant hover:text-error transition-colors mt-2" type="button">
                <span class="material-symbols-outlined text-[20px]">logout</span>
                <span class="font-label-md text-label-md">Log out</span>
            </button>` : '');
    }

    /* ---------------------------- bottom bar ----------------------------
       Mobile: the active item is marked by a rule above it and by weight,
       not by scaling it 10% larger than its neighbours. */

    const BOTTOM_ACTIVE = 'nav-bottom-item nav-bottom-active flex flex-col items-center justify-center gap-1 flex-1 py-1.5 text-primary';
    const BOTTOM_IDLE = 'nav-bottom-item flex flex-col items-center justify-center gap-1 flex-1 py-1.5 text-on-surface-variant transition-colors';

    function renderBottom(container) {
        container.innerHTML = links.map((link) => `
            <a class="${isActive(link) ? BOTTOM_ACTIVE : BOTTOM_IDLE}" href="${link.href}"${isActive(link) ? ' aria-current="page"' : ''}>
                <span class="material-symbols-outlined text-[21px]"${isActive(link) ? " style=\"font-variation-settings: 'FILL' 1;\"" : ''}>${link.icon}</span>
                <span class="font-label-sm text-label-sm">${esc(link.label)}</span>
            </a>`).join('');
    }

    /* ----------------------------- user chip ---------------------------- */

    function renderUser(container) {
        if (!user) {
            container.innerHTML = `
                <a class="no-underline flex items-center gap-3 w-full" href="login.html">
                    <div class="w-9 h-9 rounded border border-outline-variant flex items-center justify-center">
                        <span class="material-symbols-outlined text-[19px] text-on-surface-variant">person</span>
                    </div>
                    <div>
                        <p class="font-label-md text-label-md font-semibold text-on-surface">Log in</p>
                        <p class="font-label-sm text-label-sm text-outline normal-case tracking-normal">or create an account</p>
                    </div>
                </a>`;
            return;
        }

        const initials = String(user.name || '?').trim().split(/\s+/)
            .map((p) => p[0]).slice(0, 2).join('').toUpperCase();

        container.innerHTML = `
            <a class="no-underline flex items-center gap-3 flex-1 min-w-0" href="account.html" title="View and edit your profile">
                <div class="w-9 h-9 rounded bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md font-semibold flex-shrink-0">${esc(initials)}</div>
                <div class="min-w-0">
                    <p class="font-label-md text-label-md font-semibold text-on-surface truncate">${esc(user.name)}</p>
                    <p class="font-label-sm text-label-sm text-outline capitalize">${esc(user.role)}</p>
                </div>
            </a>
            <button class="nav-logout text-on-surface-variant hover:text-error p-2 rounded transition-colors flex-shrink-0" title="Log out" type="button">
                <span class="material-symbols-outlined text-[20px]">logout</span>
            </button>`;
    }

    /* ------------------------------- logout ----------------------------- */

    function wireLogout(root) {
        root.querySelectorAll('.nav-logout, [data-nav="logout"]').forEach((button) => {
            if (button.dataset.navWired) return;
            button.dataset.navWired = '1';
            button.addEventListener('click', (event) => {
                event.preventDefault();
                API.auth.logout('landing.html');
            });
        });
    }

    /* -------------------------------- boot ------------------------------ */

    function paint() {
        document.querySelectorAll('[data-nav="side"]').forEach(renderSide);
        document.querySelectorAll('[data-nav="bottom"]').forEach(renderBottom);
        document.querySelectorAll('[data-nav="user"]').forEach(renderUser);
        wireLogout(document);

        // Any element with data-nav-text="name" shows the signed-in person's name.
        document.querySelectorAll('[data-nav-text="name"]').forEach((el) => {
            el.textContent = user ? user.name : 'Guest';
        });
        document.querySelectorAll('[data-nav-text="role"]').forEach((el) => {
            el.textContent = user ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Visitor';
        });

        // Links only meaningful when signed in / out.
        document.querySelectorAll('[data-nav-when="signed-in"]').forEach((el) => {
            if (!user) el.classList.add('hidden');
        });
        document.querySelectorAll('[data-nav-when="signed-out"]').forEach((el) => {
            if (user) el.classList.add('hidden');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', paint);
    } else {
        paint();
    }

    window.SahayakNav = { role, user, links, paint };
})();
