import type Alpine from "alpinejs";

/**
 * Registers the Alpine component backing the payment-success page. Reads the
 * params appended by the Razorpay redirect (see deposit-payment) and exposes
 * them to the template. Rendering the guest name via `x-text` (instead of the
 * old script's innerHTML) keeps URL-supplied content from injecting markup.
 */
export function registerPaymentSuccessComponents(alpine: typeof Alpine) {
  alpine.data("paymentSuccess", () => {
    const params = new URLSearchParams(window.location.search);
    const guestName = params.get("name");
    const arrivalStr = params.get("arrival");

    let countdown = "";
    if (arrivalStr) {
      const arrivalDate = new Date(arrivalStr);
      const today = new Date();

      // Reset hours to compare only calendar days
      today.setHours(0, 0, 0, 0);
      arrivalDate.setHours(0, 0, 0, 0);

      const timeDiff = arrivalDate.getTime() - today.getTime();
      const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

      if (daysDiff > 0) countdown = `${daysDiff} days until your arrival`;
      else if (daysDiff === 0) countdown = "See you today!";
    }

    return {
      bookingRef: params.get("id") ?? "...",
      paymentId: params.get("payment_id") ?? "...",
      firstName: guestName?.split(" ")[0] ?? "",
      countdown,
    };
  });
}
