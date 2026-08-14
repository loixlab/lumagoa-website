import type Alpine from "alpinejs";

declare global {
  interface Window {
    Alpine: typeof Alpine;
    // Provided by https://checkout.razorpay.com/v1/checkout.js, loaded via a
    // plain script tag on the deposit-payment page.
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
    // Populated by the GTM snippet in head.ejs; undefined if GTM is blocked.
    dataLayer?: Record<string, unknown>[];
    // Populated by the Meta Pixel snippet in head.ejs.
    fbq?: (...args: unknown[]) => void;
  }
}
