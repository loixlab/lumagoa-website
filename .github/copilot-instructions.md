# LUMA Goa Website — Project Guidelines

This repo is the **marketing website** for LUMA Goa, a boutique yoga resort in Palolem, South Goa (A-frame huts, an open-air yoga shala, and the Roots & Bloom plant-based café). It is a static multi-page site plus two serverless functions that power the **booking-deposit payment** flow. Room bookings themselves go through an embedded third-party engine (Stayflexi) on `/booking`, not through this repo.

This is the universal Copilot file (mirror of the root `CLAUDE.md`). Path-scoped rules live in `.github/instructions/*.instructions.md` (matched by `applyTo:` globs).

## Tech Stack

- **Bundler:** Vite 7 in multi-page mode via `vite-plugin-virtual-mpa` (`createMpaPlugin`).
- **Templating:** EJS. **Styling:** Tailwind CSS v4 (via `@tailwindcss/vite`) + DaisyUI 5 + `@tailwindcss/typography`. **Client interactivity:** Alpine.js.
- **Gallery:** PhotoSwipe (lightbox) + Masonry + imagesLoaded. **Maps:** Google Maps JS API (`marker` library, Advanced Markers).
- **Backend:** Netlify Functions in `netlify/functions/` — **TypeScript ESM, V2 format**.
- **Payments:** Razorpay (INR). **Booking data:** a published Google Sheet read as CSV. **Booking engine:** Stayflexi, embedded as an iframe on `/booking`.
- **Analytics:** Google Tag Manager + Meta Pixel, both inlined in `src/partials/head.ejs` — emitted in production builds only (`process.env.CONTEXT === "production"`), and skipped at runtime on `*.netlify.app` hosts.
- **Tooling scripts:** Python 3 (Pillow, pillow-heif, requests, python-dotenv) in `scripts/`.
- **Package manager:** `yarn`. **No test suite** in this repo.

## Project structure

- `src/pages/*.ejs` — one file per page; **every page must be registered in `vite.config.mjs`**.
- `src/partials/` — `head.ejs`, `header.ejs`, `footer.ejs`, `analytics-noscript.ejs` (the GTM + Meta Pixel `<noscript>` fallbacks, first thing in every page's `<body>`), plus `reviews.ejs` (a self-contained guest-reviews section any page can include, parameterised via EJS locals). There is **no layout wrapper** — each page assembles them itself.
- `src/main.ts` — the single client entry; `src/ts/` — one file per Alpine component; `src/types/global.d.ts` — ambient types.
- `src/styles.css` — Tailwind entry, DaisyUI theme definitions, and the gallery / Google-Maps overrides.
- `netlify/functions/` — `create-order.ts` (Razorpay order) and `get-booking.ts` (booking lookup); `netlify/tsconfig.json` — their own TS project.
- `public/` — static assets served from the site root (`/img/...`, `quotes.json`, the two gallery metadata JSON files, `robots.txt`, `sitemap.xml`).
- `scripts/` — Python image-resizing, gallery-metadata and yoga-schedule tooling. `docs/` — repo/AI docs.

## Commands

- `yarn dev` — Vite dev server (auto-opens the browser). **The functions are not served here** — anything touching `/api/*` needs Netlify dev.
- `yarn dev:netlify` — `netlify dev`: serves the site _and_ the functions, and applies the `netlify.toml` `/api/*` rewrite.
- `yarn build` — production build into `dist/`. `yarn preview` — serve the built output.
- `yarn generate-gallery-metadata` — regenerate `public/gallery-img-metadata.json` from `public/img/gallery/large`.
- `yarn typecheck` — `tsc` for **both** TypeScript projects (`yarn typecheck:src` / `yarn typecheck:netlify` run one).
- `yarn format` — Prettier over the repo. **Run this and `yarn typecheck` before every commit** — CI enforces both.

## Cross-cutting rules (MANDATORY)

- **Register every new page in `vite.config.mjs`.** A `.ejs` file in `src/pages/` that isn't in the plugin's `pages` array is never built. Add `{ name, template: resolve(__dirname, "src/pages/<name>.ejs"), filename: "<name>.html" }`.
- **EJS includes resolve from the project root, not from the including file:** always `<%- include('./src/partials/head.ejs', { … }) %>`, never a relative step like `../partials/`.
- **Use root-relative paths (`/…`) for every asset, link and script** in templates and TS. Assets live in `public/` and are served from the site root.
- **Netlify Functions use the V2 format:** `export default async (req: Request) => …` returning a native `Response` (`Response.json(body, { status })`). Never `exports.handler` and never `{ statusCode, body }` objects — the repo was migrated off that shape in #5.
- **Call functions at `/api/<name>`, never `/.netlify/functions/<name>`.** `netlify.toml` rewrites `/api/*` → `/.netlify/functions/:splat` with a `200` (a rewrite, not a redirect).
- **Guard every required env var and return a clean 500** rather than letting a missing value throw or reach the vendor SDK. Both functions do this up front; keep the pattern. Env vars are read from `process.env` **in functions only**.
- **Never put a secret in `src/`.** `RAZORPAY_KEY_SECRET`, `RAZORPAY_KEY_ID` and `GOOGLE_SHEET_ID` are server-side (`.env`, gitignored, mirrored in the Netlify UI). The Razorpay _publishable_ key in `src/ts/deposit-payment.ts` is public by design; the secret key must never reach the client bundle.
- **Run `yarn typecheck` after any TS change.** It type-checks **both** projects: `tsconfig.json` (`src/**`, DOM libs) and `netlify/tsconfig.json` (`functions/**`, Node libs, no DOM). A change under `netlify/` is **not** covered by the root config, so the single-project scripts are rarely what you want.
- **Nothing else type-checks.** Vite and Netlify's esbuild both strip types without checking, so `yarn typecheck` is the only thing standing between a type error and production.
- **TypeScript is strict in both projects, including `noUncheckedIndexedAccess`** — indexing an array or record yields `T | undefined`. Narrow it or default it (`row[0] ?? ""`); don't reach for `!` or `as`.
- **Client logic lives in `src/ts/` as a registered Alpine component**, not in inline `<script>` blocks or inline `x-data` object literals. Register it in `src/main.ts` before `Alpine.start()`.
- **Formatting is Prettier** (`.prettierrc`: 2 spaces, 80 cols) with `prettier-plugin-tailwindcss`, which sorts Tailwind classes — let it reorder rather than hand-sorting `class` attributes. Nothing formats on save or on commit, so run `yarn format` yourself. `.prettierignore` deliberately excludes build output, the vendored daisyUI reference, and the generated gallery metadata JSON — don't format those back in.
- **Run `yarn format` and `yarn typecheck` before every commit (MANDATORY).** Both are CI jobs on every PR and push to `main`: `typecheck` runs `yarn typecheck`, and `format` runs `yarn format` then fails the build via `git diff --exit-code` if Prettier rewrote anything. Committing without them means a red build, so run both, stage whatever `yarn format` changed, and only then commit.
- **Git:** branch off `main`; commit or push only when asked. End commit messages with the `Co-Authored-By: Claude …` trailer.

## Instruction-file upkeep

When you change a `.github/instructions/*.instructions.md` file, update its paired `CLAUDE.md` (or this file for the root) **in the same commit**. See `docs/INSTRUCTION_FILES.md`.
