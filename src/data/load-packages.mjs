// Build-time loader for the /packages page. Imported by vite.config.mjs only —
// never shipped to the client. Derives the three seasonal price sets from the
// rate model below (package total = room rate + per-person daily inclusions +
// embedded massage value − length discount; saving = the gap to booking the
// same stay à la carte), validates them against build-time invariants, and
// shapes everything the EJS template needs (JSON-LD, WhatsApp links, the
// included-treatments list).
//
// Remaining owner-unconfirmed values ([CONFIRM]): the March season rule (in
// season.mjs), the check-in/out times and the timeline class times.
//
// Never render the room rates, the ₹1,000 per-person/day or ₹2,500 massage
// components, or any breakdown, in guest-facing output — the embedded
// massage value only stays below the cheapest eligible treatment while it
// stays internal.
import rawTreatments from "./treatments.json" with { type: "json" };
import { CATEGORY_ORDER } from "./load-treatments.mjs";
import { resolveSeason } from "./season.mjs";
import { SITE_URL, waHref } from "./site.mjs";
import { formatPrice, numberToWord } from "./utils.mjs";

// Packages are available 1 November – 31 May. (The resort itself re-opens
// in October, but October stays are not sold as packages.)
const SEASON = {
  start: "2026-11-01",
  end: "2027-05-31",
  display: "1 November 2026 – 31 May 2027",
};

// Rack (std) vs package (pkg) room rates — a flat discount per night in
// every season (asserted below against RATES.roomDiscountPerNight), which
// is what keeps the savings figure season-independent. The window strings
// are guest-facing pill labels and must agree with season.mjs — note Mid
// excludes 15–31 Dec (High) so no date is claimed by two pills.
const SEASONS = [
  {
    id: "low",
    label: "Low",
    window: "Nov · Apr – May",
    room: { pkg: 5000, std: 5500 },
  },
  {
    id: "mid",
    label: "Mid",
    window: "1 – 14 Dec · 16 Jan – Mar",
    room: { pkg: 7000, std: 7500 },
  },
  {
    id: "high",
    label: "High",
    window: "15 Dec – 15 Jan",
    room: { pkg: 9000, std: 9500 },
  },
];

const RATES = {
  perPersonDay: 1000, // ₹450 yoga + ₹550 breakfast, pp/day
  massage: 2500, // embedded massage value
  alcPerPersonDay: 1750, // à-la-carte: 2 × ₹600 yoga + ₹550 breakfast
  alcMassage: 2900, // à-la-carte: Abhyangam, cheapest package-eligible
  lengthDiscount: { 3: 0, 5: 2000, 7: 4000 }, // lump sum, season-independent
  roomDiscountPerNight: 500,
};

// [CONFIRM] Check-in / check-out times assumed.
const STAY = { checkIn: "14:00", checkOut: "11:00" };

// [CONFIRM] Recommended class times, not a confirmed schedule — verify
// against the final October schedule before publishing.
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
];

const PACKAGES = [
  {
    id: "pause",
    name: "The Pause",
    nights: 3,
    tagline: "A long weekend to exhale.",
    massages: 1,
    consultation: false,
    featured: false,
  },
  {
    id: "rhythm",
    name: "The Rhythm",
    nights: 5,
    tagline: "Long enough to find your pace.",
    massages: 2,
    consultation: false,
    featured: true,
  },
  {
    id: "immersion",
    name: "The Immersion",
    nights: 7,
    tagline: "A full week to change how you feel.",
    massages: 3,
    consultation: true,
    featured: false,
  },
];

const OCCUPANCIES = [
  { key: "solo", people: 1 },
  { key: "double", people: 2 },
];

/** Package price and à-la-carte saving for one season and occupancy. */
function priceAndSaving(pkg, season, people) {
  const discount = RATES.lengthDiscount[pkg.nights];
  if (discount === undefined) {
    throw new Error(
      `packages: no length discount defined for ${pkg.nights} nights on "${pkg.id}"`,
    );
  }
  const total =
    season.room.pkg * pkg.nights +
    RATES.perPersonDay * pkg.nights * people +
    RATES.massage * pkg.massages * people -
    discount;
  const alaCarte =
    season.room.std * pkg.nights +
    RATES.alcPerPersonDay * pkg.nights * people +
    RATES.alcMassage * pkg.massages * people;
  return { price: total, saving: alaCarte - total };
}

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
  }
  if (packages.filter((p) => p.featured).length !== 1) {
    throw new Error("packages: expected exactly one featured package");
  }
}

/** Invariants over the derived seasonal prices — throws on failure. */
function validateDerived(p, prices, saving) {
  const label = `package "${p.id}"`;
  for (const season of SEASONS) {
    const entry = prices[season.id];
    if (!entry) {
      throw new Error(`packages: missing ${season.id} prices on ${label}`);
    }
    for (const { key } of OCCUPANCIES) {
      const value = entry[key];
      if (!Number.isInteger(value) || value <= 0 || value % 100 !== 0) {
        throw new Error(
          `packages: ${season.id} ${key} price on ${label} is not a positive multiple of 100 (got ${value})`,
        );
      }
    }
    if (entry.solo >= entry.double) {
      throw new Error(
        `packages: ${season.id} solo price not below two-sharing on ${label}`,
      );
    }
  }
  for (const { key } of OCCUPANCIES) {
    if (
      !(prices.low[key] < prices.mid[key] && prices.mid[key] < prices.high[key])
    ) {
      throw new Error(
        `packages: ${key} prices not strictly increasing Low → Mid → High on ${label}`,
      );
    }
    if (!Number.isInteger(saving[key]) || saving[key] <= 0) {
      throw new Error(`packages: invalid ${key} saving on ${label}`);
    }
  }
}

/**
 * The flat per-night room discount is what the season-independent savings
 * rest on — assert every season's rack/package gap actually equals it.
 */
function validateRoomRates() {
  for (const season of SEASONS) {
    const gap = season.room.std - season.room.pkg;
    if (gap !== RATES.roomDiscountPerNight) {
      throw new Error(
        `packages: ${season.id} room discount is ${gap}, expected RATES.roomDiscountPerNight (${RATES.roomDiscountPerNight})`,
      );
    }
  }
}

/**
 * Every day of the open season must resolve to a season — this is what
 * catches a calendar gap (e.g. March never confirmed) at build time.
 */
function validateSeasonCoverage() {
  const localDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const start = new Date(`${SEASON.start}T00:00:00`);
  const end = new Date(`${SEASON.end}T00:00:00`);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (resolveSeason(d) === null) {
      throw new Error(`SEASON_RULES: no season resolves for ${localDay(d)}`);
    }
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

/**
 * Prices, season-independent saving, and the payload the seasonSelector /
 * packageCard Alpine components consume (formatted price strings, raw
 * two-sharing values for analytics, season-aware WhatsApp hrefs).
 */
function derivePackage(p) {
  const prices = {};
  const savings = {};
  for (const season of SEASONS) {
    prices[season.id] = {};
    savings[season.id] = {};
    for (const { key, people } of OCCUPANCIES) {
      const { price, saving } = priceAndSaving(p, season, people);
      prices[season.id][key] = price;
      savings[season.id][key] = saving;
    }
  }

  // The flat per-night room discount makes the saving identical in every
  // season; fail loudly if a rate change ever breaks that property, rather
  // than showing a figure that is wrong in two seasons out of three.
  for (const { key } of OCCUPANCIES) {
    const values = SEASONS.map((s) => savings[s.id][key]);
    if (new Set(values).size !== 1) {
      throw new Error(
        `packages: ${key} saving differs across seasons on "${p.id}" (${values.join(", ")}) — the savings line assumes one figure`,
      );
    }
  }
  const saving = savings.low;

  validateDerived(p, prices, saving);

  const bySeason = (build) =>
    Object.fromEntries(SEASONS.map((s) => [s.id, build(s)]));
  return {
    ...p,
    prices,
    saving,
    // Consumed by the packageCard Alpine component (client-side season
    // switching); formatting happens here so none happens in the browser.
    client: {
      prices: bySeason((s) => ({
        solo: formatPrice(prices[s.id].solo),
        double: formatPrice(prices[s.id].double),
      })),
      values: bySeason((s) => prices[s.id].double),
      wa: bySeason((s) =>
        waHref(
          `Hi LUMA, I'd like to enquire about ${p.name} (${p.nights} nights) — ${s.label.toLowerCase()} season. My dates are: `,
        ),
      ),
    },
  };
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
    // One AggregateOffer per package per occupancy — Low-season figure as
    // lowPrice, High-season as highPrice, one offer per season.
    offers: packages.flatMap((p) =>
      OCCUPANCIES.map(({ key }) => ({
        "@type": "AggregateOffer",
        name: `${p.name} (${p.nights} nights, ${key === "solo" ? "solo" : "two sharing"})`,
        description: p.tagline,
        lowPrice: p.prices.low[key],
        highPrice: p.prices.high[key],
        offerCount: SEASONS.length,
        priceCurrency: "INR",
        availabilityStarts: SEASON.start,
        availabilityEnds: SEASON.end,
        seller,
      })),
    ),
  };
}

/** Validates and shapes the package data for the page template. */
export function loadPackagesPageData() {
  validate(PACKAGES);
  validateRoomRates();
  validateSeasonCoverage();
  const packages = PACKAGES.map(derivePackage);
  const included = includedTreatments();
  const fromPrice = Math.min(...packages.map((p) => p.prices.low.solo));

  return {
    packages,
    season: SEASON,
    // Room rates stay out of the template locals — only what renders.
    seasons: SEASONS.map(({ id, label, window }) => ({ id, label, window })),
    stay: STAY,
    timeline: TIMELINE,
    includedTreatments: included,
    includedCountWord: numberToWord(included.length, false),
    fromPrice: formatPrice(fromPrice),
    formatPrice,
    schemaData: buildSchema(packages),
  };
}
