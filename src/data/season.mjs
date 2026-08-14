// Season calendar for /packages — the one source of truth for which dates
// fall in which season. Imported at build time by load-packages.mjs (price
// derivation, coverage validation) and bundled client-side via
// src/ts/packages.ts (the season selector's default), so a calendar change
// can never desync the rendered prices from the client's preselected season.
//
// Deliberately dependency-free and free of any rate/price data — this module
// ships to the browser.

export const SEASON_IDS = ["low", "mid", "high"];

export const SEASON_LABELS = { low: "Low", mid: "Mid", high: "High" };

// Evaluated in order — High overrides the Mid December/January window, so
// resolve High first. A range whose `from` is greater than its `to` wraps
// the year end. The Mid rule runs to 02-29 so it still matches 29 February
// in a leap year.
// [CONFIRM] March was not assigned by the owner — specced as Mid because it
// sits between Mid February and Low April. One-line change if Low.
export const SEASON_RULES = [
  { season: "high", from: "12-15", to: "01-15" },
  { season: "mid", from: "12-01", to: "02-29" },
  { season: "mid", from: "03-01", to: "03-31" },
  { season: "low", from: "11-01", to: "11-30" },
  { season: "low", from: "04-01", to: "05-31" },
];

// "MM-DD" → comparable month/day ordinal, parsed once at module load.
const PARSED_RULES = SEASON_RULES.map((rule) => {
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
 * The season containing `date`, or null outside the packages window
 * (June–October — packages start 1 November).
 */
export function resolveSeason(date) {
  const value = (date.getMonth() + 1) * 100 + date.getDate();
  for (const rule of PARSED_RULES) {
    const matches =
      rule.from <= rule.to
        ? value >= rule.from && value <= rule.to
        : value >= rule.from || value <= rule.to;
    if (matches) return rule.season;
  }
  return null;
}
