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

/**
 * The `cta_location` values, typed per page so a copy-pasted CTA can't
 * report a location belonging to the other page's funnel.
 */
const SHARED_CTA_LOCATIONS = ["hero", "final_cta", "whatsapp_float"] as const;
export type SharedCtaLocation = (typeof SHARED_CTA_LOCATIONS)[number];

/**
 * Pages that report the generic `whatsapp_enquiry` event — the ones with no
 * funnel of their own, so the owner can still tell where a WhatsApp click
 * came from. Pages with a funnel (/ayurveda-massage, /yoga-holidays) use
 * their own event instead; never add them here.
 */
const ENQUIRY_SOURCES = ["home", "cafe", "gallery"] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

/** Pixel `content_name` per source — the Lead needs a human-readable name. */
const ENQUIRY_LEAD_NAMES: Record<EnquirySource, string> = {
  home: "LUMA Goa Stay",
  cafe: "Roots & Bloom Cafe",
  gallery: "LUMA Goa Stay",
};

/** Where a booking CTA lives on /ayurveda-massage. */
const TREATMENT_CTA_LOCATIONS = [
  ...SHARED_CTA_LOCATIONS,
  "signature_card",
  "tier2_row",
  "combination",
  "doctor",
] as const;
export type TreatmentCtaLocation = (typeof TREATMENT_CTA_LOCATIONS)[number];

/** Where a booking CTA lives on /yoga-holidays. */
const HOLIDAY_CTA_LOCATIONS = [
  ...SHARED_CTA_LOCATIONS,
  "holiday_card",
] as const;
export type HolidayCtaLocation = (typeof HOLIDAY_CTA_LOCATIONS)[number];

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
  location: TreatmentCtaLocation,
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
export function trackFindTreatment(location: TreatmentCtaLocation): void {
  push({ event: "find_treatment", cta_location: location });
}

/**
 * A holiday-enquiry CTA click on /yoga-holidays (WhatsApp). Also reports a
 * Meta Pixel `Lead`. Generic CTAs (final CTA, float) pass value 0 — the
 * value/price fields are then omitted rather than sent as 0. Card CTAs pass
 * the selected season's two-sharing price as the Lead value, plus the
 * season id, so conversions are attributed at the right seasonal value.
 */
export function trackHolidayEnquiry(
  id: string,
  name: string,
  value: number,
  location: HolidayCtaLocation,
  season?: string,
): void {
  push({
    event: "yoga_holiday_enquiry",
    holiday_id: id,
    cta_location: location,
    ...(season ? { season } : {}),
    ...(value > 0 ? { holiday_value: value } : {}),
  });
  window.fbq?.("track", "Lead", {
    content_name: name,
    ...(value > 0 ? { value, currency: "INR" } : {}),
  });
}

/**
 * A season pill activated on the /yoga-holidays selector — tells the owner
 * which season browsers are actually shopping for.
 */
export function trackSeasonSelect(season: string): void {
  push({ event: "season_select", season });
}

/**
 * A navigation CTA pointing at the holiday cards (the /yoga-holidays hero
 * button). Engagement, not booking intent — no Pixel `Lead`.
 */
export function trackViewHolidays(location: HolidayCtaLocation): void {
  push({ event: "view_yoga_holidays", cta_location: location });
}

/**
 * A WhatsApp enquiry from a page with no funnel of its own (/, /cafe-restaurant,
 * /gallery) — currently only their floating button. Also reports a Meta Pixel
 * `Lead`, like the two funnel enquiries; there is no value to attach, so the
 * Lead carries `content_name` only. `enquiry_source` is what separates the
 * pages in GTM, since `cta_location` is the same slot on all of them.
 */
export function trackWhatsappEnquiry(
  source: EnquirySource,
  location: SharedCtaLocation,
): void {
  push({
    event: "whatsapp_enquiry",
    enquiry_source: source,
    cta_location: location,
  });
  window.fbq?.("track", "Lead", { content_name: ENQUIRY_LEAD_NAMES[source] });
}
