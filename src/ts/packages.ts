import type Alpine from "alpinejs";
import {
  trackPackageEnquiry,
  trackViewPackages,
  type CtaLocation,
} from "./analytics";

/**
 * Registers the two Alpine components behind the /packages page.
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
    track(id: string, name: string, value: number, location: CtaLocation) {
      trackPackageEnquiry(id, name, value, location);
    },
    trackView(location: CtaLocation) {
      trackViewPackages(location);
    },
  }));
}
