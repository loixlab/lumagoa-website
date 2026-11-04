/**
 * Looks up a booking by reference in the office's bookings Google Sheet and
 * returns the guest/deposit details the deposit-payment page needs.
 *
 * The sheet holds guest PII, so it is private: shared only with a service
 * account, read live through the Sheets API (netlify/google-sheets.ts).
 */
import { readSheetValues } from "../google-sheets";

// The lookup finds its columns by header name (case-insensitive), not by
// position: the office can insert, move or remove other columns — which are
// never read into the response (stayflexiBooking, deposit %, paymentLink,
// Comment…). Renaming or deleting one of these fails every lookup with a 500
// whose log names the column, rather than silently reading a neighbour's cell.
const COLUMNS = [
  "bookingId",
  "customerName",
  "email",
  "phone",
  "checkIn",
  "checkOut",
  "bookingAmount",
  "depositAmount",
  "paymentId",
] as const;
type Column = (typeof COLUMNS)[number];

// The first tab (no tab name), columns A–Z: the columns above must sit there.
const BOOKINGS_RANGE = "A:Z";

/**
 * Reads a row's cell by column header, trimmed — always a string: the API
 * drops trailing empty cells, so a short row's missing cells read as "".
 * Throws naming any column the header row lacks.
 */
function columnReader(header: string[]) {
  const names = header.map((name) => name.trim().toLowerCase());
  const missing = COLUMNS.filter(
    (column) => !names.includes(column.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new Error(
      `the bookings sheet has no ${missing.join(", ")} column (columns are read by header name)`,
    );
  }
  return (row: string[], column: Column): string =>
    (row[names.indexOf(column.toLowerCase())] ?? "").trim();
}

// The sheet formats amounts with thousands separators ("75,650"), which
// Number() would read as NaN.
const parseAmount = (cell: string): number => Number(cell.replace(/,/g, ""));

export default async (req: Request) => {
  const bookingId = new URL(req.url).searchParams.get("id")?.toUpperCase();

  if (!bookingId) {
    return Response.json({ error: "Missing ID" }, { status: 400 });
  }

  const spreadsheetId = process.env.BOOKINGS_SPREADSHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!spreadsheetId || !email || !privateKey) {
    const missing = [
      ["BOOKINGS_SPREADSHEET_ID", spreadsheetId],
      ["GOOGLE_SERVICE_ACCOUNT_EMAIL", email],
      ["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", privateKey],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    console.error(`get-booking: ${missing.join(", ")} env var(s) not set`);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const rows = await readSheetValues(
      { email, privateKey },
      spreadsheetId,
      BOOKINGS_RANGE,
    );
    const [header = [], ...dataRows] = rows;
    const cell = columnReader(header);

    // Find the specific guest
    const guest = dataRows.find(
      (row) => cell(row, "bookingId").toUpperCase() === bookingId,
    );

    if (!guest) {
      return Response.json({ error: "Booking not found" }, { status: 404 });
    }

    const rawEmail = cell(guest, "email");
    // Check if the email belongs to the booking.com relay domain
    const isBookingDotCom = rawEmail.toLowerCase().includes("booking.com");

    // The sheet marks a paid deposit with any non-empty paymentId; only guard
    // against explicit negative markers so a literal FALSE/0/no cell (e.g. a
    // checkbox column, which reads as "FALSE") doesn't read as paid.
    const depositPaidRaw = cell(guest, "paymentId").toLowerCase();
    const depositPaid =
      depositPaidRaw !== "" && !["false", "0", "no"].includes(depositPaidRaw);

    const customerName = cell(guest, "customerName");
    const checkIn = cell(guest, "checkIn");
    const checkOut = cell(guest, "checkOut");
    const depositAmount = parseAmount(cell(guest, "depositAmount"));

    // A row the office hasn't finished — say, just after the ID menu filled
    // column A — can't be paid: the deposit page would greet nobody and fail
    // at Pay. Answer exactly as for an unknown ID (same 404, same body, so the
    // endpoint never confirms which IDs exist) and log what's missing.
    const ready: Record<string, boolean> = {
      customerName: customerName !== "",
      checkIn: checkIn !== "",
      checkOut: checkOut !== "",
      // Only an unpaid booking needs an amount to pay.
      depositAmount: depositPaid || depositAmount > 0,
    };
    const missing = Object.keys(ready).filter((field) => !ready[field]);
    if (missing.length > 0) {
      console.warn(
        `get-booking: booking ${bookingId} is not ready — missing ${missing.join(", ")}`,
      );
      return Response.json({ error: "Booking not found" }, { status: 404 });
    }

    // Every field is always present: the client reads them as strings.
    return Response.json({
      customerName,
      customerEmail: isBookingDotCom ? "" : rawEmail, // Empty if it's a booking.com relay email
      customerPhone: cell(guest, "phone"),
      checkIn,
      checkOut,
      bookingAmount: parseAmount(cell(guest, "bookingAmount")),
      depositAmount,
      depositPaid,
    });
  } catch (err) {
    // Only the message: the helper's errors never carry credentials, but an
    // unexpected error object could hold request details.
    console.error(
      "get-booking error:",
      err instanceof Error ? err.message : err,
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};
