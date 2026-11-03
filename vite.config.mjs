import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { createMpaPlugin } from "vite-plugin-virtual-mpa";
import { loadTreatmentPageData } from "./src/data/load-treatments.mjs";
import { loadYogaHolidaysPageData } from "./src/data/load-yoga-holidays.mjs";
import { loadYogaSchedulePageData } from "./src/data/load-yoga-schedule.mjs";
import { SITE_URL, sitePageData } from "./src/data/site.mjs";

// Netlify sets CONTEXT for every build ("production", "deploy-preview",
// "branch-deploy"); it is unset locally. Analytics (GTM + Meta Pixel) is only
// emitted when this is true — see src/partials/head.ejs. Kept here rather than
// in site.mjs because that module is also imported by the client bundle, where
// `process` does not exist.
const isProduction = process.env.CONTEXT === "production";

/**
 * Sets the <lastmod> of one sitemap entry, found by its <loc>. Throws
 * (failing the build) if the entry or its <lastmod> is missing, so the date
 * can't silently stop updating after someone edits the sitemap.
 */
function setSitemapLastmod(xml, loc, date) {
  const start = xml.indexOf(`<loc>${loc}</loc>`);
  const end = xml.indexOf("</url>", start);
  const lastmod = /<lastmod>[^<]*<\/lastmod>/;
  if (start === -1 || end === -1 || !lastmod.test(xml.slice(start, end))) {
    throw new Error(`sitemap.xml: no <lastmod> in the ${loc} entry to set`);
  }
  const entry = xml
    .slice(start, end)
    .replace(lastmod, `<lastmod>${date}</lastmod>`);
  return xml.slice(0, start) + entry + xml.slice(end);
}

// Async: the /yoga schedule is fetched from the office's Google Sheet before
// the pages are configured.
export default defineConfig(async ({ mode }) => {
  // .env (local builds) merged with the real environment (Netlify, where it
  // wins) — the sheet URL is read here, not from the client bundle.
  const env = loadEnv(mode, process.cwd(), "");

  // Loaded once so the /yoga page and its sitemap <lastmod> agree on the build
  // date. A production build without YOGA_SCHEDULE_CSV_URL fails here rather
  // than publish the sample classes.
  const yogaSchedulePageData = await loadYogaSchedulePageData({
    csvUrl: env.YOGA_SCHEDULE_CSV_URL,
    requireSheet: isProduction,
  });

  return {
    plugins: [
      {
        // /yoga changes with every build: the schedule opens on the build week
        // and its JSON-LD starts at the build date. So its sitemap <lastmod> is
        // that build date (Goa time), set here rather than hand-edited.
        // public/sitemap.xml stays the hand-maintained source for every other
        // page; this rewrites only the copy in the output dir. Vite copies
        // public/ there at renderStart, so it exists by writeBundle — which
        // also only runs after a successful write.
        name: "sitemap-yoga-lastmod",
        apply: "build",
        async writeBundle(options) {
          const file = resolve(options.dir, "sitemap.xml");
          const xml = await readFile(file, "utf8");
          await writeFile(
            file,
            setSitemapLastmod(
              xml,
              `${SITE_URL}/yoga`,
              yogaSchedulePageData.yogaSchedule.buildDate,
            ),
          );
        },
      },
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
            name: "yoga",
            template: resolve(__dirname, "src/pages/yoga.ejs"),
            filename: "yoga.html",
            // Weekly class schedule + its schema.org Events, from the schedule
            // Google Sheet (loaded above) — loadYogaSchedulePageData()
            // validates the rows and throws (failing the build) on malformed
            // ones. The week containing the build date (Goa time) is the one
            // rendered as plain HTML; netlify/functions/daily-rebuild.ts
            // rebuilds every night, which also picks up sheet edits.
            data: yogaSchedulePageData,
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
          // `isProduction` is spread last so no page's `data` can override it —
          // analytics must never be switchable per page.
        ].map((page) => ({
          ...page,
          data: { ...sitePageData, ...page.data, isProduction },
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
  };
});
