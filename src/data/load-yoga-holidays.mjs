// Build-time loader for the /yoga-holidays page. Imported by vite.config.mjs
// only — never shipped to the client. Reads the guest-facing EUR price list
// from yoga-holiday-prices.json (nights → season → solo/shared), validates it
// against build-time invariants, and shapes everything the EJS template needs
// (JSON-LD, WhatsApp links, the included-treatments list).
//
// Which seasons exist, what they are called and which dates they cover all
// live in season.mjs; the prices live in yoga-holiday-prices.json — that is
// the only file to touch when they change.
import rawPrices from "./yoga-holiday-prices.json" with { type: "json" };
import rawTreatments from "./treatments.json" with { type: "json" };
import { CATEGORY_ORDER } from "./load-treatments.mjs";
import {
  DEFAULT_SEASON,
  HIGHEST_SEASON,
  resolveSeasonRule,
  SEASON,
  SEASONS,
} from "./season.mjs";
import { SITE_URL, waHref } from "./site.mjs";
import { eurAmount, formatEur, numberToWord } from "./utils.mjs";

const STAY = { checkIn: "14:00", checkOut: "11:00" };

// Recommended class times, not a confirmed schedule — verify
// against the final October schedule before publishing.
const TIMELINE = [
  {
    time: "08:00",
    title: "Morning practice",
    text: "Dynamic Hatha or Vinyasa in the shaded yoga shala equipped with high quality mats and props.",
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

// "shared" is the total for two people sharing, not a per-person figure —
// both in the price JSON and everywhere downstream.
const OCCUPANCIES = ["solo", "shared"];

/** A holiday's per-season EUR price table — throws if the JSON has none. */
function priceTable(holiday) {
  const table = rawPrices[holiday.nights];
  if (!table) {
    throw new Error(
      `yoga-holidays: no ${holiday.nights}-night entry in yoga-holiday-prices.json for "${holiday.id}"`,
    );
  }
  return table;
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

/**
 * Invariants over a holiday's price table — throws on failure, so a typo in
 * yoga-holiday-prices.json fails the build instead of rendering a wrong card.
 */
function validatePrices(p, prices) {
  const label = `holiday "${p.id}"`;
  for (const season of SEASONS) {
    const entry = prices[season.id];
    if (!entry) {
      throw new Error(`yoga-holidays: missing ${season.id} prices on ${label}`);
    }
    for (const key of OCCUPANCIES) {
      const value = entry[key];
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(
          `yoga-holidays: ${season.id} ${key} price on ${label} is not a positive integer (got ${value})`,
        );
      }
    }
    if (entry.solo >= entry.shared) {
      throw new Error(
        `yoga-holidays: ${season.id} solo price not below two-sharing on ${label}`,
      );
    }
  }
  // SEASONS is ordered cheapest first, so every step up it must cost more.
  for (const key of OCCUPANCIES) {
    for (let i = 1; i < SEASONS.length; i += 1) {
      const cheaper = SEASONS[i - 1];
      const dearer = SEASONS[i];
      if (prices[cheaper.id][key] >= prices[dearer.id][key]) {
        throw new Error(
          `yoga-holidays: ${key} prices not strictly increasing ${cheaper.label} → ${dearer.label} on ${label}`,
        );
      }
    }
  }
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
});
const RANGE_LIST = new Intl.ListFormat("en-GB", {
  style: "long",
  type: "conjunction",
});

/**
 * Walks the open season day by day and returns the contiguous date ranges
 * yoga holidays can actually be booked for — SEASON minus the closure rules.
 * A day no rule covers at all is a calendar gap (e.g. March never confirmed)
 * and fails the build, as does a season in SEASONS no date resolves to,
 * whose pill nothing could ever select.
 */
function getAvailableDates() {
  const localDay = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const end = new Date(`${SEASON.end}T00:00:00`);
  const ranges = [];
  const reached = new Set();
  let current = null;
  for (
    const d = new Date(`${SEASON.start}T00:00:00`);
    d <= end;
    d.setDate(d.getDate() + 1)
  ) {
    const rule = resolveSeasonRule(d);
    if (!rule) {
      throw new Error(`SEASON_RULES: no season resolves for ${localDay(d)}`);
    }
    // A closure ends the range in progress; the next open day starts a new one.
    if (rule.season === null) {
      current = null;
      continue;
    }
    reached.add(rule.season);
    if (current === null) {
      current = { from: new Date(d), to: new Date(d) };
      ranges.push(current);
    } else {
      current.to = new Date(d);
    }
  }
  if (ranges.length === 0) {
    throw new Error("SEASON_RULES: every day of the open season is closed");
  }
  for (const season of SEASONS) {
    if (!reached.has(season.id)) {
      throw new Error(
        `SEASON_RULES: no available date resolves to "${season.id}" — its pill would be unreachable`,
      );
    }
  }
  return ranges;
}

/**
 * The available dates as one guest-facing sentence fragment ("15 November –
 * 14 December 2026 and 16 January – 30 April 2027"). Derived rather than
 * authored so adding a closure can never leave the page advertising dates
 * we do not sell.
 */
function formatAvailableDates(ranges) {
  return RANGE_LIST.format(
    ranges.map(({ from, to }) =>
      from.getFullYear() === to.getFullYear()
        ? `${DAY_MONTH.format(from)} – ${DAY_MONTH.format(to)} ${to.getFullYear()}`
        : `${DAY_MONTH.format(from)} ${from.getFullYear()} – ${DAY_MONTH.format(to)} ${to.getFullYear()}`,
    ),
  );
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
 * The per-season EUR prices and the payload the seasonSelector / holidayCard
 * Alpine components consume (formatted price strings, raw two-sharing values
 * for analytics, season-aware WhatsApp hrefs).
 */
function deriveHoliday(p) {
  const table = priceTable(p);
  validatePrices(p, table);
  // Only the seasons in SEASONS make it into the template locals — an entry
  // for a parked season stays in the JSON without rendering anywhere.
  const prices = Object.fromEntries(
    SEASONS.map((s) => [
      s.id,
      { solo: table[s.id].solo, shared: table[s.id].shared },
    ]),
  );

  const bySeason = (build) =>
    Object.fromEntries(SEASONS.map((s) => [s.id, build(s)]));
  return {
    ...p,
    prices,
    // Consumed by the holidayCard Alpine component (client-side season
    // switching). Formatting happens here, never in the browser; the bare
    // number is what ships, because the card markup renders the "EUR" unit
    // beside it, in its own smaller type. `values` feeds the analytics
    // events: the two-sharing EUR price, the currency quoted to guests.
    client: {
      prices: bySeason((s) => ({
        solo: eurAmount(prices[s.id].solo),
        shared: eurAmount(prices[s.id].shared),
      })),
      values: bySeason((s) => prices[s.id].shared),
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
    // One AggregateOffer per holiday per occupancy — cheapest season as
    // lowPrice, dearest as highPrice, one offer per season.
    offers: holidays.flatMap((p) =>
      OCCUPANCIES.map((key) => ({
        "@type": "AggregateOffer",
        name: `${p.name} (${p.nights} nights, ${key === "solo" ? "solo" : "two sharing"})`,
        description: p.tagline,
        lowPrice: p.prices[DEFAULT_SEASON.id][key],
        highPrice: p.prices[HIGHEST_SEASON.id][key],
        offerCount: SEASONS.length,
        // EUR, matching the figures on the page — structured data that
        // contradicts the visible price is worse than none.
        priceCurrency: "EUR",
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
  const availableDates = getAvailableDates();
  const holidays = HOLIDAYS.map(deriveHoliday);
  const included = includedTreatments();
  const fromPrice = Math.min(
    ...holidays.map((p) => p.prices[DEFAULT_SEASON.id].solo),
  );

  return {
    holidays,
    season: { ...SEASON, display: formatAvailableDates(availableDates) },
    seasons: SEASONS,
    // The season the cards are rendered in server-side (the no-JS fallback),
    // and the dearest one, whose window the cancellation policy quotes.
    defaultSeason: DEFAULT_SEASON,
    highestSeason: HIGHEST_SEASON,
    stay: STAY,
    timeline: TIMELINE,
    includedTreatments: included,
    includedCountWord: numberToWord(included.length, false),
    // Plain text in the meta description, so it carries its own unit.
    fromPrice: formatEur(fromPrice),
    schemaData: buildSchema(holidays),
  };
}
