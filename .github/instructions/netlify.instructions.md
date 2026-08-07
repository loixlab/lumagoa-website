---
applyTo: "netlify/**"
---

# `netlify/` — Serverless Functions (Razorpay deposits + booking lookup)

Two functions in `netlify/functions/`, both TypeScript ESM in Netlify's **V2** format. Together they back the `/deposit-payment` page: look a booking up in the office's Google Sheet, then create a Razorpay order for its deposit. There is no database and no shared `lib/` — each function is self-contained.

## Function conventions

- **V2 format only:** `export default async (req: Request) => …` returning a native `Response`, built with `Response.json(body, { status })`. Never `exports.handler` and never `{ statusCode, body }` — the repo was migrated off that shape in #5.
- **Read query params from the URL:** `new URL(req.url).searchParams`. There is no `event.queryStringParameters` in V2.
- **Reachable at `/api/<name>`** via the `netlify.toml` rewrite (status `200`), as well as at the raw `/.netlify/functions/<name>`. Client code uses `/api/<name>`.
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
- **`noUncheckedIndexedAccess` is on**, so every CSV cell is `string | undefined`. Default it (`guest[9] ?? ""`) rather than asserting with `!`.

## Environment variables

| Var                   | Used by        | Notes                                                             |
| --------------------- | -------------- | ----------------------------------------------------------------- |
| `RAZORPAY_KEY_ID`     | `create-order` | Live key id (server side)                                         |
| `RAZORPAY_KEY_SECRET` | `create-order` | **Secret** — server side only, never in `src/`                    |
| `GOOGLE_SHEET_ID`     | `get-booking`  | The _published_ sheet id (the `/d/e/…` form, not the document id) |

Local values live in `.env` (gitignored) and are injected by `netlify dev`; production values live in the Netlify UI. The Razorpay _publishable_ key is separately hardcoded in `src/ts/deposit-payment.ts` — that one is public by design.

## `create-order.ts`

`GET /api/create-order?amount=<amount>&id=<bookingRef>` → the raw Razorpay order object (the client reads `id` and `amount`).

- **Razorpay works in paisa** — the rupee amount is multiplied by 100 and rounded. Commas are stripped first (`"12,500"` arrives from the sheet), then the result is rejected unless it's finite and `> 0`.
- **The receipt id is capped at 40 characters** (`${bookingId}_${shortTimestamp}`, sliced) — Razorpay rejects anything longer. `shortTimestamp` is the last 6 digits of `Date.now()`, enough to distinguish repeat attempts for the same booking.
- `notes` carry `booking_reference` and `resort` through to the Razorpay dashboard — that's how the office reconciles a payment to a booking. Keep them populated.
- **The order is not verified anywhere.** Payment capture is confirmed by Razorpay itself; the site only redirects to `/payment-success` with the payment id in the query string. There is no webhook and no signature check — so treat nothing on `/payment-success` as proof of payment.

## `get-booking.ts`

`GET /api/get-booking?id=<bookingRef>` → the guest and deposit details, or `404`.

- Reads the office's **published Google Sheet as CSV** (`…/pub?gid=0&output=csv`), appending `&t=<Date.now()>` to bust Google's cache. Row 0 is the header and is dropped; the reference is matched case-insensitively against column 0.
- **Column indices are a contract with the spreadsheet** — changing the sheet's column order breaks this function with no error, just wrong data:

  | Index | Field               |
  | ----- | ------------------- |
  | 0     | booking reference   |
  | 1     | `customerName`      |
  | 2     | email               |
  | 3     | `customerPhone`     |
  | 4     | `checkIn`           |
  | 5     | `checkOut`          |
  | 6     | `bookingAmount`     |
  | 8     | `depositAmount`     |
  | 9     | deposit-paid marker |

- **The CSV parser is a naive `split(",")`.** A comma inside any cell (a guest name, an address, a thousands separator) shifts every subsequent column for that row. Keep commas out of the sheet, or replace the parser with a real CSV reader — don't paper over it with index fudging.
- **A booking.com relay address is suppressed** (`customerEmail: ""`) so the deposit page prompts the guest for a real address instead of prefilling an unusable relay one.
- **`depositPaid` is "any non-empty value except an explicit negative"** (`false` / `0` / `no`, case-insensitive) — the sheet marks paid deposits inconsistently, and a checkbox column exports as the literal `FALSE`. Keep that guard if you touch the logic.
- **This endpoint is public and unauthenticated:** a booking reference is the only thing between a caller and a guest's name, email, phone and dates. **Do not widen the response** beyond what the deposit page renders, and don't add fields "just in case".

## Type-checking

The functions have **their own TS project**, `netlify/tsconfig.json` (`functions/**`, Node libs, `target: ES2023`, no DOM). The root `tsconfig.json` covers `src/**` only, so a change here is not checked by it:

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

There are no unit tests in this repo. **Note that `create-order` uses the live Razorpay key** — a local call creates a real order, so test with a Razorpay test key or accept the stray order.

## Verification checklist

- [ ] V2 signature, native `Response`, params via `new URL(req.url).searchParams`.
- [ ] Input validated → `400`; required env vars guarded → logged `500`; no internal detail or env value leaked.
- [ ] `response.ok` checked on any `fetch`; indexed access defaulted, not asserted.
- [ ] Response fields limited to what the client actually renders.
- [ ] `yarn typecheck` is clean.
- [ ] Exercised through `yarn dev:netlify` at `/api/<name>`.
