// Build-time loader for the /packages page. Imported by vite.config.mjs only —
// never shipped to the client. Validates the package data and derives
// everything the EJS template needs (prices, JSON-LD, WhatsApp links, the
// included-treatments list) so the commercial values live in one place.
//
// Several values below are owner-unconfirmed ([CONFIRM] in the page spec):
// the six prices derive from an illustrative ₹5,000/night hut rate, and the
// season window, check-in/out times and timeline class times are assumptions.
// When the owner confirms, only this file changes.
import rawTreatments from "./treatments.json" with { type: "json" };
import { SITE_URL, waHref } from "./site.mjs";
import { numberToWord } from "./utils.mjs";

// [CONFIRM] Season window — 30 April 2027 end date assumed.
const SEASON = {
  start: "2026-11-01",
  end: "2027-04-30",
  display: "1 November 2026 – 30 April 2027",
};

// [CONFIRM] Check-in / check-out times assumed.
const STAY = { checkIn: "14:00", checkOut: "11:00" };

// [CONFIRM] Recommended class times, not a confirmed schedule — verify
// against the final November schedule before publishing.
const TIMELINE = [
  {
    time: "08:00",
    title: "Morning practice",
    text: "Dynamic Hatha or Vinyasa in the open-air shala.",
  },
  {
    time: "09:15",
    title: "Breakfast",
    text: "Straight from the mat to Roots & Bloom.",
  },
  {
    time: "10:30",
    title: "Your treatment",
    text: "Ayurvedic massage, or the beach — 200 m away.",
  },
  {
    time: "17:30",
    title: "Evening practice",
    text: "Yin, Kundalini, pranayama, meditation.",
  },
  {
    time: "19:00",
    title: "Dinner",
    text: "Plant-based, alcohol-free, unhurried.",
  },
];

// [CONFIRM] All six prices derive from the spec's illustrative ₹5,000/night
// hut rate. Savings are calculated against à-la-carte rates (₹600/class × 2
// daily, ₹550 breakfast, ₹2,900 Abhyangam). Single price set for now; if
// season tiers arrive, extend price to { shoulder: {…}, high: {…} } — the
// markup renders from this object either way.
const PACKAGES = [
  {
    id: "pause",
    name: "The Pause",
    nights: 3,
    tagline: "A long weekend to exhale.",
    massages: 1,
    consultation: false,
    featured: false,
    price: { solo: 20500, double: 26000 },
    saving: { solo: 2650, double: 5300 },
  },
  {
    id: "rhythm",
    name: "The Rhythm",
    nights: 5,
    tagline: "Long enough to find your pace.",
    massages: 2,
    consultation: false,
    featured: true,
    price: { solo: 33000, double: 43000 },
    saving: { solo: 6550, double: 11100 },
  },
  {
    id: "immersion",
    name: "The Immersion",
    nights: 7,
    tagline: "A full week to change how you feel.",
    massages: 3,
    consultation: true,
    featured: false,
    price: { solo: 45500, double: 60000 },
    saving: { solo: 10450, double: 16900 },
  },
];

// Display order for the included-treatments list (mirrors the menu page's
// category order; orders in treatments.json are per-category).
const CATEGORY_ORDER = [
  "signature",
  "specialized-body",
  "focused",
  "doctor-recommended",
  "western",
  "combo",
  "consultation",
];

/** Throws (failing the build) rather than rendering a broken card. */
function validate(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error("packages: expected a non-empty array");
  }
  const ids = new Set();
  for (const p of packages) {
    if (!p.id || typeof p.id !== "string") {
      throw new Error("packages: missing or invalid id");
    }
    if (ids.has(p.id)) {
      throw new Error(`packages: duplicate id "${p.id}"`);
    }
    ids.add(p.id);
    const label = `package "${p.id}"`;
    if (!p.name || !p.tagline) {
      throw new Error(`packages: missing name or tagline on ${label}`);
    }
    if (!Number.isInteger(p.nights) || p.nights <= 0) {
      throw new Error(`packages: invalid nights on ${label}`);
    }
    if (!Number.isInteger(p.massages) || p.massages <= 0) {
      throw new Error(`packages: invalid massages on ${label}`);
    }
    for (const group of ["price", "saving"]) {
      for (const occupancy of ["solo", "double"]) {
        const value = p[group]?.[occupancy];
        if (typeof value !== "number" || value <= 0) {
          throw new Error(
            `packages: invalid ${group}.${occupancy} on ${label}`,
          );
        }
      }
    }
    if (p.price.solo >= p.price.double) {
      throw new Error(`packages: solo price not below two-sharing on ${label}`);
    }
  }
  if (packages.filter((p) => p.featured).length !== 1) {
    throw new Error("packages: expected exactly one featured package");
  }
}

/**
 * The treatments a package guest can choose from, read via the
 * packageEligible flag — never hard-coded a second time.
 */
function includedTreatments() {
  const eligible = rawTreatments
    .filter((t) => t.active !== false && t.packageEligible)
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) -
          CATEGORY_ORDER.indexOf(b.category) || a.order - b.order,
    );
  if (eligible.length === 0) {
    throw new Error("packages: no packageEligible treatments found");
  }
  return eligible;
}

function formatPrice(price) {
  return `₹${price.toLocaleString("en-IN")}`;
}

function packageWaHref(p) {
  return waHref(
    `Hi LUMA, I'd like to enquire about ${p.name} (${p.nights} nights) package. My dates are: `,
  );
}

function buildSchema(packages) {
  const seller = { "@type": "Hotel", name: "Luma", url: `${SITE_URL}/` };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "LUMA Goa All-Inclusive Yoga & Wellness Packages",
    description:
      "All-inclusive stay packages in Palolem, South Goa: a boutique A-frame hut with unlimited daily yoga, plant-based breakfast and Ayurvedic massage included.",
    url: `${SITE_URL}/packages`,
    image: `${SITE_URL}/img/packages-hero.jpg`,
    brand: seller,
    offers: packages.flatMap((p) => [
      {
        "@type": "Offer",
        name: `${p.name} (${p.nights} nights, solo)`,
        description: p.tagline,
        price: p.price.solo,
        priceCurrency: "INR",
        availabilityStarts: SEASON.start,
        availabilityEnds: SEASON.end,
        seller,
      },
      {
        "@type": "Offer",
        name: `${p.name} (${p.nights} nights, two sharing)`,
        description: p.tagline,
        price: p.price.double,
        priceCurrency: "INR",
        availabilityStarts: SEASON.start,
        availabilityEnds: SEASON.end,
        seller,
      },
    ]),
  };
}

/** Validates and shapes the package data for the page template. */
export function loadPackagesPageData() {
  validate(PACKAGES);
  const packages = PACKAGES.map((p) => ({ ...p, wa: packageWaHref(p) }));
  const included = includedTreatments();
  const fromPrice = Math.min(...packages.map((p) => p.price.solo));

  return {
    packages,
    season: SEASON,
    stay: STAY,
    timeline: TIMELINE,
    includedTreatments: included,
    includedCountWord: numberToWord(included.length, false),
    fromPrice: formatPrice(fromPrice),
    formatPrice,
    schemaData: buildSchema(packages),
  };
}
