// Season calendar for /yoga-holidays — the one source of truth for which
// seasons exist, which dates fall in which one, and how each is labelled.
// Imported at build time by load-yoga-holidays.mjs (price derivation,
// validation) and bundled client-side via src/ts/yoga-holidays.ts (the
// season selector's default), so a calendar change can never desync the
// rendered prices from the client's preselected season.
//
// Deliberately dependency-free and free of any rate/price data — this module
// ships to the browser. The room rates live in load-yoga-holidays.mjs,
// keyed by the season ids below.

// The outer window yoga holidays are sold in. (The resort itself re-opens
// in October, but stays before 15 November are not sold as yoga holidays.)
// Must stay in step with SEASON_RULES — getAvailableDates() in
// load-yoga-holidays.mjs fails the build if any day in this window is
// covered by no rule at all, and derives the guest-facing availability
// string from the days that are actually sold.
export const SEASON = {
  start: "2026-11-15",
  end: "2027-04-30",
};

// The seasons that exist, in ascending price order: the first is the
// cheapest — server-rendered as the no-JS fallback and quoted as the "from"
// price — and the last the most expensive, which is what the price
// invariants and the JSON-LD highPrice derive from. Everything downstream
// (pills, price table, validation, schema) is derived from this list, so
// adding or dropping a season is one edit here plus its ROOM_RATES entry in
// load-yoga-holidays.mjs.
//
// `window` is the guest-facing pill label and must describe the same dates
// as SEASON_RULES below — note Mid excludes 15 Dec – 15 Jan, which is closed
// rather than sold, so no date is claimed by two pills.
export const SEASONS = /** @type {const} */ ([
  { id: "low", label: "Low", window: "15 - 30 Nov · Apr" },
  { id: "mid", label: "Mid", window: "1 - 14 Dec · 16 Jan - Mar" },
  // { id: "high", label: "High", window: "15 Dec - 15 Jan" }, // We don't offer yoga holidays during high season
]);

export const SEASON_IDS = SEASONS.map((s) => s.id);

export const SEASON_LABELS = Object.fromEntries(
  SEASONS.map((s) => [s.id, s.label]),
);

/** Cheapest season: the server-rendered prices and the selector's fallback. */
export const DEFAULT_SEASON = SEASONS[0];

/** Most expensive season: the top of every derived price range. */
export const HIGHEST_SEASON = SEASONS[SEASONS.length - 1];

export const DEFAULT_SEASON_ID = DEFAULT_SEASON.id;

// Evaluated in order, first match wins — High overrides the Mid
// December/January window, so resolve High first. A range whose `from` is
// greater than its `to` wraps the year end. The Mid rule runs to 02-29 so it
// still matches 29 February in a leap year.
//
// A rule with `season: null` is a closure: those dates sit inside SEASON but
// are not sold, so they resolve to no season without counting as a calendar
// gap. Put one ahead of the rule that would otherwise claim them.
//
// Rules naming a season that is not in SEASONS are ignored, so dropping a
// season falls through to the next matching rule (drop High and Mid absorbs
// 15 Dec – 15 Jan, unless a closure claims those dates first).
// getAvailableDates() fails the build if a day is covered by no rule at all.
export const SEASON_RULES = [
  { season: null, from: "12-15", to: "01-15" }, // not sold — see SEASONS
  { season: "mid", from: "12-01", to: "02-29" },
  { season: "mid", from: "03-01", to: "03-31" },
  { season: "low", from: "11-15", to: "11-30" },
  { season: "low", from: "04-01", to: "04-30" },
];

// "MM-DD" → comparable month/day ordinal, parsed once at module load.
const PARSED_RULES = SEASON_RULES.filter(
  (rule) => rule.season === null || SEASON_IDS.includes(rule.season),
).map((rule) => {
  const ordinal = (monthDay) => {
    const [month, day] = monthDay.split("-").map(Number);
    return month * 100 + day;
  };
  return {
    season: rule.season,
    from: ordinal(rule.from),
    to: ordinal(rule.to),
  };
});

/**
 * The rule covering `date`, or null if no rule does — which means the date
 * is outside the yoga-holidays window entirely (1 May – 14 November).
 * A matched rule whose `season` is null is a closure inside the window;
 * only this function can tell the two apart.
 */
export function resolveSeasonRule(date) {
  const value = (date.getMonth() + 1) * 100 + date.getDate();
  for (const rule of PARSED_RULES) {
    const matches =
      rule.from <= rule.to
        ? value >= rule.from && value <= rule.to
        : value >= rule.from || value <= rule.to;
    if (matches) return rule;
  }
  return null;
}

/** The season containing `date`, or null if it is closed or out of season. */
export function resolveSeason(date) {
  return resolveSeasonRule(date)?.season ?? null;
}
