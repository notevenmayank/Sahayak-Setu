/**
 * js/dashboard.js — the customer's "find a worker" page.
 *
 * Before: three worker cards hardcoded in dashboard.html, a fake 1.5s loading
 * delay, and filter controls that did nothing.
 *
 * Now: cards are rendered from /api/workers, and the filters actually filter.
 */

// The drawer buttons use onclick="toggleFilters()" in the HTML, so this has to
// stay a global function.
function toggleFilters() {
    const drawer = document.getElementById('filterDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer || !overlay) return;

    drawer.classList.toggle('open');
    overlay.classList.toggle('open');
    document.body.style.overflow = drawer.classList.contains('open') ? 'hidden' : '';
}

document.addEventListener('DOMContentLoaded', () => {
    const skeletons = document.getElementById('worker-skeletons');
    const cards = document.getElementById('worker-cards');
    const rupee = String.fromCharCode(8377);

    const categoryBox = document.getElementById('filter-categories');
    const ratingBox = document.getElementById('filter-rating');
    const priceInput = document.getElementById('filter-price');
    const priceLabel = document.getElementById('filter-price-label');
    const availableInput = document.getElementById('filter-available');
    const resetButton = document.getElementById('filter-reset');
    const applyButton = document.getElementById('filter-apply');

    const categoryGrid = document.getElementById('service-categories');
    const viewAllButton = document.getElementById('view-all-services');
    const bookButton = document.getElementById('book-service');
    const heading = document.getElementById('workers-heading');
    const workersSection = document.getElementById('workers');
    const searchInput = document.getElementById('worker-search');
    const clearSearchButton = document.getElementById('clear-search');

    let allWorkers = [];
    const filters = { services: new Set(), minRating: 0, maxPrice: 2000, availableOnly: true, query: '' };

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ------------------------------- cards ------------------------------
       A worker card is one of the few things on this site that stays a card:
       you are comparing discrete people side by side, and the card boundary
       is what separates one person's facts from the next person's. It is a
       hairline box on white, though — not a floating rounded rectangle with
       a blue shadow that tilts under the cursor.

       The five coloured pills (trade, verification, busy) are gone. Trade and
       distance are one line of running text; verification is the brass stamp,
       shown only when the worker actually is verified. */

    function card(worker) {
        const initials = worker.name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
        const busy = worker.availability !== 'Available';

        return `
        <article class="worker-card p-5 flex flex-col">
            <div class="flex items-start gap-3.5">
                <div class="w-10 h-10 rounded bg-primary text-on-primary flex items-center justify-center font-label-md text-label-md font-semibold flex-shrink-0">${esc(initials)}</div>
                <div class="min-w-0 flex-1">
                    <h4 class="font-title-md text-title-md text-on-surface truncate">${esc(worker.name)}</h4>
                    <p class="font-body-md text-[13px] leading-[18px] text-outline mt-0.5">${esc(worker.service)} &middot; ${esc(worker.distance_km)} km away</p>
                </div>
                ${worker.verification === 'Verified' ? '<span class="stamp flex-shrink-0 mt-0.5">Verified</span>' : ''}
            </div>

            <dl class="flex items-baseline gap-6 mt-4 pt-4 border-t border-outline-variant">
                <div>
                    <dt class="eyebrow">Rating</dt>
                    <dd class="figure rating-value text-[17px] mt-1">${esc(worker.rating)}<span class="text-[13px]">&#9733;</span></dd>
                </div>
                <div>
                    <dt class="eyebrow">Jobs done</dt>
                    <dd class="figure text-[17px] text-on-surface mt-1">${esc(worker.jobs_done)}</dd>
                </div>
                <div class="ml-auto text-right">
                    <dt class="eyebrow">From</dt>
                    <dd class="figure money text-[17px] mt-1">${rupee}${esc(worker.price_from)}</dd>
                </div>
            </dl>

            <div class="mt-4">
                ${busy
                    ? `<button class="btn btn-secondary w-full" disabled type="button">Not available right now</button>`
                    : `<button class="book-now btn btn-outline w-full" data-worker-id="${esc(worker.id)}" type="button">Book ${esc(worker.name.trim().split(/\s+/)[0])}</button>`}
            </div>
        </article>`;
    }

    /* States share one shape with the landing page: a line of bold text, a
       line of instruction, no centred illustration. They span the grid. */
    function state(title, body, isError) {
        return `
            <div class="state sm:col-span-2 xl:col-span-3${isError ? ' state-error' : ''}">
                <p class="state-title">${esc(title)}</p>
                <p class="state-body max-w-[56ch]">${esc(body)}</p>
            </div>`;
    }

    function visible() {
        const query = filters.query.trim().toLowerCase();
        return allWorkers.filter((w) =>
            (filters.services.size === 0 || filters.services.has(w.service)) &&
            Number(w.rating) >= filters.minRating &&
            Number(w.price_from) <= filters.maxPrice &&
            (!filters.availableOnly || w.availability === 'Available') &&
            // A typed search matches either the person or the trade, so both
            // "sunita" and "plumb" find something.
            (query === '' ||
             String(w.name).toLowerCase().includes(query) ||
             String(w.service).toLowerCase().includes(query))
        );
    }

    function render() {
        const list = visible();
        const query = filters.query.trim();
        cards.innerHTML = list.length
            ? list.map(card).join('')
            : state(
                query ? `Nothing matches "${query}"` : 'No workers match these filters',
                query
                    ? 'Try a trade instead of a name — "electrician", "plumber" — or clear the search to see everyone.'
                    : 'Try widening the price range, lowering the minimum rating, or turning off "Only workers free right now".'
            );

        // Say out loud what the list is currently showing, so a filter never
        // looks like it silently did nothing.
        if (heading) {
            const chosen = Array.from(filters.services);
            if (query) {
                heading.textContent = `${list.length} match${list.length === 1 ? '' : 'es'} for "${query}"`;
            } else if (chosen.length === 1) {
                heading.textContent = `${chosen[0]}s near you (${list.length})`;
            } else if (chosen.length > 1) {
                heading.textContent = `${list.length} workers across ${chosen.length} trades`;
            } else {
                heading.textContent = `Workers near you (${list.length})`;
            }
        }
        if (clearSearchButton) clearSearchButton.classList.toggle('hidden', !query);
        highlightCategories();
    }

    function reveal() {
        if (skeletons) skeletons.classList.add('hidden');
        cards.classList.remove('hidden');
    }

    cards.addEventListener('click', (event) => {
        const button = event.target.closest('.book-now');
        if (button) {
            window.location.href = `booking.html?workerId=${encodeURIComponent(button.dataset.workerId)}`;
        }
    });

    /* ------------------------------ filters ----------------------------- */

    /* --------------------- service category shortcuts -------------------- */
    // These used to be four hardcoded "Repairs / Wellness / Cleaning / Moving"
    // tiles that did nothing, and none of those names matched a real service in
    // the database. They are now built from /api/services and act as one-click
    // filters.
    //
    // They also used to be 200px-tall cards with a coloured circle and a
    // 32px icon each, rotating through four accent tints — a whole band of the
    // page spent on six words. A filter is a control, not content, so they are
    // now one row of toggles the height of a button. The count is the only
    // extra information they carried, and it is still here.

    function buildServiceCards(services) {
        if (!categoryGrid) return;
        categoryGrid.innerHTML = services.map((service) => `
            <button aria-pressed="false" class="service-tile chip" data-service="${esc(service.name)}" type="button">
                ${esc(service.name)}
                <span class="chip-count">${esc(service.worker_count)}</span>
            </button>`).join('');

        categoryGrid.addEventListener('click', (event) => {
            const tile = event.target.closest('.service-tile');
            if (!tile) return;
            const name = tile.dataset.service;

            // Clicking the service you already picked clears it — a toggle.
            if (filters.services.size === 1 && filters.services.has(name)) {
                filters.services = new Set();
            } else {
                filters.services = new Set([name]);
            }
            // A service with only busy workers would otherwise look empty.
            filters.availableOnly = false;
            if (availableInput) availableInput.checked = false;

            syncDrawer();
            render();
            if (workersSection) workersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    /** Show which trade is currently driving the list. */
    function highlightCategories() {
        if (!categoryGrid) return;
        categoryGrid.querySelectorAll('.service-tile').forEach((tile) => {
            tile.setAttribute('aria-pressed', String(filters.services.has(tile.dataset.service)));
        });
    }

    /** Push the current filter state back into the drawer's controls. */
    function syncDrawer() {
        if (categoryBox) {
            categoryBox.querySelectorAll('.filter-service').forEach((input) => {
                input.checked = filters.services.has(input.value);
            });
        }
    }

    /* ------------------------ filter drawer controls --------------------- */

    function buildCategories(services) {
        if (!categoryBox) return;
        // The chip row above is single-select; this list is how you combine two
        // trades, so it stays a checkbox list. Counts are right-aligned so they
        // form a column you can read down.
        categoryBox.innerHTML = services.map((s) => `
            <label class="flex items-center gap-3 cursor-pointer py-1">
                <input class="filter-service form-checkbox h-[18px] w-[18px] text-primary rounded-sm border-outline focus:ring-primary focus:ring-offset-0" type="checkbox" value="${esc(s.name)}"/>
                <span class="font-body-md text-body-md text-on-surface">${esc(s.name)}</span>
                <span class="figure text-[13px] text-outline ml-auto">${esc(s.worker_count)}</span>
            </label>`).join('');

        categoryBox.addEventListener('change', () => {
            filters.services = new Set(
                Array.from(categoryBox.querySelectorAll('.filter-service:checked')).map((i) => i.value)
            );
        });
    }

    if (ratingBox) {
        ratingBox.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-rating]');
            if (!button) return;
            filters.minRating = Number(button.dataset.rating);
            // Five toggled Tailwind classes became one attribute; the pressed
            // look for a .chip lives in css/style.css.
            ratingBox.querySelectorAll('button[data-rating]').forEach((b) => {
                b.setAttribute('aria-pressed', String(b === button));
            });
        });
    }

    if (priceInput) {
        priceInput.addEventListener('input', () => {
            filters.maxPrice = Number(priceInput.value);
            if (priceLabel) {
                priceLabel.textContent = filters.maxPrice >= 2000 ? `${rupee}2000+` : `${rupee}${filters.maxPrice}`;
            }
        });
    }

    if (availableInput) {
        availableInput.addEventListener('change', () => { filters.availableOnly = availableInput.checked; });
    }

    if (applyButton) {
        applyButton.addEventListener('click', () => { render(); toggleFilters(); });
    }

    if (resetButton) {
        resetButton.addEventListener('click', () => {
            filters.services = new Set();
            filters.minRating = 0;
            filters.maxPrice = 2000;
            filters.availableOnly = true;
            filters.query = '';
            if (searchInput) searchInput.value = '';

            if (categoryBox) categoryBox.querySelectorAll('.filter-service').forEach((i) => { i.checked = false; });
            if (priceInput) priceInput.value = 2000;
            if (priceLabel) priceLabel.textContent = `${rupee}2000+`;
            if (availableInput) availableInput.checked = true;
            if (ratingBox) {
                const any = ratingBox.querySelector('button[data-rating="0"]');
                if (any) any.click();
            }
            render();
        });
    }

    /* ------------------------------- search ------------------------------ */

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filters.query = searchInput.value;
            // A typed name is a wider intent than the "available only" default,
            // so searching looks through busy workers too.
            if (filters.query.trim()) {
                filters.availableOnly = false;
                if (availableInput) availableInput.checked = false;
            }
            render();
        });
        // Enter should not submit anything or reload the page.
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') event.preventDefault();
        });
    }

    if (clearSearchButton) {
        clearSearchButton.addEventListener('click', () => {
            filters.query = '';
            if (searchInput) {
                searchInput.value = '';
                searchInput.focus();
            }
            render();
        });
    }

    /* ------------------------- page-level buttons ------------------------ */

    if (viewAllButton) {
        viewAllButton.addEventListener('click', () => {
            filters.services = new Set();
            filters.availableOnly = false;
            if (availableInput) availableInput.checked = false;
            syncDrawer();
            render();
            if (workersSection) workersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    // "Book a Service" has no separate page to go to — booking starts by picking
    // a worker, so it takes you to the list.
    if (bookButton) {
        bookButton.addEventListener('click', () => {
            if (workersSection) workersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    /* -------------------------------- boot ------------------------------ */

    (async () => {
        try {
            const [workers, services] = await Promise.all([
                API.workers.list({ sort: 'rating' }),
                API.services.list()
            ]);
            allWorkers = workers;
            buildCategories(services);
            buildServiceCards(services);

            // Arriving from another page with ?service=Plumber pre-applies it.
            const params = new URLSearchParams(window.location.search);
            const wanted = params.get('service');
            if (wanted && services.some((s) => s.name === wanted)) {
                filters.services = new Set([wanted]);
                filters.availableOnly = false;
                if (availableInput) availableInput.checked = false;
                syncDrawer();
            }

            // ?q=electrician comes from the search box on the landing page.
            const typed = (params.get('q') || '').trim();
            if (typed) {
                // If what they typed is actually a service name, treat it as the
                // stronger signal and filter by the service instead.
                const match = services.find((s) => s.name.toLowerCase() === typed.toLowerCase());
                if (match) {
                    filters.services = new Set([match.name]);
                    syncDrawer();
                } else {
                    filters.query = typed;
                    if (searchInput) searchInput.value = typed;
                }
                filters.availableOnly = false;
                if (availableInput) availableInput.checked = false;
            }
            render();
        } catch (err) {
            if (categoryGrid) categoryGrid.innerHTML = '';
            if (heading) heading.textContent = 'Workers near you';
            cards.innerHTML = state('Could not load the register', err.message, true);
        } finally {
            reveal();
        }
    })();
});
