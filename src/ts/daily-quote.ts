import type Alpine from "alpinejs";

interface Quote {
  author: string;
  text: string;
}

/**
 * Registers the Alpine component backing the footer quote. Picks a quote from
 * /quotes.json deterministically by day of year, so every visitor sees the
 * same quote on a given day. The markup's hardcoded quote doubles as the
 * fallback when the fetch fails.
 */
export function registerQuoteComponents(alpine: typeof Alpine) {
  alpine.data("dailyQuote", () => ({
    text: "The soul always knows what to do to heal itself.",
    author: "Caroline Myss",

    async init() {
      try {
        const response = await fetch("/quotes.json");
        if (!response.ok) {
          console.error("Failed to fetch quotes.json");
          return;
        }
        const quotes: Quote[] = await response.json();
        if (quotes.length === 0) {
          console.warn("No quotes available.");
          return;
        }

        const today = +new Date();
        const lastDayLastYear = +new Date(new Date().getFullYear(), 0, 0); // Dec 31 of the previous year
        const dayOfYear = Math.floor((today - lastDayLastYear) / 86400000); // e.g. for February 1st, it equals 32

        const quote = quotes[dayOfYear % quotes.length];
        if (!quote || !quote.text || !quote.author) return;

        this.text = quote.text;
        this.author = quote.author;
      } catch (error) {
        console.error("Error updating daily quote:", error);
      }
    },
  }));
}
