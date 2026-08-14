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
  "package_card",
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

/**
 * A package-enquiry CTA click on /packages (WhatsApp). Also reports a Meta
 * Pixel `Lead`. Generic CTAs (final CTA, float) pass value 0 — the
 * value/price fields are then omitted rather than sent as 0. Card CTAs pass
 * the selected season's two-sharing price as the Lead value, plus the
 * season id, so conversions are attributed at the right seasonal value.
 */
export function trackPackageEnquiry(
  id: string,
  name: string,
  value: number,
  location: CtaLocation,
  season?: string,
): void {
  push({
    event: "package_enquiry",
    package_id: id,
    cta_location: location,
    ...(season ? { season } : {}),
    ...(value > 0 ? { package_value: value } : {}),
  });
  window.fbq?.("track", "Lead", {
    content_name: name,
    ...(value > 0 ? { value, currency: "INR" } : {}),
  });
}

/**
 * A season pill activated on the /packages selector — tells the owner which
 * season browsers are actually shopping for.
 */
export function trackSeasonSelect(season: string): void {
  push({ event: "season_select", season });
}

/**
 * A navigation CTA pointing at the package cards (the /packages hero
 * button). Engagement, not booking intent — no Pixel `Lead`.
 */
export function trackViewPackages(location: CtaLocation): void {
  push({ event: "view_packages", cta_location: location });
}
