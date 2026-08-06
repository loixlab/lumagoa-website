import Alpine from "alpinejs";
import { registerQuoteComponents } from "./ts/daily-quote";
import { registerGalleryComponents } from "./ts/gallery";
import { googleMap } from "./google_map";

// Components must be registered before start(). Each component no-ops on pages
// that don't reference it, so there is no per-page routing here.
window.Alpine = Alpine;
registerQuoteComponents(Alpine);
registerGalleryComponents(Alpine);
Alpine.start();

document.addEventListener("DOMContentLoaded", () => {
  // Still imperative (not Alpine) until Phase 2 of the migration. Guarded by
  // element presence: any page with a #map gets one (home, cafe-restaurant).
  if (document.getElementById("map")) {
    googleMap();
  }
});
