/**
 * GTM + Meta Pixel event reporting — the single home for `window.dataLayer`
 * and `window.fbq` access. Components call the typed helpers below instead of
 * touching the globals, so new events get added here (typed) rather than as
 * ad-hoc pushes scattered through components.
 *
 * Harmless when GTM never loaded (e.g. blocked by the browser): the array
 * just accumulates and nothing reads it. `fbq` is optional-chained for the
 * same reason.
 */

/** Where a booking CTA lives on the page — the `cta_location` values. */
const CTA_LOCATIONS = [
  "hero",
  "signature_card",
  "tier2_row",
  "combination",
  "doctor",
  "final_cta",
  "whatsapp_float",
] as const;
export type CtaLocation = (typeof CTA_LOCATIONS)[number];

function push(event: Record<string, unknown>): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(event);
}

/**
 * A booking CTA click (WhatsApp enquiry). Also reports a Meta Pixel `Lead`.
 * Generic CTAs (hero, final CTA, float) pass price 0 — the price/value
 * fields are then omitted rather than sent as 0.
 */
export function trackTreatmentEnquiry(
  id: string,
  title: string,
  price: number,
  location: CtaLocation,
): void {
  push({
    event: "treatment_enquiry",
    treatment_id: id,
    cta_location: location,
    ...(price > 0 ? { treatment_price: price } : {}),
  });
  window.fbq?.("track", "Lead", {
    content_name: title,
    ...(price > 0 ? { value: price, currency: "INR" } : {}),
  });
}

/**
 * An intent pill activated on the "What does your body need?" filter —
 * tells the owner what guests actually come in for.
 */
export function trackIntentFilter(intent: string): void {
  push({ event: "intent_filter", intent });
}

/**
 * A navigation CTA pointing at the treatment finder (the hero button).
 * Deliberately NOT a `treatment_enquiry`/Pixel `Lead` — it measures
 * engagement, not booking intent.
 */
export function trackFindTreatment(location: CtaLocation): void {
  push({ event: "find_treatment", cta_location: location });
}
