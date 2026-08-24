// Generic build-time helpers shared by the data loaders in this directory.

/** Guest-facing INR price string: 26000 → "₹26,000". */
export function formatPrice(price) {
  return `₹${price.toLocaleString("en-IN")}`;
}

// INR → EUR rate behind the indicative euro figures on /yoga-holidays.
// Everything is priced and charged in INR; this is a hand-maintained
// convenience rate — update it here when it drifts, nowhere else.
export const INR_TO_EUR = 0.0089;

/** INR converted to EUR, rounded to the nearest 5: 26000 → 230. */
export function toEur(price) {
  return Math.round((price * INR_TO_EUR) / 5) * 5;
}

/**
 * The EUR figure on its own, grouped: 26000 → "230". For markup that renders
 * the "EUR" unit itself, in smaller type beside the number — the price cards
 * on /yoga-holidays do exactly that.
 */
export function eurAmount(price) {
  return toEur(price).toLocaleString("en-IE");
}

/**
 * Guest-facing EUR price string, unit included: 26000 → "230 EUR". For plain
 * text with nowhere to hang a unit of its own — meta descriptions, prose.
 */
export function formatEur(price) {
  return `${eurAmount(price)} EUR`;
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

/**
 * 25 → "Twenty-five" (or "twenty-five" with capitalize=false).
 * Covers 0–99, which is plenty for a treatment menu.
 */
export function numberToWord(n, capitalize = true) {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`numberToWord: expected an integer in 0-99, got ${n}`);
  }
  const word =
    n < 20
      ? ONES[n]
      : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  return capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
