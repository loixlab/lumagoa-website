# `src/` — Static Site (EJS MPA + Tailwind/DaisyUI + Alpine)

The site is a Vite multi-page app built with `vite-plugin-virtual-mpa`. EJS templates render to static HTML; a single bundled entry (`src/main.ts`) adds Alpine.js interactivity.

## Pages, partials & registration

- **New page `.ejs` files go in `src/pages/`**; reusable snippets in `src/partials/`.
- **Register every new page in `vite.config.mjs`** under the plugin's `pages` array — an unregistered template is silently never built:

  ```js
  {
    name: "page-name",
    template: resolve(__dirname, "src/pages/page-name.ejs"),
    filename: "page-name.html",
  }
  ```

- **EJS includes are resolved from the project root**, not from the including file — always `<%- include('./src/partials/…') %>`, never `../partials/`.
- **`src/data/treatments.json` is owner-approved content.** Apparent inconsistencies with the printed treatment menu (missing therapies, rewritten descriptions, a facial that isn't `holidayEligible`) are deliberate decisions — read [docs/ayurveda-massage-notes.md](../docs/ayurveda-massage-notes.md) before changing the data. `load-treatments.mjs` validates it at build time and fails the build on malformed records or `DRAFT` descriptions.
- **`src/data/reviews.json` feeds the reviews partial.** Entries whose `name` starts with `PLACEHOLDER —` are fabricated stand-ins for layout work — swap in real guest reviews (and drop the prefix) before the section ships; never let placeholder reviews render as genuine testimonials.
- **`src/data/season.mjs` is the single source of truth for the yoga-holiday seasons.** The `SEASONS` list (ordered cheapest first), the date rules behind `resolveSeason()` and the open-season window all live there, and everything derives from them: the pills, the price table, the price invariants, the JSON-LD range, the guest-facing availability string and the client's default season. A `SEASON_RULES` entry with `season: null` is a closure — dates inside the open season that are not sold — and `getAvailableDates()` turns whatever is left into the availability string, so that copy can never advertise dates we don't sell. Adding or dropping a season is one edit there plus its `ROOM_RATES` entry in `load-yoga-holidays.mjs` — rates never go in `season.mjs`, which is bundled into the client. Dropping a season hands its dates to the next matching rule; add a closure if they should stop being sold rather than change tier. The `window` strings are guest-facing copy, so re-check them against `SEASON_RULES` after any calendar change.
- **Every page receives shared build-time locals from `src/data/site.mjs`** (`siteUrl`, `email`, `phone.display`, `phone.tel`, `phone.wa`, `waHref(message)`, `prices.*` for guest-facing prices used on more than one page), merged into each page's `data` by the `.map()` at the end of the `pages` array in `vite.config.mjs`. Use them instead of hardcoding the domain, contact email, phone number, cross-page prices or `wa.me` URLs — `footer.ejs` relies on them, so a page rendered without them fails to build. `email` is for JSON-LD schemas (deliberately public); visible email links must keep using the `emailLink` Alpine component, which assembles the address at runtime from the same `EMAIL_PARTS` constant. The same `.map()` also injects `isProduction` (see the analytics rule below); it lives in `vite.config.mjs` rather than `site.mjs` because `site.mjs` is imported by the client bundle, where `process` doesn't exist.
- **There is no layout partial.** Every page repeats the same skeleton itself, so copy an existing page rather than assembling one from scratch:

  ```ejs
  <!doctype html>
  <html lang="en" data-theme="pastel">
  <%- include('./src/partials/head.ejs', { title: '…', description: '…' }) %>
  <body class="…">
    <%- include('./src/partials/analytics-noscript.ejs') %>
    <%- include('./src/partials/header.ejs') %>
    <main>…</main>
    <%- include('./src/partials/footer.ejs') %>
    <%- include('./src/partials/whatsapp-float.ejs', { message: '…', label: '…' }) %>
    <script type="module" src="/src/main.ts"></script>
  </body>
  </html>
  ```

- **The WhatsApp float is a partial** (`src/partials/whatsapp-float.ejs`) — the round button pinned bottom-right, included after the footer on every main guest-facing page (`/`, `/yoga-shala`, `/yoga-holidays`, `/ayurveda-massage`, `/cafe-restaurant`, `/gallery`). Required locals: `message` (the plain prefilled sentence; the partial runs it through `waHref()`) and `label` (its `aria-label` — the button carries no visible text). Every float also passes `component` (the Alpine tracking component) and `track` (the `@click` expression), keeping the `whatsapp_float` cta_location so all of them report the same slot: `/ayurveda-massage` and `/yoga-holidays` use their own funnel components, the rest use `whatsappTracking` (the generic `whatsapp_enquiry` event). `/yoga-shala` is the one float that reports nothing — it has neither a funnel of its own nor an `enquiry_source`. Never paste the markup inline again. The transactional and legal pages (`/booking`, `/deposit-payment`, `/payment-success`, `/terms-and-services`, `/privacy-policy`) have no float, and neither does the `/winter-renewal` promo page.
- **Forgetting `<script type="module" src="/src/main.ts">` silently kills Alpine on that page.** Nothing injects it — the page is just inert, with no build error.
- **Add every new public page to `public/sitemap.xml`** (hand-maintained), and to `public/robots.txt` if it should be excluded — `/deposit-payment` and `/payment-success` are `Disallow`ed there.

## `head.ejs` parameters

`title` and `description` are **required**; the rest are optional and guarded with `typeof … !== 'undefined'`:

| Param                      | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `title`, `description`     | `<title>` + meta description (required)                               |
| `ogTitle`, `ogDescription` | Open Graph / Twitter overrides; default to `title` / `description`    |
| `extraMeta`                | Raw markup for per-page `og:url`, `og:image`, `twitter:*` tags        |
| `extraContent`             | Raw markup for `<head>` — this is where `<link rel="canonical">` goes |
| `schemaData`               | JSON-LD, `JSON.stringify`'d into the page                             |

- **`schemaData` must be a single object.** `head.ejs` already wraps the output in a JSON-LD array (`[ … ]`), so passing an array emits a nested `[[…]]` and the whole block becomes invalid.
- **GTM and the Meta Pixel only load in production**, behind two layers: `head.ejs` emits both snippets only when the `isProduction` local is true (`process.env.CONTEXT === "production"`, set in `vite.config.mjs` and injected into every page), and each snippet returns early on `*.netlify.app` hostnames — the production build is also served from Netlify deploy URLs (deploy permalinks, branch/PR previews) and those visits must not pollute analytics. `yarn dev` and a plain local `yarn build` therefore ship no analytics at all. The matching `<noscript>` fallbacks live in `src/partials/analytics-noscript.ejs`, included as the first thing inside every page's `<body>` — they are body-only tags, so they cannot live in `head.ejs`, and they carry the build-time guard only (a `<noscript>` can't check the hostname). That partial is also the single home for the GTM container id and the pixel id outside `head.ejs`; don't paste either into a page.
- **Keep the Meta Pixel's `fbq('init')`/`fbq('track')` calls inside the hostname wrapper** in `head.ejs` — `fbq` doesn't exist when the loader is skipped, so a call left outside throws a `ReferenceError` on every Netlify-hosted page view.

## Styling (Tailwind v4 + DaisyUI 5)

- **Reach for DaisyUI components first** (`btn`, `navbar`, `menu`, `dropdown`, `card`, …); use Tailwind utilities for layout and fine-tuning. DaisyUI reference: `https://daisyui.com/llms.txt`.
- **Tailwind v4 config lives in `src/styles.css`**, not in `tailwind.config.js` — themes (`@plugin "daisyui"`), theme overrides (`@plugin "daisyui/theme"`), the `dark` variant and `@theme` tokens are all CSS. `tailwind.config.js` only carries content globs and the `font-display` family.
- **Two themes: `pastel` (default) and `dim` (dark).** Pages hardcode `data-theme="pastel"` on `<html>`; sections opt into dark locally with `data-theme="dim"` — the footer, the `/yoga-holidays` final CTA, and the reviews partial when passed `theme: 'dark'`. There is no runtime theme switcher.
- **The `dark:` variant is keyed to `[data-theme=dim]`** (`@custom-variant dark`), so it follows that attribute — not the OS setting directly.
- **Brand primary is `--color-primary: #c66f54`.** It is also duplicated as a literal in `src/ts/google-map.ts` (`PRIMARY_BRAND_COLOR`) and in the Razorpay checkout theme in `src/ts/deposit-payment.ts` — those are outside CSS's reach, so change all three together.
- **Brand constants `--color-brand-cream: #f8ebe4` and `--color-brand-gold: #dba848`** live in the `@theme` block of `styles.css` — theme-stable (they keep their value inside `data-theme="dim"` subtrees), usable as any color utility (`bg-brand-cream`, `text-brand-gold`, …).
- **The `dim` theme does not override `--color-primary`**, so `primary` inside a `data-theme="dim"` subtree resolves to daisyUI dim's default, not the brand terracotta — use `secondary`, the brand tokens, or an explicit color for dark accents.
- **Headings use `font-display`** (Libertinus Serif, loaded from Google Fonts at the top of `styles.css`).
- **Keep custom CSS out of `styles.css`** unless it's genuinely unreachable from utilities — what's there now is the Masonry sizer grid and Google Maps InfoWindow overrides.
- **Every component and page is mobile-first and fully responsive.**

## Client TypeScript (`src/ts`) — Alpine.js

- **Single entry `src/main.ts`.** It imports Alpine, calls each `registerXComponents(Alpine)`, then `Alpine.start()`. **Register before `start()`** — a component registered afterwards never binds.
- **There is no per-page routing.** Every component is registered on every page; each one no-ops where no markup references it. A new component is one file in `src/ts/` exporting a `registerXComponents(alpine: typeof Alpine)` function, plus one line in `main.ts`.
- **State and logic live in typed `.ts`** as `alpine.data("name", () => ({ … }))`; the EJS only ever references it via `x-data="name"` (or `x-data="name('arg')"`). Keep logic out of inline `x-data` object literals and out of `<script>` blocks.
- **Pair `x-show` with `x-cloak`** on anything hidden in the initial render. `styles.css` defines `[x-cloak] { display: none !important }`, and Alpine strips the attribute once it evaluates — without it the element flashes before hydration.
- **Ambient types go in `src/types/global.d.ts`** — that's the single home for `Window.Alpine` and `Window.Razorpay` (the latter comes from Razorpay's `checkout.js`, loaded by a plain script tag on the deposit-payment page only).
- **Call functions at `/api/<name>`**, never `/.netlify/functions/…`. Those calls need `yarn dev:netlify`; plain `yarn dev` doesn't serve functions.
- **Analytics events go through the typed helpers in `src/ts/analytics.ts`** — never push to `window.dataLayer` or call `window.fbq` directly from a component. New events get a typed helper there.
- **A page with its own funnel gets its own event; everything else uses `whatsapp_enquiry`.** `/ayurveda-massage` reports `treatment_enquiry` and `/yoga-holidays` reports `yoga_holiday_enquiry`, each with its own id and value fields; the pages without a funnel report the generic `whatsapp_enquiry` with an `enquiry_source` from the `ENQUIRY_SOURCES` union in `analytics.ts`. Adding a page to that union also means adding its Pixel `content_name` to `ENQUIRY_LEAD_NAMES` — the `Record<EnquirySource, string>` type fails the build if you forget.

### The registered components

| `x-data`                            | File                  | Notes                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dailyQuote`                        | `daily-quote.ts`      | Footer quote; picks from `/quotes.json` by day-of-year so everyone sees the same one. The markup's hardcoded quote is the fetch-failure fallback — keep it.                                                                                                                                                                                                                                |
| `masonryGallery('<metadata>.json')` | `gallery.ts`          | Masonry + PhotoSwipe. Takes the metadata filename as its argument.                                                                                                                                                                                                                                                                                                                         |
| `googleMap('<preset>')`             | `google-map.ts`       | Presets (`sanctuary`, `cafe`) and their InfoWindow HTML live in the TS; markup only names the preset. The Maps script is injected once and lazily.                                                                                                                                                                                                                                         |
| `emailLink`                         | `email-link.ts`       | Assembles `contact@lumagoa.com` at runtime so it never appears in the static HTML.                                                                                                                                                                                                                                                                                                         |
| `depositPayment`                    | `deposit-payment.ts`  | The deposit page's four-view state machine (`loading`/`search`/`payment`/`paid`).                                                                                                                                                                                                                                                                                                          |
| `paymentSuccess`                    | `payment-success.ts`  | Reads the params Razorpay's redirect appends.                                                                                                                                                                                                                                                                                                                                              |
| `treatmentFinder`                   | `treatment-finder.ts` | Intent filter on `/ayurveda-massage`: show/hide over the server-rendered menu via `data-intents`/`data-category-group` attributes, with URL-hash sync. The menu is rendered at build time from `src/data/treatments.json`, loaded and validated by `src/data/load-treatments.mjs` in `vite.config.mjs`.                                                                                    |
| `enquiryTracking`                   | `treatment-finder.ts` | Placed on individual treatment CTA anchors to push `treatment_enquiry` events (GTM + Meta Pixel) without inline scripts.                                                                                                                                                                                                                                                                   |
| `seasonSelector`                    | `yoga-holidays.ts`    | Season pills on `/yoga-holidays`. Ids, labels and the default all come from `src/data/season.mjs`; the default is the season containing today, resolved client-side, and it syncs a `#season=` URL hash. Cards render the cheapest season's prices server-side as the no-JS fallback.                                                                                                      |
| `holidayCard(<json>)`               | `yoga-holidays.ts`    | One card's per-season payload (formatted prices, analytics values, WhatsApp hrefs), built by `src/data/load-yoga-holidays.mjs` and passed via `x-data`; bindings read `season` from the enclosing `seasonSelector` scope.                                                                                                                                                                  |
| `holidaysAccordion`                 | `yoga-holidays.ts`    | The "Good to know" accordion on `/yoga-holidays` — real `<button>`s with `aria-expanded`, one panel open at a time.                                                                                                                                                                                                                                                                        |
| `holidayTracking`                   | `yoga-holidays.ts`    | Placed on `/yoga-holidays` CTA anchors to push `yoga_holiday_enquiry` / `view_yoga_holidays` events, carrying the selected season.                                                                                                                                                                                                                                                         |
| `reviews(<count>)`                  | `reviews.ts`          | Behind the reusable guest-reviews partial (`src/partials/reviews.ejs`, includable on any page). Picks `count` (default 4) random entries from `src/data/reviews.json` per page load; the cards form one horizontal snap-scroll row on mobile (never stacked) and flex to fit from `lg` up. Partial EJS locals: `count`, `bg`, `theme` (`'dark'` stamps `data-theme="dim"` on the section). |
| `whatsappTracking`                  | `whatsapp-enquiry.ts` | Placed on the WhatsApp floats of the pages with no funnel of their own (`/`, `/cafe-restaurant`, `/gallery`) to push the generic `whatsapp_enquiry` event (GTM + Meta Pixel `Lead`), carrying an `enquiry_source` (`home` / `cafe` / `gallery`) so the pages stay distinguishable.                                                                                                         |

- **Use `emailLink` for contact-email links** rather than writing the address into markup — that's the whole point of the component (scraper obfuscation).
- **Render URL-supplied values with `x-text`, never `x-html`.** `paymentSuccess` takes the guest name straight from the query string; `x-text` is what stops that from injecting markup.

## Galleries

- Grid links point at the full-size image (`/img/<gallery>/large/NN.jpg`) and the `<img>` at the thumbnail (`/img/<gallery>/524/NN.jpg`).
- **PhotoSwipe needs real pixel dimensions**, which come from a metadata JSON in `public/` keyed by the link's `href`. `gallery.ts` warns per unmatched image and the lightbox misbehaves for it.
- **Adding gallery images means regenerating that JSON** — see [scripts/CLAUDE.md](../scripts/CLAUDE.md). The two galleries have separate files: `gallery-img-metadata.json` and `gallery-shala-img-metadata.json`.

## Verification checklist

- [ ] New page in `src/pages/`, partials in `src/partials/`, registered in `vite.config.mjs`.
- [ ] Page includes `head.ejs` (with `title` + `description`), `analytics-noscript.ejs` as the first thing in `<body>`, header/footer, and the `main.ts` module script.
- [ ] `schemaData` passed as a single object; canonical link via `extraContent`; page added to `public/sitemap.xml`.
- [ ] DaisyUI-first, mobile-first responsive.
- [ ] Client logic in `src/ts` as a registered Alpine component; `x-cloak` on anything `x-show`n; endpoints under `/api/*`.
- [ ] `yarn typecheck` is clean.
