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

/** Guest-facing EUR price string: 26000 → "€230". */
export function formatEur(price) {
  return `${toEur(price).toLocaleString("en-IE")}`;
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
