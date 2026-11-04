---
applyTo: "netlify/**"
---

# `netlify/` — Serverless Functions (Razorpay deposits, booking lookup, daily rebuild)

Three functions in `netlify/functions/`, all TypeScript ESM in Netlify's **V2** format. Two back the `/deposit-payment` page: look a booking up in the office's Google Sheet, then create a Razorpay order for its deposit. The third, `daily-rebuild`, is a **scheduled** function that triggers a production build every night. There is no database. Shared helpers live beside the functions with their Jest tests: `netlify/google-sheets.ts` (reads a private Google Sheet through the Sheets API as a service account — `get-booking`) and `netlify/utils.ts` (`parseCsv`). **`parseCsv` is imported at build time** by `src/data/load-yoga-schedule.mjs` to read the schedule sheet, so keep `utils.ts` dependency-free; everything else stays in the function files themselves.

## Function conventions

- **V2 format only:** `export default async (req: Request) => …` returning a native `Response`, built with `Response.json(body, { status })`. Never `exports.handler` and never `{ statusCode, body }` — the repo was migrated off that shape in #5.
- **Read query params from the URL:** `new URL(req.url).searchParams`. There is no `event.queryStringParameters` in V2.
- **Reachable at `/api/<name>`** via the `netlify.toml` rewrite (status `200`), as well as at the raw `/.netlify/functions/<name>`. Client code uses `/api/<name>`. **Scheduled functions are the exception:** Netlify gives them no URL at all (the rewrite included) — only their cron or the **Run now** button in the Netlify UI invokes them.
- **Validate input before doing any work**, and return `400` for bad input — never let malformed input reach the vendor SDK or turn into a `500`.
- **Guard required env vars up front and return a clean `500`**, logging _which_ var is missing. Don't let a missing value throw or silently construct a broken client:

  ```ts
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    console.error("create-order: RAZORPAY_KEY_ID env var is not set");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
  ```

- **Never return an internal error message to the client** except where it's already deliberate (`create-order` echoes the Razorpay SDK message under `details`). Log the real error with `console.error` and return a generic string. Never log or return an env-var _value_.
- **`fetch` does not throw on non-2xx** — check `response.ok` explicitly. This is the classic regression when porting code that used axios.
- **`noUncheckedIndexedAccess` is on**, so every sheet cell is `string | undefined`. Default it (`row[at] ?? ""`) rather than asserting with `!`.

## Environment variables

| Var                                  | Used by         | Notes                                                                                                                                         |
| ------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`                    | `create-order`  | Live key id (server side)                                                                                                                     |
| `RAZORPAY_KEY_SECRET`                | `create-order`  | **Secret** — server side only, never in `src/`                                                                                                |
| `BOOKINGS_SPREADSHEET_ID`            | `get-booking`   | The bookings spreadsheet's id — the one in its `/d/<id>/edit` address                                                                         |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | `get-booking`   | The service account's `client_email`; the bookings sheet is shared with it (Viewer)                                                           |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `get-booking`   | **Secret** — the `private_key` from its JSON key, pasted as-is: real newlines or the file's `\n` escapes, with or without its wrapping quotes |
| `DAILY_BUILD_HOOK_URL`               | `daily-rebuild` | Build hook URL for the production branch — **secret**: anyone holding it can trigger builds, so never log it                                  |

Local values live in `.env` (gitignored) and are injected by `netlify dev`; production values live in the Netlify UI. **Functions share a 4 KB budget for all their env vars** (AWS Lambda), which is why only the service account's email and private key are stored, not its whole JSON key file. The Razorpay _publishable_ key is separately hardcoded in `src/ts/deposit-payment.ts` — that one is public by design.

## `create-order.ts`

`GET /api/create-order?amount=<amount>&id=<bookingRef>` → the raw Razorpay order object (the client reads `id` and `amount`).

- **Razorpay works in paisa** — the rupee amount is multiplied by 100 and rounded. Commas are stripped first (`"12,500"` arrives from the sheet), then the result is rejected unless it's finite and `> 0`.
- **The receipt id is capped at 40 characters** (`${bookingId}_${shortTimestamp}`, sliced) — Razorpay rejects anything longer. `shortTimestamp` is the last 6 digits of `Date.now()`, enough to distinguish repeat attempts for the same booking.
- `notes` carry `booking_reference` and `resort` through to the Razorpay dashboard — that's how the office reconciles a payment to a booking. Keep them populated.
- **The order is not verified anywhere.** Payment capture is confirmed by Razorpay itself; the site only redirects to `/payment-success` with the payment id in the query string. There is no webhook and no signature check — so treat nothing on `/payment-success` as proof of payment.

## `get-booking.ts`

`GET /api/get-booking?id=<bookingRef>` → the guest and deposit details, or `404`.

- Reads the bookings sheet **live through the Google Sheets API** (`values.get`, columns `A:Z` of the **first tab**) as a service account, via `netlify/google-sheets.ts`. The sheet is **private** — shared only with the service account's email — so there is no public copy of the guest data and no publish lag. Row 0 is the header row; the reference is matched case-insensitively against the `bookingId` column.
- **Columns are found by header name, not position** (`COLUMNS` in `get-booking.ts`, matched case-insensitively). The office can insert, move or delete any other column — `stayflexiBooking`, `deposit %`, `paymentLink`, `Comment`… — and those are never read into the response. **Renaming or deleting one of these headers makes every lookup fail** with a `500` whose log names the column: loud, never a neighbouring cell's data. The tab is still a contract — the API reads the first tab, so keep the bookings tab leftmost, with these headers within columns A–Z:

  | Header          | Field                                             |
  | --------------- | ------------------------------------------------- |
  | `bookingId`     | matched against `?id=` (case-insensitive)         |
  | `customerName`  | `customerName`                                    |
  | `email`         | `customerEmail` (blank for a booking.com relay)   |
  | `phone`         | `customerPhone`                                   |
  | `checkIn`       | `checkIn`                                         |
  | `checkOut`      | `checkOut`                                        |
  | `bookingAmount` | `bookingAmount`                                   |
  | `depositAmount` | `depositAmount`                                   |
  | `paymentId`     | `depositPaid` (filled = paid, see the rule below) |

- **New booking IDs come from the bookings spreadsheet's own menu** — _Bookings → Generate booking ID for selected rows_, from the Apps Script in `docs/booking-deposits.gs`: 8 random characters without look-alikes, unique in the `bookingId` column, never overwriting an existing ID. The ID is the only key to a guest's details on this public endpoint, so don't shorten it or make it sequential.
- **The API returns the displayed values, row by row** — the same text the old CSV export had, so amounts still arrive as `"75,650"`. It **drops trailing empty cells and rows**, so a row can be shorter than the header row. `cell()` reads every cell as a trimmed string (`""` when missing), so **every field in the response is always present**: the client calls string methods on them (`customerName.normalize(…)` in `deposit-payment.ts`).
- **An incomplete booking answers exactly like an unknown one** — `404`, same body — when `customerName`, `checkIn` or `checkOut` is empty, or an unpaid booking has no positive `depositAmount` (a paid one still shows its "paid" view). That's a row the office hasn't finished, e.g. just after the ID menu filled column A; serving it would greet nobody and fail at Pay. The identical body keeps the endpoint from confirming which IDs exist; the function log (`booking <ref> is not ready — missing …`) tells the office what to fill.
- **The service-account auth is hand-rolled in `google-sheets.ts`** (a JWT signed with `node:crypto`, traded for an access token that is cached per warm instance until a minute before expiry) rather than pulling in `google-auth-library`. **Never log or return the private key, the JWT or the token** — its errors carry only Google's message plus a hint (403: sheet not shared with the service account, or Sheets API not enabled; 404: wrong spreadsheet id). It is unit-tested in `netlify/google-sheets.test.ts` — extend those tests if you touch it.
- **Amounts go through `parseAmount`**, which strips thousands separators before `Number()` — `Number("75,650")` is `NaN`.
- **A booking.com relay address is suppressed** (`customerEmail: ""`) so the deposit page prompts the guest for a real address instead of prefilling an unusable relay one.
- **`depositPaid` is "any non-empty `paymentId` except an explicit negative"** (`false` / `0` / `no`, case-insensitive) — the sheet marks paid deposits inconsistently, and a checkbox column reads as the literal `FALSE`. Keep that guard if you touch the logic.
- **This endpoint is public and unauthenticated:** a booking reference is the only thing between a caller and a guest's name, email, phone and dates. **Do not widen the response** beyond what the deposit page renders, and don't add fields "just in case".

## `daily-rebuild.ts`

Scheduled (`export const config = { schedule: "0 19 * * *" }`), with no HTTP route. It POSTs to the `DAILY_BUILD_HOOK_URL` build hook every night. `/yoga` is built from the schedule Google Sheet and renders the week containing the **build date** as plain HTML (see `src/CLAUDE.md`), so this build is what picks up the office's sheet edits, moves the page to the new week on Mondays and drops past classes from the JSON-LD.

- **Netlify cron is UTC.** `0 19 * * *` is 19:00 UTC = **00:30 the next day in Goa** (UTC+5:30, no daylight saving). Keep the margin past midnight: a build that reads the date before Goa midnight gets the previous day — on a Sunday night, the previous week.
- **It only runs on the published production deploy** — never on Deploy Previews or branch deploys — within a 30-second limit, which one hook call fits easily.
- **The hook is created in the Netlify UI** (Build hooks, in the project's continuous-deployment settings; branch `main`) and its URL stored in the env var. Without the var the function logs it as missing and returns a `500`, and the site silently stops updating. It is a **different hook from the sheet's** "Publish schedule now" button (the `BUILD_HOOK_URL` script property in the sheet's Apps Script — `docs/yoga-schedule-sheet.md`), so each can be revoked alone.
- **Trigger it by hand** with **Run now** (Logs → Functions → `daily-rebuild`), or locally with `netlify functions:invoke daily-rebuild` under `yarn dev:netlify` — which fires a **real** production build if `DAILY_BUILD_HOOK_URL` is set in `.env`.

## Type-checking

The functions have **their own TS project**, `netlify/tsconfig.json` (`functions/**` plus the top-level `netlify/*.ts` helpers and tests, Node libs, `target: ES2023`, no DOM). The root `tsconfig.json` covers `src/**` only, so a change here is not checked by it:

```bash
yarn typecheck:netlify   # this project only
yarn typecheck           # both projects — prefer this
```

**This is the only thing that type-checks the functions.** Netlify bundles them with esbuild, which strips types without checking, so nothing in `yarn build` or the deploy will catch a type error here.

## Running and testing locally

`yarn dev` does **not** serve functions. Use `yarn dev:netlify` (`netlify dev`, port `:8888`), which serves the site, runs the functions, applies the `/api/*` rewrite and injects `.env`:

```bash
curl "http://localhost:8888/api/get-booking?id=ABC123"
curl "http://localhost:8888/api/create-order?amount=5000&id=ABC123"
```

`yarn test` runs the Jest unit tests (`netlify/*.test.ts` — `utils.test.ts` for the CSV parser, `google-sheets.test.ts` for the service-account Sheets reads); Jest strips types via babel, so it is **not** a type gate. **Note that `create-order` uses the live Razorpay key** — a local call creates a real order, so test with a Razorpay test key or accept the stray order.

## Verification checklist

- [ ] V2 signature, native `Response`, params via `new URL(req.url).searchParams`.
- [ ] Input validated → `400`; required env vars guarded → logged `500`; no internal detail or env value leaked.
- [ ] `response.ok` checked on any `fetch`; indexed access defaulted, not asserted.
- [ ] Response fields limited to what the client actually renders.
- [ ] `yarn typecheck` is clean.
- [ ] Exercised through `yarn dev:netlify` at `/api/<name>` (a scheduled function: `netlify functions:invoke <name>`).
