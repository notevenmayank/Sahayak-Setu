(function () {
    const storageKey = 'sahayakSetuTheme';

    function getTheme() {
        const savedTheme = localStorage.getItem(storageKey);
        if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('light', !isDark);
        document.documentElement.dataset.theme = theme;
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            const icon = button.querySelector('.material-symbols-outlined');
            if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
            button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
            button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        });
    }

    applyTheme(getTheme());

    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'theme-toggle';
        toggle.setAttribute('data-theme-toggle', '');
        toggle.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true"></span>';

        const mainHeader = document.querySelector('main > header');
        const desktopHeader = document.querySelector('header > div');
        let target;
        if (mainHeader) {
            target = mainHeader.lastElementChild?.tagName === 'DIV' ? mainHeader.lastElementChild : mainHeader;
        } else if (desktopHeader) {
            target = desktopHeader.lastElementChild?.tagName === 'DIV' ? desktopHeader.lastElementChild : desktopHeader;
        } else {
            target = document.querySelector('main') || document.body;
            toggle.classList.add('theme-toggle-floating');
        }
        target.appendChild(toggle);

        const mobileNav = Array.from(document.querySelectorAll('nav')).find((nav) => nav.classList.contains('fixed') && nav.classList.contains('md:hidden'));
        if (mobileNav && !mobileNav.contains(toggle)) {
            const mobileToggle = toggle.cloneNode(true);
            mobileToggle.classList.add('theme-toggle-mobile');
            mobileNav.appendChild(mobileToggle);
        }

        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            button.addEventListener('click', () => {
                const nextTheme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
                localStorage.setItem(storageKey, nextTheme);
                applyTheme(nextTheme);
            });
        });
        applyTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });
})();
