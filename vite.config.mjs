import { resolve } from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createMpaPlugin } from "vite-plugin-virtual-mpa";
import { loadTreatmentPageData } from "./src/data/load-treatments.mjs";
import { loadYogaHolidaysPageData } from "./src/data/load-yoga-holidays.mjs";
import { sitePageData } from "./src/data/site.mjs";

// Netlify sets CONTEXT for every build ("production", "deploy-preview",
// "branch-deploy"); it is unset locally. Analytics (GTM + Meta Pixel) is only
// emitted when this is true — see src/partials/head.ejs. Kept here rather than
// in site.mjs because that module is also imported by the client bundle, where
// `process` does not exist.
const isProduction = process.env.CONTEXT === "production";

export default defineConfig({
  plugins: [
    {
      name: "redirect-root", // Custom plugin for dev server redirect
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/") {
            req.url = "/index.html"; // Required for the Mpa plugin to work correctly
          }
          next();
        });
      },
    },
    createMpaPlugin({
      // Every page gets the shared site data (phone, waHref) as EJS locals;
      // per-page `data` entries are merged on top.
      pages: [
        {
          name: "index",
          template: resolve(__dirname, "src/pages/index.ejs"),
          filename: "index.html",
        },
        {
          name: "booking",
          template: resolve(__dirname, "src/pages/booking.ejs"),
          filename: "booking.html",
        },
        {
          name: "winter-renewal",
          template: resolve(__dirname, "src/pages/winter-renewal.ejs"),
          filename: "winter-renewal.html",
        },
        {
          name: "yoga-shala",
          template: resolve(__dirname, "src/pages/yoga-shala.ejs"),
          filename: "yoga-shala.html",
        },
        {
          name: "cafe-restaurant",
          template: resolve(__dirname, "src/pages/cafe-restaurant.ejs"),
          filename: "cafe-restaurant.html",
        },
        {
          name: "ayurveda-massage",
          template: resolve(__dirname, "src/pages/ayurveda-massage.ejs"),
          filename: "ayurveda-massage.html",
          // Treatment menu is rendered at build time from src/data/
          // treatments.json — loadTreatmentPageData() validates the data and
          // throws (failing the build) on malformed records.
          data: loadTreatmentPageData(),
        },
        {
          name: "yoga-holidays",
          template: resolve(__dirname, "src/pages/yoga-holidays.ejs"),
          filename: "yoga-holidays.html",
          // Holiday prices/dates and the included-treatments list (derived
          // from treatments.json via holidayEligible) — validated at build
          // time; loadYogaHolidaysPageData() throws on malformed data.
          data: loadYogaHolidaysPageData(),
        },
        {
          name: "gallery",
          template: resolve(__dirname, "src/pages/gallery.ejs"),
          filename: "gallery.html",
        },
        {
          name: "deposit-payment",
          template: resolve(__dirname, "src/pages/deposit-payment.ejs"),
          filename: "deposit-payment.html",
        },
        {
          name: "payment-success",
          template: resolve(__dirname, "src/pages/payment-success.ejs"),
          filename: "payment-success.html",
        },
        {
          name: "terms-and-services",
          template: resolve(__dirname, "src/pages/terms-and-services.ejs"),
          filename: "terms-and-services.html",
        },
        {
          name: "privacy-policy",
          template: resolve(__dirname, "src/pages/privacy-policy.ejs"),
          filename: "privacy-policy.html",
        },
      ].map((page) => ({
        ...page,
        data: { ...sitePageData, isProduction, ...page.data },
      })),
      htmlMinify: true,
      watchOptions: {
        include: "**/*.ejs", // Watch all .ejs files in the project
        handler: ({ server, file, type }) => {
          if (type === "change" && file.endsWith(".ejs")) {
            console.log(`EJS template changed: ${file}. Triggering reload.`);
            server.ws.send({
              type: "full-reload",
              path: "*",
            });
          }
        },
      },
    }),
    tailwindcss({ config: "./tailwind.config.js" }),
  ],
  // Basic config for static site
  build: {
    outDir: "dist", // Output directory for builds
  },
  server: {
    open: true, // Auto-open browser on dev server start
  },
});
