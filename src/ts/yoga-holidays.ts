import type Alpine from "alpinejs";
import {
  DEFAULT_SEASON_ID,
  resolveSeason,
  SEASON_IDS,
  SEASON_LABELS,
} from "../data/season.mjs";
import {
  trackHolidayEnquiry,
  trackSeasonSelect,
  trackViewHolidays,
  type HolidayCtaLocation,
} from "./analytics";

export type SeasonId = (typeof SEASON_IDS)[number];

function isSeasonId(value: string | null): value is SeasonId {
  return value !== null && (SEASON_IDS as readonly string[]).includes(value);
}

/**
 * Per-holiday payload built by load-yoga-holidays.mjs and passed via x-data.
 */
interface HolidayCardData {
  /**
   * Formatted EUR figures per season — the formatting happens at build time,
   * never in the browser. The number only: the card markup renders the "EUR"
   * unit beside it.
   */
  prices: Record<SeasonId, { solo: string; shared: string }>;
  /** Raw two-sharing EUR prices per season, for analytics values. */
  values: Record<SeasonId, number>;
  /** Season-aware WhatsApp hrefs. */
  wa: Record<SeasonId, string>;
}

/**
 * Registers the Alpine components behind the /yoga-holidays page.
 *
 * `seasonSelector` holds the selected season for the pricing section. The
 * default is the season containing today (from the shared calendar in
 * src/data/season.mjs — computed client-side, since the static build can't
 * know when it is being viewed), falling back out of season to the cheapest
 * one. A `#season=` hash restores a shared view and scrolls to the pricing
 * section. Cards render that same cheapest season server-side, so the page
 * degrades to a plain one-season price list without JS.
 *
 * `holidayCard` carries one card's per-season payload; its bindings read
 * `season` from the enclosing `seasonSelector` scope.
 *
 * `holidaysAccordion` drives the "Good to know" accordion: real `<button>`
 * elements toggling `aria-expanded`, one panel open at a time. The panels
 * are plain `x-show`s, so there is no animation to guard for
 * `prefers-reduced-motion`.
 *
 * `holidayTracking` is placed on individual CTA anchors to fire the
 * `yoga_holiday_enquiry` / `view_yoga_holidays` analytics events without
 * inline scripts.
 */
export function registerYogaHolidaysComponents(alpine: typeof Alpine) {
  alpine.data("seasonSelector", () => ({
    season: DEFAULT_SEASON_ID as SeasonId,
    // Populates the aria-live region — set only on user selection so
    // nothing is announced on page load.
    announcement: "",

    init() {
      const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
        "season",
      );
      if (isSeasonId(fromHash)) {
        this.season = fromHash;
        this.scrollToHolidays();
      } else {
        const resolved = resolveSeason(new Date());
        this.season = isSeasonId(resolved) ? resolved : DEFAULT_SEASON_ID;
      }
    },

    select(id: SeasonId) {
      if (id === this.season) return;
      this.season = id;
      this.announcement = `${SEASON_LABELS[id] ?? id} season prices shown`;
      history.replaceState(null, "", `#season=${id}`);
      trackSeasonSelect(id);
    },

    isActive(id: SeasonId): boolean {
      return this.season === id;
    },

    // The `#season=` hash matches no element id, so the browser won't
    // scroll on its own when a shared link is opened.
    scrollToHolidays() {
      const target = document.querySelector("#holidays");
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    },
  }));

  alpine.data("holidayCard", (card) => ({
    card: card as HolidayCardData,
  }));

  alpine.data("holidaysAccordion", () => ({
    open: null as number | null,

    toggle(index: number) {
      this.open = this.open === index ? null : index;
    },

    isOpen(index: number): boolean {
      return this.open === index;
    },
  }));

  alpine.data("holidayTracking", () => ({
    track(
      id: string,
      name: string,
      value: number,
      location: HolidayCtaLocation,
      season?: SeasonId,
    ) {
      trackHolidayEnquiry(id, name, value, location, season);
    },
    trackView(location: HolidayCtaLocation) {
      trackViewHolidays(location);
    },
  }));
}
