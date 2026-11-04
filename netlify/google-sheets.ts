/**
 * Reads a private Google Sheet through the Sheets API as a service account —
 * the sheet is shared only with the service account's email, so there is no
 * public URL to leak, and every read sees the sheet as it is right now (a
 * "Publish to web" CSV lags behind a 5-minute cache).
 *
 * Auth is Google's OAuth 2.0 JWT-bearer flow, done by hand with node:crypto
 * rather than pulling in google-auth-library: sign a short-lived JWT with the
 * service account's private key, trade it for an access token, call the API.
 * Tokens are cached per warm function instance until a minute before they
 * expire, so most lookups make a single request to Google.
 *
 * Never put the private key, the JWT or the token in an error message or log.
 *
 * `readSheetValues` is the only export — the rest is internal, and the tests
 * go through it too (netlify/google-sheets.test.ts).
 */
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

interface ServiceAccount {
  /** `client_email` from the service account's JSON key. */
  email: string;
  /** `private_key` from the JSON key: a PEM string. */
  privateKey: string;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
// Netlify's synchronous functions get 10 s in all; two calls must fit.
const REQUEST_TIMEOUT_MS = 4_000;
const TOKEN_LIFETIME_S = 3_600;
// Refresh this long before Google's expiry, so a token never dies mid-request.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/**
 * Parses the PEM key. A `private_key` copied as-is from the JSON key file
 * keeps its wrapping quotes and literal "\n" sequences. A `.env` loader strips
 * and expands those, but Netlify's UI stores the value verbatim, so undo both
 * here: a PEM key never starts or ends with a quote.
 */
function parsePrivateKey(pem: string): KeyObject {
  try {
    return createPrivateKey(
      pem
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\\n/g, "\n"),
    );
  } catch {
    // Node's own message is safe, but say what to check instead.
    throw new Error(
      "The service account private key is not a valid PEM key — paste the whole private_key value, BEGIN/END lines included",
    );
  }
}

/** The signed JWT assertion Google's token endpoint trades for an access token. */
function signJwt(account: ServiceAccount, nowSeconds: number): string {
  const encode = (part: object) =>
    Buffer.from(JSON.stringify(part)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.email,
    scope: READONLY_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_S,
  })}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(parsePrivateKey(account.privateKey))
    .toString("base64url");
  return `${unsigned}.${signature}`;
}

/** Google's own error text from a failed response — never contains our credentials. */
async function googleError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string; status?: string };
      error_description?: string;
    };
    if (typeof body.error === "string") {
      // Token endpoint: { error, error_description }
      return [body.error, body.error_description].filter(Boolean).join(": ");
    }
    // Sheets API: { error: { code, message, status } }
    return [body.error?.status, body.error?.message].filter(Boolean).join(": ");
  } catch {
    return "no error details";
  }
}

let cachedToken: { email: string; token: string; expiresAt: number } | null =
  null;

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.email === account.email &&
    cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > now
  ) {
    return cachedToken.token;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(account, Math.floor(now / 1000)),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // fetch doesn't throw on non-2xx.
  if (!response.ok) {
    throw new Error(
      `Google token request failed (${response.status}): ${await googleError(response)}`,
    );
  }
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw new Error("Google token response had no access_token");
  }
  const lifetime =
    typeof body.expires_in === "number" ? body.expires_in : TOKEN_LIFETIME_S;
  cachedToken = {
    email: account.email,
    token: body.access_token,
    expiresAt: now + lifetime * 1000,
  };
  return body.access_token;
}

/**
 * The displayed values of `range` (A1 notation, e.g. "A:Z" for the first
 * tab or "'Bookings'!A:Z"), as rows of strings — the same text a CSV export
 * would give, so "75,650" stays "75,650". Google drops trailing empty cells
 * and rows, so rows can be shorter than the range: default missing cells.
 */
export async function readSheetValues(
  account: ServiceAccount,
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const token = await getAccessToken(account);
  const response = await fetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    const hint =
      response.status === 403
        ? " — is the spreadsheet shared with the service account's email, and is the Sheets API enabled in its Google Cloud project?"
        : response.status === 404
          ? " — check the spreadsheet id (the one in the sheet's /d/<id>/edit address)"
          : "";
    throw new Error(
      `Sheets API request failed (${response.status}): ${await googleError(response)}${hint}`,
    );
  }
  const body = (await response.json()) as { values?: unknown };
  if (body.values === undefined) return []; // an empty range has no `values`
  if (!Array.isArray(body.values)) {
    throw new Error("Sheets API response had malformed values");
  }
  return body.values.map((row: unknown) =>
    Array.isArray(row) ? row.map((cell: unknown) => String(cell)) : [],
  );
}
