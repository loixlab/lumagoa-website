import type Alpine from "alpinejs";
import { resolveSeason, SEASON_LABELS } from "../data/season.mjs";
import {
  trackPackageEnquiry,
  trackSeasonSelect,
  trackViewPackages,
  type PackageCtaLocation,
} from "./analytics";

const SEASON_IDS = ["low", "mid", "high"] as const;
export type SeasonId = (typeof SEASON_IDS)[number];

function isSeasonId(value: string | null): value is SeasonId {
  return value !== null && (SEASON_IDS as readonly string[]).includes(value);
}

/** Per-package payload built by load-packages.mjs and passed via x-data. */
interface PackageCardData {
  /** Formatted price strings per season — no formatting in the browser. */
  prices: Record<SeasonId, { solo: string; double: string }>;
  /** Raw two-sharing prices per season, for analytics values. */
  values: Record<SeasonId, number>;
  /** Season-aware WhatsApp hrefs. */
  wa: Record<SeasonId, string>;
}

/**
 * Registers the Alpine components behind the /packages page.
 *
 * `seasonSelector` holds the selected season for the pricing section. The
 * default is the season containing today (from the shared calendar in
 * src/data/season.mjs — computed client-side, since the static build can't
 * know when it is being viewed), falling back to Low out of season. A
 * `#season=` hash restores a shared view and scrolls to the pricing
 * section. Cards render the Low-season prices server-side, so the page
 * degrades to a plain Low-season price list without JS.
 *
 * `packageCard` carries one card's per-season payload; its bindings read
 * `season` from the enclosing `seasonSelector` scope.
 *
 * `packagesAccordion` drives the "Good to know" accordion: real `<button>`
 * elements toggling `aria-expanded`, one panel open at a time. The panels
 * are plain `x-show`s, so there is no animation to guard for
 * `prefers-reduced-motion`.
 *
 * `packageTracking` is placed on individual CTA anchors to fire the
 * `package_enquiry` / `view_packages` analytics events without inline
 * scripts.
 */
export function registerPackagesComponents(alpine: typeof Alpine) {
  alpine.data("seasonSelector", () => ({
    season: "low" as SeasonId,
    // Populates the aria-live region — set only on user selection so
    // nothing is announced on page load.
    announcement: "",

    init() {
      const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(
        "season",
      );
      if (isSeasonId(fromHash)) {
        this.season = fromHash;
        this.scrollToPackages();
      } else {
        const resolved = resolveSeason(new Date());
        this.season = isSeasonId(resolved) ? resolved : "low";
      }
    },

    select(id: SeasonId) {
      if (id === this.season) return;
      this.season = id;
      this.announcement = `${SEASON_LABELS[id]} season prices shown`;
      history.replaceState(null, "", `#season=${id}`);
      trackSeasonSelect(id);
    },

    isActive(id: SeasonId): boolean {
      return this.season === id;
    },

    // The `#season=` hash matches no element id, so the browser won't
    // scroll on its own when a shared link is opened.
    scrollToPackages() {
      const target = document.querySelector("#packages");
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      target?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
    },
  }));

  alpine.data("packageCard", (card) => ({
    card: card as PackageCardData,
  }));

  alpine.data("packagesAccordion", () => ({
    open: null as number | null,

    toggle(index: number) {
      this.open = this.open === index ? null : index;
    },

    isOpen(index: number): boolean {
      return this.open === index;
    },
  }));

  alpine.data("packageTracking", () => ({
    track(
      id: string,
      name: string,
      value: number,
      location: PackageCtaLocation,
      season?: SeasonId,
    ) {
      trackPackageEnquiry(id, name, value, location, season);
    },
    trackView(location: PackageCtaLocation) {
      trackViewPackages(location);
    },
  }));
}
