// Build-time loader for the /yoga-holidays page. Imported by vite.config.mjs
// only — never shipped to the client. Derives the three seasonal price sets
// from the rate model below (holiday total = room rate + per-person daily
// inclusions + embedded massage value − length discount; saving = the gap to
// booking the same stay à la carte), validates them against build-time
// invariants, and shapes everything the EJS template needs (JSON-LD, WhatsApp
// links, the included-treatments list).
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

// Yoga holidays are available 15 November – 30 April. (The resort itself
// re-opens in October, but stays before 15 November are not sold as yoga
// holidays.) Must stay in step with SEASON_RULES in season.mjs —
// validateSeasonCoverage() below fails the build if any day in this window
// resolves to no season.
const SEASON = {
  start: "2026-11-15",
  end: "2027-04-30",
  display: "15 November 2026 – 30 April 2027",
};

// Rack (std) vs yoga-holiday (hol) room rates — a flat discount per night in
// every season (asserted below against RATES.roomDiscountPerNight), which
// is what keeps the savings figure season-independent. The window strings
// are guest-facing pill labels and must agree with season.mjs — note Mid
// excludes 15–31 Dec (High) so no date is claimed by two pills.
const SEASONS = [
  {
    id: "low",
    label: "Low",
    window: "15 - 30 Nov · Apr",
    room: { hol: 5000, std: 5500 },
  },
  {
    id: "mid",
    label: "Mid",
    window: "1 - 14 Dec · 16 Jan - Mar",
    room: { hol: 7000, std: 7500 },
  },
  {
    id: "high",
    label: "High",
    window: "15 Dec - 15 Jan",
    room: { hol: 9000, std: 9500 },
  },
];

const RATES = {
  perPersonDay: 1000, // ₹450 yoga + ₹550 breakfast, pp/day
  massage: 2500, // embedded massage value
  alcPerPersonDay: 1750, // à-la-carte: 2 × ₹600 yoga + ₹550 breakfast
  alcMassage: 2900, // à-la-carte: Abhyangam, cheapest holiday-eligible
  lengthDiscount: { 3: 0, 5: 2000, 7: 4000 }, // lump sum, season-independent
  roomDiscountPerNight: 500,
};

const STAY = { checkIn: "14:00", checkOut: "11:00" };

// Recommended class times, not a confirmed schedule — verify
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

const HOLIDAYS = [
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

/** Holiday price and à-la-carte saving for one season and occupancy. */
function priceAndSaving(holiday, season, people) {
  const discount = RATES.lengthDiscount[holiday.nights];
  if (discount === undefined) {
    throw new Error(
      `yoga-holidays: no length discount defined for ${holiday.nights} nights on "${holiday.id}"`,
    );
  }
  const total =
    season.room.hol * holiday.nights +
    RATES.perPersonDay * holiday.nights * people +
    RATES.massage * holiday.massages * people -
    discount;
  const alaCarte =
    season.room.std * holiday.nights +
    RATES.alcPerPersonDay * holiday.nights * people +
    RATES.alcMassage * holiday.massages * people;
  return { price: total, saving: alaCarte - total };
}

/** Throws (failing the build) rather than rendering a broken card. */
function validate(holidays) {
  if (!Array.isArray(holidays) || holidays.length === 0) {
    throw new Error("yoga-holidays: expected a non-empty array");
  }
  const ids = new Set();
  for (const p of holidays) {
    if (!p.id || typeof p.id !== "string") {
      throw new Error("yoga-holidays: missing or invalid id");
    }
    if (ids.has(p.id)) {
      throw new Error(`yoga-holidays: duplicate id "${p.id}"`);
    }
    ids.add(p.id);
    const label = `holiday "${p.id}"`;
    if (!p.name || !p.tagline) {
      throw new Error(`yoga-holidays: missing name or tagline on ${label}`);
    }
    if (!Number.isInteger(p.nights) || p.nights <= 0) {
      throw new Error(`yoga-holidays: invalid nights on ${label}`);
    }
    if (!Number.isInteger(p.massages) || p.massages <= 0) {
      throw new Error(`yoga-holidays: invalid massages on ${label}`);
    }
  }
  if (holidays.filter((p) => p.featured).length !== 1) {
    throw new Error("yoga-holidays: expected exactly one featured holiday");
  }
}

/** Invariants over the derived seasonal prices — throws on failure. */
function validateDerived(p, prices, saving) {
  const label = `holiday "${p.id}"`;
  for (const season of SEASONS) {
    const entry = prices[season.id];
    if (!entry) {
      throw new Error(`yoga-holidays: missing ${season.id} prices on ${label}`);
    }
    for (const { key } of OCCUPANCIES) {
      const value = entry[key];
      if (!Number.isInteger(value) || value <= 0 || value % 100 !== 0) {
        throw new Error(
          `yoga-holidays: ${season.id} ${key} price on ${label} is not a positive multiple of 100 (got ${value})`,
        );
      }
    }
    if (entry.solo >= entry.double) {
      throw new Error(
        `yoga-holidays: ${season.id} solo price not below two-sharing on ${label}`,
      );
    }
  }
  for (const { key } of OCCUPANCIES) {
    if (
      !(prices.low[key] < prices.mid[key] && prices.mid[key] < prices.high[key])
    ) {
      throw new Error(
        `yoga-holidays: ${key} prices not strictly increasing Low → Mid → High on ${label}`,
      );
    }
    if (!Number.isInteger(saving[key]) || saving[key] <= 0) {
      throw new Error(`yoga-holidays: invalid ${key} saving on ${label}`);
    }
  }
}

/**
 * The flat per-night room discount is what the season-independent savings
 * rest on — assert every season's rack/holiday gap actually equals it.
 */
function validateRoomRates() {
  for (const season of SEASONS) {
    const gap = season.room.std - season.room.hol;
    if (gap !== RATES.roomDiscountPerNight) {
      throw new Error(
        `yoga-holidays: ${season.id} room discount is ${gap}, expected RATES.roomDiscountPerNight (${RATES.roomDiscountPerNight})`,
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
 * The treatments a yoga-holiday guest can choose from, read via the
 * holidayEligible flag — never hard-coded a second time.
 */
function includedTreatments() {
  const eligible = rawTreatments
    .filter((t) => t.active !== false && t.holidayEligible)
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) -
          CATEGORY_ORDER.indexOf(b.category) || a.order - b.order,
    );
  if (eligible.length === 0) {
    throw new Error("yoga-holidays: no holidayEligible treatments found");
  }
  return eligible;
}

/**
 * Prices, season-independent saving, and the payload the seasonSelector /
 * holidayCard Alpine components consume (formatted price strings, raw
 * two-sharing values for analytics, season-aware WhatsApp hrefs).
 */
function deriveHoliday(p) {
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
        `yoga-holidays: ${key} saving differs across seasons on "${p.id}" (${values.join(", ")}) — the savings line assumes one figure`,
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
    // Consumed by the holidayCard Alpine component (client-side season
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

function buildSchema(holidays) {
  const seller = { "@type": "Hotel", name: "Luma", url: `${SITE_URL}/` };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "LUMA Goa Yoga Holidays",
    description:
      "Yoga holidays in Palolem, South Goa: a boutique A-frame hut with unlimited daily yoga, plant-based breakfast and Ayurvedic massage included.",
    url: `${SITE_URL}/yoga-holidays`,
    image: `${SITE_URL}/img/yoga-holidays-hero.jpg`,
    brand: seller,
    // One AggregateOffer per holiday per occupancy — Low-season figure as
    // lowPrice, High-season as highPrice, one offer per season.
    offers: holidays.flatMap((p) =>
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

/** Validates and shapes the yoga-holiday data for the page template. */
export function loadYogaHolidaysPageData() {
  validate(HOLIDAYS);
  validateRoomRates();
  validateSeasonCoverage();
  const holidays = HOLIDAYS.map(deriveHoliday);
  const included = includedTreatments();
  const fromPrice = Math.min(...holidays.map((p) => p.prices.low.solo));

  return {
    holidays,
    season: SEASON,
    // Room rates stay out of the template locals — only what renders.
    seasons: SEASONS.map(({ id, label, window }) => ({ id, label, window })),
    stay: STAY,
    timeline: TIMELINE,
    includedTreatments: included,
    includedCountWord: numberToWord(included.length, false),
    fromPrice: formatPrice(fromPrice),
    formatPrice,
    schemaData: buildSchema(holidays),
  };
}
