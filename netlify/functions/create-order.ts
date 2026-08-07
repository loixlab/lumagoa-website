import Razorpay from "razorpay";

/**
 * Creates a Razorpay order for a booking deposit. The client (deposit-payment
 * page) opens the Razorpay checkout with the returned order id.
 */
export default async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const amount = params.get("amount");
  const bookingId = params.get("id") || "manual_entry";

  // Accessing the keys securely from environment variables
  const instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID ?? "",
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });

  if (!amount) {
    return Response.json({ error: "Amount is required" }, { status: 400 });
  }

  try {
    // Razorpay expects amount in PAISA (INR * 100)
    // We sanitize the input to ensure it's a clean number
    const amountInPaisa = Math.round(
      parseFloat(amount.replace(/,/g, "")) * 100,
    );

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
