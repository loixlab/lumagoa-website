import Alpine from "alpinejs";
import { registerQuoteComponents } from "./ts/daily-quote";
import { registerGalleryComponents } from "./ts/gallery";
import { registerMapComponents } from "./ts/google-map";
import { registerEmailComponents } from "./ts/email-link";
import { registerPaymentSuccessComponents } from "./ts/payment-success";
import { registerDepositPaymentComponents } from "./ts/deposit-payment";
import { registerTreatmentFinderComponents } from "./ts/treatment-finder";
import { registerYogaHolidaysComponents } from "./ts/yoga-holidays";
import { registerReviewsComponents } from "./ts/reviews";

// Components must be registered before start(). Each component no-ops on pages
// that don't reference it, so there is no per-page routing here.
window.Alpine = Alpine;
registerQuoteComponents(Alpine);
registerGalleryComponents(Alpine);
registerMapComponents(Alpine);
registerEmailComponents(Alpine);
registerPaymentSuccessComponents(Alpine);
registerDepositPaymentComponents(Alpine);
registerTreatmentFinderComponents(Alpine);
registerYogaHolidaysComponents(Alpine);
registerReviewsComponents(Alpine);
Alpine.start();
