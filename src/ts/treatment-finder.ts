import type Alpine from "alpinejs";
import {
  trackIntentFilter,
  trackTreatmentEnquiry,
  type CtaLocation,
} from "./analytics";

const HASH_PREFIX = "#find=";

/**
 * Registers the two Alpine components behind the Ayurveda & Massage page.
 *
 * `treatmentFinder` drives the "What does your body need?" intent filter
 * (Section 5.3 of the page spec). It sits on a wrapper around the pills and
 * the treatment menu; every card/row carries a space-separated
 * `data-intents` attribute and every category group a `data-category-group`
 * attribute. The full menu is server-rendered and visible without JS — this
 * component only adds show/hide, so it degrades to a plain menu.
 *
 * `enquiryTracking` is placed on individual CTA anchors to fire the
 * `treatment_enquiry` analytics events without inline scripts.
 */
export function registerTreatmentFinderComponents(alpine: typeof Alpine) {
  alpine.data("treatmentFinder", () => ({
    active: [] as string[],
    visibleCount: 0,

    init() {
      this.visibleCount = this.items().length;
      // Restore a shared filtered view from the URL hash (#find=tension,rest).
      if (window.location.hash.startsWith(HASH_PREFIX)) {
        const intents = window.location.hash
          .slice(HASH_PREFIX.length)
          .split(",")
          .filter((i) => this.isKnownIntent(i));
        if (intents.length > 0) {
          this.active = intents;
          this.applyFilter();
          this.scrollToFinder();
        }
      }
    },

    isKnownIntent(intent: string): boolean {
      return Boolean(
        this.$root.querySelector(`button[data-intent="${intent}"]`),
      );
    },

    isActive(intent: string): boolean {
      return this.active.includes(intent);
    },

    toggle(intent: string) {
      if (this.isActive(intent)) {
        this.active = this.active.filter((i) => i !== intent);
      } else {
        this.active = [...this.active, intent];
        trackIntentFilter(intent);
      }
      this.applyFilter();
      this.updateHash();
      if (this.active.length > 0) this.scrollToMenu();
    },

    reset() {
      this.active = [];
      this.applyFilter();
      this.updateHash();
    },

    items(): HTMLElement[] {
      return Array.from(this.$root.querySelectorAll("[data-intents]"));
    },

    applyFilter() {
      let visible = 0;
      for (const item of this.items()) {
        const intents = (item.dataset.intents ?? "").split(" ");
        const matches =
          this.active.length === 0 ||
          this.active.some((i) => intents.includes(i));
        item.classList.toggle("hidden", !matches);
        if (matches) visible++;
      }
      this.visibleCount = visible;
      // Hide a category (heading included) entirely when nothing in it
      // matches, rather than showing an empty section.
      const groups = this.$root.querySelectorAll<HTMLElement>(
        "[data-category-group]",
      );
      for (const group of groups) {
        const hasMatch = Array.from(
          group.querySelectorAll<HTMLElement>("[data-intents]"),
        ).some((item) => !item.classList.contains("hidden"));
        group.classList.toggle("hidden", !hasMatch);
      }
    },

    updateHash() {
      const url = new URL(window.location.href);
      url.hash =
        this.active.length > 0 ? HASH_PREFIX + this.active.join(",") : "";
      history.replaceState(null, "", url);
    },

    scrollToMenu() {
      this.scrollTo("#menu");
    },

    scrollToFinder() {
      this.scrollTo("#find");
    },

    scrollTo(selector: string) {
      const target = document.querySelector(selector);
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    },
  }));

  alpine.data("enquiryTracking", () => ({
    track(id: string, title: string, price: number, location: CtaLocation) {
      trackTreatmentEnquiry(id, title, price, location);
    },
  }));
}
