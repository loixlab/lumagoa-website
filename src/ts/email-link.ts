import type Alpine from "alpinejs";

/**
 * Registers the Alpine component behind the obfuscated contact email links,
 * replacing the old inline `document.write` snippets. The address is only
 * assembled at runtime, so it never appears verbatim in the static HTML
 * (same scraper protection as before).
 *
 * Usage: `<a x-data="emailLink" :href="href" x-text="address"></a>`, dropping
 * `x-text` when the link label isn't the address itself.
 */
export function registerEmailComponents(alpine: typeof Alpine) {
  alpine.data("emailLink", () => {
    const address = ["contact", "lumagoa.com"].join("@");
    return {
      address,
      href: `mailto:${address}`,
    };
  });
}
