import type Alpine from "alpinejs";

const RAZORPAY_KEY = "rzp_live_S7GCJPV44IImh2";

type View = "loading" | "search" | "payment" | "paid";

interface BookingData {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  depositAmount: number | string;
  depositPaid: boolean;
  checkIn: string;
  checkOut: string;
}

/** e.g. "Friday March 6th 2026". */
function formatHumanDate(dateStr: string): string {
  if (!dateStr) return "...";
  const date = new Date(dateStr);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const d = date.getDate();
  // Standard ordinal suffix logic
  const suffix =
    d > 3 && d < 21
      ? "th"
      : (["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][d % 10] ??
        "th");

  return `${days[date.getDay()]} ${months[date.getMonth()]} ${d}${suffix} ${date.getFullYear()}`;
}

/**
 * Registers the Alpine component backing the deposit-payment page — a state
 * machine over four views (loading/search/payment/paid) that replaces the old
 * inline script's classList toggling. Booking lookup and order creation go
 * through the Netlify functions; checkout opens via Razorpay's checkout.js
 * (loaded by a plain script tag on the page), which redirects to
 * /payment-success on success.
 */
export function registerDepositPaymentComponents(alpine: typeof Alpine) {
  alpine.data("depositPayment", () => ({
    view: "loading" as View,
    searchRef: "",
    lookupError: false,
    bookingId: "",
    booking: null as BookingData | null,
    manualEmail: "",
    emailError: false,
    paying: false,

    init() {
      const id = new URLSearchParams(window.location.search).get("id");
      if (id) {
        this.lookup(id.toUpperCase());
      } else {
        this.view = "search";
      }
    },

    get formattedDates(): string {
      if (!this.booking) return "...";
      return `${formatHumanDate(this.booking.checkIn)} and ${formatHumanDate(this.booking.checkOut)}`;
    },

    get displayAmount(): string {
      if (!this.booking) return "0";
      return Number(this.booking.depositAmount).toLocaleString("en-IN");
    },

    submitLookup() {
      this.lookup(this.searchRef.trim().toUpperCase());
    },

    async lookup(id: string) {
      this.view = "loading";
      this.lookupError = false;

      try {
        const response = await fetch(
          `/.netlify/functions/get-booking?id=${id}`,
        );
        if (!response.ok) throw new Error("Booking not found");

        const data: BookingData = await response.json();
        this.booking = data;
        this.bookingId = id;
        this.view = data.depositPaid === true ? "paid" : "payment";

        const newUrl = `${window.location.pathname}?id=${id}`;
        window.history.pushState({ path: newUrl }, "", newUrl);
      } catch {
        this.lookupError = true;
        this.view = "search";
      }
    },

    // Swaps the known-email display for the manual input. Clearing the
    // booking's email is what makes pay() read the input instead.
    editEmail() {
      if (this.booking) this.booking.customerEmail = "";
      this.$nextTick(() => this.$refs.manualEmail?.focus());
    },

    async pay() {
      if (!this.booking || this.paying) return;

      let finalEmail = this.booking.customerEmail;
      if (!finalEmail) {
        const manual = this.manualEmail.trim();
        // Standard email regex pattern
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manual)) {
          this.emailError = true;
          this.$refs.manualEmail?.focus();
          return;
        }
        finalEmail = manual;
        this.emailError = false;
      }

      this.paying = true;
      try {
        // 1. Create the Razorpay Order via the Netlify function
        const response = await fetch(
          `/.netlify/functions/create-order?amount=${this.booking.depositAmount}&id=${this.bookingId}`,
        );
        const order = await response.json();
        if (!response.ok) throw new Error(order.error);

        // .normalize('NFD') separates letters from their accents (e.g., "é"
        // becomes "e" + "´"); the replace removes those separate accent marks
        const normalizedName = this.booking.customerName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        const sanitizedName =
          normalizedName.replace(/[^a-zA-Z\s.]/g, "").trim() || "Valued Guest";

        const bookingId = this.bookingId;
        const originalName = this.booking.customerName;
        const arrivalDate = this.booking.checkIn;

        const rzp = new window.Razorpay({
          key: RAZORPAY_KEY,
          amount: order.amount,
          currency: "INR",
          name: "LUMA Goa",
          description: `Deposit for ${bookingId}`,
          order_id: order.id, // The ID returned by the create-order function
          handler(response: { razorpay_payment_id: string }) {
            // Redirect to success page on successful payment
            window.location.href = `/payment-success?id=${bookingId}&payment_id=${response.razorpay_payment_id}&name=${encodeURIComponent(originalName)}&arrival=${encodeURIComponent(arrivalDate)}`;
          },
          prefill: {
            name: sanitizedName,
            email: finalEmail,
            contact: this.booking.customerPhone || "",
          },
          theme: { color: "#c66f54" },
          modal: {
            backdropclose: true,
            escape: true,
            confirm_close: false,
          },
        });
        rzp.open();
      } catch (err) {
        console.error(err);
        alert("Payment initialization failed. Please try again.");
      } finally {
        this.paying = false;
      }
    },

    reset() {
      this.searchRef = "";
      this.lookupError = false;
      this.booking = null;
      this.bookingId = "";
      this.manualEmail = "";
      this.emailError = false;
      this.view = "search";

      // Clean the URL (remove the ?id= parameter)
      const cleanUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
      window.history.pushState({ path: cleanUrl }, "", cleanUrl);
    },
  }));
}
