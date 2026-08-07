import Razorpay from "razorpay";

/**
 * Creates a Razorpay order for a booking deposit. The client (deposit-payment
 * page) opens the Razorpay checkout with the returned order id.
 */
export default async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const amount = params.get("amount");
  const bookingId = params.get("id") || "manual_entry";

  if (!amount) {
    return Response.json({ error: "Amount is required" }, { status: 400 });
  }

  // Accessing the keys securely from environment variables
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    console.error(
      "create-order: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET env vars are not set",
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
  const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });

  try {
    // Razorpay expects amount in PAISA (INR * 100)
    // We sanitize the input to ensure it's a clean number
    const amountInPaisa = Math.round(
      parseFloat(amount.replace(/,/g, "")) * 100,
    );
    if (!Number.isFinite(amountInPaisa) || amountInPaisa <= 0) {
      return Response.json({ error: "Invalid amount" }, { status: 400 });
    }

    const shortTimestamp = Date.now().toString().slice(-6);
    const receiptId = `${bookingId}_${shortTimestamp}`.slice(0, 40);

    const order = await instance.orders.create({
      amount: amountInPaisa,
      currency: "INR",
      receipt: receiptId,
      notes: {
        booking_reference: bookingId,
        resort: "LUMA Goa",
      },
    });

    return Response.json(order);
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    return Response.json(
      {
        error: "Failed to create order",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
