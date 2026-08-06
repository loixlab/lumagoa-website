import Alpine from "alpinejs";
import { registerQuoteComponents } from "./ts/daily-quote";
import { registerGalleryComponents } from "./ts/gallery";
import { registerMapComponents } from "./ts/google-map";

// Components must be registered before start(). Each component no-ops on pages
// that don't reference it, so there is no per-page routing here.
window.Alpine = Alpine;
registerQuoteComponents(Alpine);
registerGalleryComponents(Alpine);
registerMapComponents(Alpine);
Alpine.start();
