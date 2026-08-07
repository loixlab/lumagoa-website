/**
 * Looks up a booking by reference in the published Google Sheet (CSV export)
 * and returns the guest/deposit details the deposit-payment page needs.
 */
export default async (req: Request) => {
  const bookingId = new URL(req.url).searchParams.get("id")?.toUpperCase();

  if (!bookingId) {
    return Response.json({ error: "Missing ID" }, { status: 400 });
  }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  if (!SHEET_ID) {
    console.error("get-booking: GOOGLE_SHEET_ID env var is not set");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=0&output=csv`;

  try {
    // The t param busts Google's CSV cache. Unlike axios, fetch doesn't throw
    // on non-2xx, so check ok explicitly to keep the old 500 behavior.
    const response = await fetch(`${csvUrl}&t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Sheet fetch failed with status ${response.status}`);
    }

    const csv = await response.text();
    const rows = csv.split("\n").map((row) => row.split(","));
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
    // checkbox column exported to CSV) doesn't read as paid.
    const depositPaidRaw = (guest[9] ?? "").trim().toLowerCase();
    const depositPaid =
      depositPaidRaw !== "" && !["false", "0", "no"].includes(depositPaidRaw);

    return Response.json({
      customerName: guest[1],
      customerEmail: isBookingDotCom ? "" : rawEmail, // Empty if it's a booking.com relay email
      customerPhone: guest[3],
      checkIn: guest[4],
      checkOut: guest[5],
      bookingAmount: Number((guest[6] ?? "").trim()),
      depositAmount: Number((guest[8] ?? "").trim()),
      depositPaid,
    });
  } catch (err) {
    console.error("get-booking error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};
