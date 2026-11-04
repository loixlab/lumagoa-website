/**
 * Looks up a booking by reference in the office's bookings Google Sheet and
 * returns the guest/deposit details the deposit-payment page needs.
 *
 * The sheet holds guest PII, so it is private: shared only with a service
 * account, read live through the Sheets API (netlify/google-sheets.ts).
 */
import { readSheetValues } from "../google-sheets";

// The bookings tab and the columns the lookup uses (A–J; see the column
// table in netlify/CLAUDE.md). With no tab name, the API reads the first tab.
const BOOKINGS_RANGE = "A:J";

// The sheet formats amounts with thousands separators ("75,650"), which
// Number() would read as NaN.
const parseAmount = (cell: string | undefined): number =>
  Number((cell ?? "").replace(/,/g, "").trim());

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
    const dataRows = rows.slice(1);

    // Find the specific guest
    const guest = dataRows.find(
      (row) => (row[0] ?? "").trim().toUpperCase() === bookingId,
    );

    if (!guest) {
      return Response.json({ error: "Booking not found" }, { status: 404 });
    }

    const rawEmail = guest[2] || "";
    // Check if the email belongs to the booking.com relay domain
    const isBookingDotCom = rawEmail.toLowerCase().includes("booking.com");

    // The sheet marks a paid deposit with any non-empty value; only guard
    // against explicit negative markers so a literal FALSE/0/no cell (e.g. a
    // checkbox column, which reads as "FALSE") doesn't read as paid.
    const depositPaidRaw = (guest[9] ?? "").trim().toLowerCase();
    const depositPaid =
      depositPaidRaw !== "" && !["false", "0", "no"].includes(depositPaidRaw);

    return Response.json({
      customerName: guest[1],
      customerEmail: isBookingDotCom ? "" : rawEmail, // Empty if it's a booking.com relay email
      customerPhone: guest[3],
      checkIn: guest[4],
      checkOut: guest[5],
      bookingAmount: parseAmount(guest[6]),
      depositAmount: parseAmount(guest[8]),
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
