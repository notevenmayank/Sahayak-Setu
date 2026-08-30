/**
 * js/landing.js — the public landing page.
 *
 * What used to be at the top of this file: a 100-line WebGL fragment shader
 * painting a blue/green gradient behind the hero, and a Three.js scene
 * rotating five spheres, both running requestAnimationFrame forever. They
 * carried no information, cost two extra network requests and a live GPU
 * loop, and were the main reason the hero was 921px of empty stage. Both are
 * gone; the hero now shows the rate board instead, which is real data.
 *
 * Also gone: the IntersectionObserver that added .scroll-reveal to ~30
 * elements so each one faded in on scroll.
 */

document.addEventListener('DOMContentLoaded', () => {
    const rupee = String.fromCharCode(8377);

    let selectedService = null;
    let currentWorkers = [];

    const rosterSection = document.getElementById('services');
    const rateBoard = document.getElementById('rates');
    const findWorkerButton = document.getElementById('find-worker-button');
    const serviceCards = document.querySelectorAll('.service-card');
    const serviceActions = document.getElementById('service-actions');
    const viewWorkersButton = document.getElementById('view-workers-button');
    const nearbyWorkers = document.getElementById('nearby-workers');
    const nearbyWorkersTitle = document.getElementById('nearby-workers-title');
    const workerList = document.getElementById('worker-list');
    const heroSearch = document.getElementById('hero-search');
    const rateNote = document.getElementById('rate-note');
    const footerYear = document.getElementById('footer-year');

    /* The footer used to carry a hardcoded year. */
    if (footerYear) footerYear.textContent = String(new Date().getFullYear());

    /** Escape anything coming from the database before putting it in HTML. */
    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ------------------------- the rate board --------------------------
       The six trades are in the markup so the board is readable without
       JavaScript, but the prices are not: they are the cooperative's real
       base rates, read from /api/services. Inventing them in HTML is how
       the old page ended up showing numbers no database agreed with. */

    async function fillRates() {
        let services;
        try {
            services = await API.services.list();
        } catch (err) {
            if (rateNote) rateNote.textContent = 'Starting rates are unavailable right now. Pick a trade to see workers and their individual prices.';
            return;
        }

        services.forEach((service) => {
            const priceCell = document.querySelector(`[data-rate-price="${CSS.escape(service.name)}"]`);
            if (priceCell) {
                priceCell.textContent = `${rupee}${service.base_price}`;
            }
            const countCell = document.querySelector(`[data-rate-count="${CSS.escape(service.name)}"]`);
            if (countCell) {
                const n = Number(service.worker_count) || 0;
                countCell.textContent = n === 1 ? ' · 1 worker registered' : ` · ${n} workers registered`;
            }
        });
    }

    /* --------------------------- hero search ---------------------------
       Whatever is typed is carried to the dashboard, which filters on it.
       An empty box scrolls to the rate board, which is the next decision
       the visitor has to make. */

    function runHeroSearch() {
        const typed = heroSearch ? heroSearch.value.trim() : '';
        if (typed) {
            window.location.href = `dashboard.html?q=${encodeURIComponent(typed)}`;
            return;
        }
        (rateBoard || rosterSection).scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    findWorkerButton.addEventListener('click', runHeroSearch);

    if (heroSearch) {
        heroSearch.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runHeroSearch();
            }
        });
    }

    /* ------------------------- choosing a trade ------------------------
       Selection used to be three Tailwind classes toggled on and off (a
       ring, a ring colour, a tinted background). It is now one attribute;
       the pressed look lives in css/style.css with the rest of the board.

       Clicking a line now loads the roster straight away. It used to only
       reveal a second button that you then had to press to see anybody —
       two clicks, and the first one produced no visible result. */

    serviceCards.forEach((card) => {
        card.addEventListener('click', () => {
            selectedService = card.dataset.service;
            serviceCards.forEach((item) => {
                item.setAttribute('aria-pressed', String(item === card));
            });
            serviceActions.classList.remove('hidden');
            viewWorkersButton.textContent = `Browse all ${selectedService.toLowerCase()}s`;
            loadRoster(selectedService);
        });
    });

    /* The board's footer action goes to the full directory, where the same
       list can be narrowed by price, rating and availability. */
    viewWorkersButton.addEventListener('click', () => {
        if (!selectedService) return;
        window.location.href = `dashboard.html?service=${encodeURIComponent(selectedService)}`;
    });

    /* ---------------------------- states -------------------------------
       Empty, loading and error all share one shape: a heading, a line of
       explanation, and nothing else. No centred illustration. */

    function state(title, body, isError) {
        return `
            <div class="state${isError ? ' state-error' : ''}">
                <p class="state-title">${esc(title)}</p>
                <p class="state-body max-w-[58ch]">${esc(body)}</p>
            </div>`;
    }

    function loadingRoster() {
        const row = `
            <div class="ledger-row flex items-center gap-5">
                <div class="flex-1">
                    <span class="shimmer" style="display:block;width:38%;height:16px"></span>
                    <span class="shimmer" style="display:block;width:62%;height:12px;margin-top:8px"></span>
                </div>
                <span class="shimmer" style="width:56px;height:16px"></span>
            </div>`;
        return `<div class="ledger" aria-busy="true">${row.repeat(3)}</div>`;
    }

    /* -------------------------- worker roster --------------------------
       A register, not a grid of cards: rows separated by a hairline, with
       the price set in the same brass tabular figures as the rate board so
       the two read as one document. The dashboard uses cards, because
       there you are comparing across many trades at once.

       The old stylesheet printed the word "Verified" on every single row
       via a ::before rule, whether or not the worker was. The stamp below
       is only rendered when the database says Verified. */

    function workerRow(worker) {
        const busy = worker.availability !== 'Available';
        const meta = [
            esc(worker.service),
            `<span class="rating-value">${esc(worker.rating)}&#9733;</span>`,
            `${esc(worker.distance_km)} km away`,
            `${esc(worker.jobs_done)} jobs done`
        ].join(' &middot; ');

        return `
            <div class="ledger-row flex flex-wrap sm:flex-nowrap items-baseline gap-x-6 gap-y-3">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-3 flex-wrap">
                        <h3 class="font-title-md text-title-md text-on-surface">${esc(worker.name)}</h3>
                        ${worker.verification === 'Verified' ? '<span class="stamp">Verified</span>' : ''}
                    </div>
                    <p class="rate-row-meta">${meta}</p>
                </div>
                <p class="figure money text-[17px] whitespace-nowrap">${rupee}${esc(worker.price_from)}<span class="font-body-md text-[13px] text-outline"> from</span></p>
                ${busy
                    ? `<span class="badge badge-wait flex-shrink-0">Unavailable</span>`
                    : `<button class="book-now-button btn btn-primary btn-sm flex-shrink-0" data-worker-id="${esc(worker.id)}" type="button">Book</button>`}
            </div>`;
    }

    function renderRoster(workers) {
        return `<div class="ledger">${workers.map(workerRow).join('')}</div>`;
    }

    /** Fetch and draw the roster for one trade. */
    async function loadRoster(service) {
        nearbyWorkersTitle.textContent = `${service}s near you`;
        workerList.innerHTML = loadingRoster();

        try {
            currentWorkers = await API.workers.list({ service, sort: 'rating' });
            workerList.innerHTML = currentWorkers.length
                ? renderRoster(currentWorkers)
                : state(
                    `No ${service.toLowerCase()} registered yet`,
                    'Nobody has joined the cooperative for this trade in your area. Try another trade, or browse the full directory.'
                );
        } catch (err) {
            workerList.innerHTML = state('Could not load workers', err.message, true);
        }

        // Only scroll once the list has something in it, so the page does not
        // jump to a skeleton and then resize under the reader.
        nearbyWorkers.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    workerList.addEventListener('click', (event) => {
        const bookButton = event.target.closest('.book-now-button');
        if (bookButton) {
            // Only the id travels in the URL; booking.html loads the rest from
            // the API, so the price cannot be tampered with by hand.
            window.location.href = `booking.html?workerId=${encodeURIComponent(bookButton.dataset.workerId)}`;
        }
    });

    /* ------------------------------- boot ------------------------------ */

    workerList.innerHTML = state(
        'Pick a trade to see who is nearby',
        'Choose a line on the rate board above and the cooperative’s workers for that trade will be listed here, closest and best-rated first.'
    );

    fillRates();
});
