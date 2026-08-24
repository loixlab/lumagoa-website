import type Alpine from "alpinejs";
import {
  trackWhatsappEnquiry,
  type EnquirySource,
  type SharedCtaLocation,
} from "./analytics";

/**
 * `whatsappTracking` is placed on WhatsApp CTA anchors on the pages with no
 * funnel of their own (/, /cafe-restaurant, /gallery) to fire the generic
 * `whatsapp_enquiry` event without inline scripts. /ayurveda-massage and
 * /yoga-holidays keep their own `enquiryTracking` / `holidayTracking`
 * components, which report the richer per-funnel events.
 */
export function registerWhatsappEnquiryComponents(alpine: typeof Alpine) {
  alpine.data("whatsappTracking", () => ({
    track(source: EnquirySource, location: SharedCtaLocation) {
      trackWhatsappEnquiry(source, location);
    },
  }));
}
