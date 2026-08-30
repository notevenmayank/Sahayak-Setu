/**
 * js/booking.js — the booking form.
 *
 * Before: the worker's name and price arrived in the URL and the booking was
 * pushed into localStorage, so booking IDs collided and the price could be
 * edited by hand in the address bar.
 *
 * Now: only ?workerId= travels in the URL, the worker's real details are
 * fetched from the API, and the booking is created server-side.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const rupee = String.fromCharCode(8377);

    const form = document.getElementById('booking-form');
    const bookingContent = document.getElementById('booking-content');
    const bookingConfirmation = document.getElementById('booking-confirmation');
    const preferredDate = document.getElementById('preferred-date');
    const preferredTime = document.getElementById('preferred-time');
    const submitButton = form.querySelector('button[type="submit"]');

    const workerId = new URLSearchParams(window.location.search).get('workerId');
    let worker = null;

    /* ---------------------------- messages ----------------------------
       The alert used to be built from six Tailwind classes here and slightly
       different ones on every other page. It now uses the shared .notice
       shape from css/style.css. */

    const alertBox = document.createElement('div');
    alertBox.className = 'notice notice-error hidden mb-6';
    alertBox.setAttribute('role', 'alert');
    form.prepend(alertBox);

    function showError(message) {
        alertBox.textContent = message;
        alertBox.classList.remove('hidden');
        alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function clearError() {
        alertBox.classList.add('hidden');
    }

    /* ------------------------- load the worker ------------------------- */

    function renderWorker(w) {
        document.getElementById('worker-name').textContent = w.name;
        document.getElementById('worker-service').textContent =
            w.verification === 'Verified' ? `${w.service} · Verified` : w.service;
        document.getElementById('worker-rating').textContent = `${w.rating} ${String.fromCharCode(9733)}`;
        document.getElementById('worker-distance').textContent = `${w.distance_km} km`;
        // The row is already labelled "Starting price", so the value is just
        // the number — the label does not need saying twice.
        document.getElementById('worker-price').textContent = `${rupee}${w.price_from}`;
    }

    if (!workerId) {
        showError('No worker was selected. Please go back and choose a worker.');
        submitButton.disabled = true;
        return;
    }

    try {
        const data = await API.workers.byId(workerId);
        worker = data.worker;
        renderWorker(worker);
        if (worker.availability !== 'Available') {
            showError(`${worker.name} is currently unavailable. Please pick another worker.`);
            submitButton.disabled = true;
        }
    } catch (err) {
        showError(err.message);
        submitButton.disabled = true;
        return;
    }

    /* -------------------- prefill for a logged-in user ----------------- */

    if (API.session.isLoggedIn) {
        const user = API.session.user;
        if (user.name) document.getElementById('customer-name').value = user.name;
        if (user.phone) document.getElementById('mobile-number').value = user.phone;
    }

    /* ----------------------------- slots ------------------------------ */

    const today = new Date().toISOString().split('T')[0];
    preferredDate.min = today;

    async function loadSlots() {
        const date = preferredDate.value;
        if (!date) {
            preferredTime.innerHTML = '<option value="">Pick a date first</option>';
            return;
        }
        preferredTime.innerHTML = '<option value="">Loading…</option>';
        try {
            const slots = await API.bookings.slots(worker.id, date);
            const free = slots.filter((s) => s.available);
            preferredTime.innerHTML = free.length
                ? '<option value="">Select a time</option>' +
                  free.map((s) => `<option value="${s.time}">${s.time}</option>`).join('')
                : '<option value="">No slots left on this date</option>';
        } catch (err) {
            preferredTime.innerHTML = '<option value="">Could not load slots</option>';
            showError(err.message);
        }
    }

    preferredDate.addEventListener('change', () => { clearError(); loadSlots(); });

    /* ----------------------------- submit ----------------------------- */

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearError();

        const payload = {
            workerId: worker.id,
            customerName: document.getElementById('customer-name').value.trim(),
            mobileNumber: document.getElementById('mobile-number').value.trim(),
            serviceAddress: document.getElementById('service-address').value.trim(),
            preferredDate: preferredDate.value,
            preferredTime: preferredTime.value,
            additionalInstructions: document.getElementById('additional-instructions').value.trim()
        };

        // Friendly checks first; the server validates all of this again.
        if (payload.customerName.length < 2) return showError('Please enter your name.');
        if (!/^[0-9]{10}$/.test(payload.mobileNumber)) return showError('Please enter a valid 10-digit mobile number.');
        if (payload.serviceAddress.length < 8) return showError('Please enter the full service address.');
        if (!payload.preferredDate) return showError('Please choose a preferred date.');
        if (!payload.preferredTime) return showError('Please choose a time slot.');

        submitButton.disabled = true;
        const originalLabel = submitButton.textContent;
        submitButton.textContent = 'Sending…';

        try {
            const booking = await API.bookings.create(payload);

            document.getElementById('confirmation-id').textContent = booking.code;
            document.getElementById('confirmation-worker').textContent = booking.worker ? booking.worker.name : worker.name;
            document.getElementById('confirmation-service').textContent = booking.service;
            document.getElementById('confirmation-datetime').textContent =
                `${booking.preferredDate} · ${booking.preferredTime}`;
            document.getElementById('confirmation-amount').textContent = `${rupee}${booking.amount}`;
            document.getElementById('confirmation-status').textContent = 'Waiting on the worker';

            bookingContent.classList.add('hidden');
            bookingConfirmation.classList.remove('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showError(err.message);
            // A slot clash means someone booked it first — refresh the list.
            if (err.status === 409) loadSlots();
            submitButton.disabled = false;
            submitButton.textContent = originalLabel;
        }
    });

    /* Payment is not built yet, so this button says what actually happens
       instead of pretending to take money. */
    const payNow = document.getElementById('pay-now-button');
    if (payNow) {
        payNow.addEventListener('click', () => {
            payNow.disabled = true;
            payNow.textContent = 'Pay the worker directly after the job';
        });
    }
});
