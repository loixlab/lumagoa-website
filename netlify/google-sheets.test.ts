import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { createVerify, generateKeyPairSync } from "node:crypto";

// Everything is tested through readSheetValues, the module's only export.
// Each test loads a fresh copy of the module, so the token cache starts empty.
let readSheetValues: typeof import("./google-sheets").readSheetValues;

// A throwaway key pair, generated per run — never a real credential.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const account = {
  email: "bookings-reader@luma-test.iam.gserviceaccount.com",
  privateKey,
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const T0 = 1_700_000_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const decodePart = (part: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));

let fetchMock: jest.SpiedFunction<typeof fetch>;
let tokenResponse: () => Response;
let sheetResponse: () => Response;

const tokenCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input) === TOKEN_URL);
const sheetCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input) !== TOKEN_URL);

beforeEach(async () => {
  jest.resetModules();
  ({ readSheetValues } = await import("./google-sheets"));
  jest.spyOn(Date, "now").mockReturnValue(T0);
  tokenResponse = () => json({ access_token: "token-1", expires_in: 3600 });
  sheetResponse = () => json({ values: [["ref"], ["ABC123"]] });
  fetchMock = jest.spyOn(globalThis, "fetch");
  fetchMock.mockImplementation(async (input) =>
    String(input) === TOKEN_URL ? tokenResponse() : sheetResponse(),
  );
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("authentication", () => {
  it("signs the JWT Google expects, verifiable with the public key", async () => {
    await readSheetValues(account, "sheet-id", "A:J");

    const [, init] = tokenCalls()[0] ?? [];
    const params = init?.body as URLSearchParams;
    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const [header, claims, signature] = (params.get("assertion") ?? "").split(
      ".",
    );
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodePart(claims)).toEqual({
      iss: account.email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: TOKEN_URL,
      iat: T0 / 1000,
      exp: T0 / 1000 + 3600,
    });
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature ?? "", "base64url"));
    expect(valid).toBe(true);
  });

  it("accepts the JSON key file's literal \\n escapes", async () => {
    const escaped = {
      ...account,
      privateKey: privateKey.replace(/\n/g, "\\n"),
    };
    await expect(readSheetValues(escaped, "sheet-id", "A:J")).resolves.toEqual([
      ["ref"],
      ["ABC123"],
    ]);
  });

  it("rejects a malformed key without echoing it", async () => {
    const broken = { ...account, privateKey: "not-a-key-SECRET-VALUE" };
    const failure = readSheetValues(broken, "sheet-id", "A:J");
    await expect(failure).rejects.toThrow(/not a valid PEM key/);
    await expect(failure).rejects.not.toThrow(/SECRET-VALUE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reuses the token until shortly before it expires", async () => {
    await readSheetValues(account, "sheet-id", "A:J");
    // Still cached at 58 minutes…
    jest.spyOn(Date, "now").mockReturnValue(T0 + 58 * 60_000);
    await readSheetValues(account, "sheet-id", "A:J");
    expect(tokenCalls()).toHaveLength(1);
    // …refreshed inside the last minute of the hour.
    jest.spyOn(Date, "now").mockReturnValue(T0 + 59.5 * 60_000);
    await readSheetValues(account, "sheet-id", "A:J");
    expect(tokenCalls()).toHaveLength(2);
    expect(sheetCalls()).toHaveLength(3);
  });

  it("reports Google's token error, never the key", async () => {
    tokenResponse = () =>
      json(
        { error: "invalid_grant", error_description: "Invalid JWT Signature." },
        400,
      );
    const failure = readSheetValues(account, "sheet-id", "A:J");
    await expect(failure).rejects.toThrow(
      "Google token request failed (400): invalid_grant: Invalid JWT Signature.",
    );
    await expect(failure).rejects.not.toThrow(/PRIVATE KEY/);
    expect(sheetCalls()).toHaveLength(0);
  });
});

describe("reading values", () => {
  it("returns the displayed values as string rows, short rows included", async () => {
    sheetResponse = () =>
      json({
        range: "Bookings!A1:J3",
        majorDimension: "ROWS",
        values: [
          ["ref", "name", "email"],
          ["ABC123", "Doe, Jane", "jane@x.com", "", "", "", "75,650"],
          ["XYZ9", 5],
        ],
      });

    const rows = await readSheetValues(account, "sheet-id", "A:J");

    expect(rows).toEqual([
      ["ref", "name", "email"],
      ["ABC123", "Doe, Jane", "jane@x.com", "", "", "", "75,650"],
      ["XYZ9", "5"],
    ]);
    const [url, init] = sheetCalls()[0] ?? [];
    expect(String(url)).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/A%3AJ",
    );
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer token-1",
    );
  });

  it("returns no rows for an empty range", async () => {
    sheetResponse = () => json({ range: "A1:J1", majorDimension: "ROWS" });
    expect(await readSheetValues(account, "sheet-id", "A:J")).toEqual([]);
  });

  it("explains a 403: the sheet isn't shared with the service account", async () => {
    sheetResponse = () =>
      json(
        {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      );
    await expect(readSheetValues(account, "sheet-id", "A:J")).rejects.toThrow(
      /PERMISSION_DENIED: The caller does not have permission — is the spreadsheet shared with the service account's email/,
    );
  });
});
