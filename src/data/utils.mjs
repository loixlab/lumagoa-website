// Generic build-time helpers shared by the data loaders in this directory.

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
