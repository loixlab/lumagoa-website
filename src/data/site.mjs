// Site-wide constants. Shared with every page template via the `data` field
// in vite.config.mjs (EJS locals: `siteUrl`, `email`, `phone.*`, `waHref`),
// and imported by src/ts/email-link.ts for the runtime-assembled address.

// Single source of truth for the canonical origin (no trailing slash); the
// email domain is derived from it.
export const SITE_URL = "https://lumagoa.com";
const SITE_DOMAIN = new URL(SITE_URL).hostname;

// Kept as parts so the client bundle can assemble the address at runtime
// (email-link.ts) without the literal appearing in the shipped JS or HTML.
export const EMAIL_PARTS = ["contact", SITE_DOMAIN];

// Build-time only — used where the address is deliberately public (JSON-LD).
export const EMAIL = EMAIL_PARTS.join("@");

// Single source of truth for the phone number. wa.me and tel: URLs need the
// digits-only form (country code included, no "+" or spaces).
export const PHONE_DISPLAY = "+91 808 772 34 55";
const PHONE_DIGITS = PHONE_DISPLAY.replace(/\D/g, "");

/** wa.me link with a prefilled message. */
export function waHref(message) {
  return `https://wa.me/${PHONE_DIGITS}?text=${encodeURIComponent(message)}`;
}

// Guest-facing prices referenced in more than one place (INR) — one source
// so a seasonal price change can't leave a stale copy behind. Both render
// on /yoga in the Prices block and in the JSON-LD offer catalog. The drop-in
// price is also the default class price: what a class's own Price in the
// schedule sheet is compared against (src/data/load-yoga-schedule.mjs shows
// a price on the card only when it differs) and the JSON-LD Event offer of
// every class without one.
export const PRICES = { soundBath: 1200, dropIn: 600 };

/** EJS locals injected into every page. */
export const sitePageData = {
  siteUrl: SITE_URL,
  email: EMAIL,
  phone: {
    display: PHONE_DISPLAY,
    tel: `+${PHONE_DIGITS}`,
    wa: `https://wa.me/${PHONE_DIGITS}`,
  },
  waHref,
  prices: PRICES,
};
