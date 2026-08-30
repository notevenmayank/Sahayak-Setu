/**
 * Design tokens for SahayakSetu.
 *
 * There is no build step — Tailwind runs from the CDN and reads this object at
 * load time. So this file is the single source of truth for colour, type and
 * spacing. Change a value here and it changes everywhere.
 *
 * The names below (primary, surface-container, on-surface…) come from the
 * original Material 3 export and are used by every page, so they are kept as-is
 * even though the values behind them are new. Renaming them would mean editing
 * a few thousand class attributes for no visual gain.
 *
 * The palette is a cooperative rate-board: pine green for the organisation,
 * brass reserved for money, ratings and verification, brick for errors only,
 * on cool paper. Nothing else is coloured.
 */
tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                /* --- brand ------------------------------------------------ */
                // Pine: the cooperative itself. Buttons, links, active nav.
                "primary": "#1f5140",
                "on-primary": "#ffffff",
                "primary-container": "#1f5140",
                "on-primary-container": "#ffffff",
                "primary-fixed": "#dfe9e4",       // tint behind pine text
                "primary-fixed-dim": "#bcd2c9",
                "on-primary-fixed": "#123027",
                "on-primary-fixed-variant": "#2c6b56",
                "inverse-primary": "#8fc0ad",
                "surface-tint": "#1f5140",

                /* --- accent ----------------------------------------------- */
                // Brass: money, star ratings, the verification stamp. Nothing else.
                "secondary": "#8a6209",
                "on-secondary": "#ffffff",
                "secondary-container": "#f4ead3",
                "on-secondary-container": "#6b4b06",
                "secondary-fixed": "#f4ead3",
                "secondary-fixed-dim": "#e3d2ac",
                "on-secondary-fixed": "#4a3404",
                "on-secondary-fixed-variant": "#6b4b06",

                /* --- quiet third ------------------------------------------ */
                // Slate: neutral informational marks. Deliberately unsaturated.
                "tertiary": "#4a5b6a",
                "on-tertiary": "#ffffff",
                "tertiary-container": "#e6eaee",
                "on-tertiary-container": "#33414d",
                "tertiary-fixed": "#e6eaee",
                "tertiary-fixed-dim": "#c8d1d8",
                "on-tertiary-fixed": "#33414d",
                "on-tertiary-fixed-variant": "#5c6d7c",

                /* --- text ------------------------------------------------- */
                "on-surface": "#1f211d",          // ink
                "on-background": "#1f211d",
                "on-surface-variant": "#6a6a62",  // secondary text
                "outline": "#7d7d74",             // captions, meta
                "outline-variant": "#dcdcd3",     // hairlines

                /* --- ground ----------------------------------------------- */
                "background": "#f4f4ef",          // paper
                "surface": "#f4f4ef",
                "surface-bright": "#fbfbf8",
                "surface-dim": "#e6e6de",
                "surface-container-lowest": "#ffffff",
                "surface-container-low": "#faf9f6",
                "surface-container": "#eeeee7",
                "surface-container-high": "#e6e6de",
                "surface-container-highest": "#dedeD5",
                "surface-variant": "#dcdcd3",
                "inverse-surface": "#1f211d",
                "inverse-on-surface": "#f4f4ef",

                /* --- state ------------------------------------------------ */
                "error": "#9c2f22",
                "on-error": "#ffffff",
                "error-container": "#f7e3e0",
                "on-error-container": "#7a251a"
            },

            /* Printed-card corners, not pill-shaped app chrome. `full` is kept
               because avatars and true pills (status badges) still need it. */
            borderRadius: {
                "DEFAULT": "2px",
                "sm": "2px",
                "md": "4px",
                "lg": "4px",
                "xl": "6px",
                "2xl": "8px",
                "full": "9999px"
            },

            /* A 4px base with two deliberate jumps: `section` for the gap
               between major bands, `margin-desktop` for page gutters. Sections
               are not all equally tall — that is the point. */
            spacing: {
                "xs": "4px",
                "sm": "12px",
                "base": "8px",
                "md": "20px",
                "gutter": "20px",
                "lg": "36px",
                "xl": "64px",
                "section": "56px",
                "margin-mobile": "20px",
                "margin-desktop": "48px"
            },

            /* Two families only.
               Bitter — a slab serif built for screens; the register of stencilled
                        trade signage and printed tariff boards. Headings only.
               Karla  — a grotesque with slightly odd, humane letterforms; reads
                        cleanly at 13px in a table. Everything else. */
            fontFamily: {
                "display-lg": ["Bitter", "Georgia", "serif"],
                "headline-lg": ["Bitter", "Georgia", "serif"],
                "headline-lg-mobile": ["Bitter", "Georgia", "serif"],
                "title-md": ["Bitter", "Georgia", "serif"],
                "body-lg": ["Karla", "system-ui", "sans-serif"],
                "body-md": ["Karla", "system-ui", "sans-serif"],
                "label-md": ["Karla", "system-ui", "sans-serif"],
                "label-sm": ["Karla", "system-ui", "sans-serif"]
            },

            /* Headings sit at 500/600, never 700+. Hierarchy comes from size,
               colour and space — shouting at every level flattens it. */
            fontSize: {
                "display-lg": ["40px", { lineHeight: "46px", letterSpacing: "-0.015em", fontWeight: "500" }],
                "headline-lg": ["27px", { lineHeight: "34px", letterSpacing: "-0.008em", fontWeight: "500" }],
                "headline-lg-mobile": ["23px", { lineHeight: "30px", letterSpacing: "-0.005em", fontWeight: "500" }],
                "title-md": ["18px", { lineHeight: "25px", fontWeight: "600" }],
                "body-lg": ["17px", { lineHeight: "27px", fontWeight: "400" }],
                "body-md": ["15px", { lineHeight: "23px", fontWeight: "400" }],
                "label-md": ["14px", { lineHeight: "20px", fontWeight: "500" }],
                /* The eyebrow: small, spaced, uppercase. Used for section
                   labels and table headers — the one place tracking is wide. */
                "label-sm": ["11px", { lineHeight: "15px", letterSpacing: "0.09em", fontWeight: "600" }]
            }
        }
    }
};
