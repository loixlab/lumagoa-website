import type Alpine from "alpinejs";
import rawReviews from "../data/reviews.json";

/** One record in src/data/reviews.json. */
interface Review {
  name: string;
  text: string;
  /** Whole stars out of 5. */
  rating: number;
  /** ISO date (yyyy-mm-dd). */
  date: string;
}

/** What the template binds — the date label is formatted once, at pick time. */
interface DisplayReview extends Review {
  dateLabel: string;
}

const REVIEWS: Review[] = rawReviews;

// Reviews show month + year only — the exact day is noise on a card.
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
});

/** `count` random items from `items`, via a Fisher–Yates shuffle of a copy. */
function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return pool.slice(0, count);
}

/**
 * Registers the Alpine component behind the reviews partial
 * (src/partials/reviews.ejs — includable on any page).
 *
 * `reviews(count)` picks `count` random entries from src/data/reviews.json
 * on every page load and exposes them as `picked` for the partial's `x-for`.
 * The selection is client-side by design: the static build renders the same
 * HTML for everyone, so randomising at runtime is what keeps the section
 * fresh between visits.
 */
export function registerReviewsComponents(alpine: typeof Alpine) {
  alpine.data("reviews", (count = 4) => ({
    picked: [] as DisplayReview[],

    init() {
      this.picked = pickRandom(REVIEWS, Number(count)).map((review) => ({
        ...review,
        // T00:00:00 forces local-time parsing — a bare ISO date parses as
        // UTC midnight, which renders as the previous month for viewers
        // west of UTC on first-of-month dates.
        dateLabel: MONTH_YEAR.format(new Date(`${review.date}T00:00:00`)),
      }));
    },
  }));
}
