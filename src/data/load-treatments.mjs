// Build-time loader for the Ayurveda & Massage page. Imported by
// vite.config.mjs only — never shipped to the client. Validates
// treatments.json and derives everything the EJS template needs (grouped
// categories, JSON-LD, WhatsApp links) from the one array.
//
// treatments.json is owner-approved and several of its apparent
// inconsistencies are deliberate decisions — read
// docs/ayurveda-massage-notes.md before "fixing" the data.
//
// The JSON is imported (not readFileSync'd) so Vite tracks it as a config
// dependency and auto-restarts the dev server when it changes.
import rawTreatments from "./treatments.json" with { type: "json" };
import { EMAIL, PHONE_DISPLAY, SITE_URL, waHref } from "./site.mjs";
import { numberToWord } from "./utils.mjs";

const CATEGORY_ORDER = [
  "signature",
  "specialized-body",
  "focused",
  "doctor-recommended",
  "western",
  "combo",
  "consultation",
];

const CATEGORIES = {
  signature: {
    name: "Signature Ayurvedic Massages",
    intro: null,
  },
  "specialized-body": {
    name: "Specialized Body Treatments",
    intro: "Deeper, longer, and drawn from the oldest texts.",
  },
  focused: {
    name: "Focused Treatments",
    intro: "When one part of you needs attention more than the rest.",
  },
  "doctor-recommended": {
    name: "Doctor-Recommended Treatments",
    intro:
      "Therapeutic protocols, available after a consultation with our Ayurvedic doctor.",
  },
  western: {
    name: "Western Therapies",
    intro:
      "Familiar techniques, delivered by therapists trained in both traditions.",
  },
  combo: {
    name: "Combinations (90 min)",
    intro: null,
  },
  consultation: {
    name: "Doctor Consultation",
    intro: null,
  },
};

const INTENTS = [
  { key: "tension", label: "Tension & pain" },
  { key: "rest", label: "Deep rest & sleep" },
  { key: "detox", label: "Detox & renewal" },
  { key: "energy", label: "Energy & balance" },
  { key: "skin", label: "Skin & radiance" },
  { key: "head", label: "Head & sinus" },
];

const PACKAGE_ELIGIBLE_COUNT = 7;

// Records that are offered but are not therapies — excluded from the
// "N traditional therapies" count in the page copy.
const NON_TREATMENT_IDS = ["doctor-consultation"];

/** Throws (failing the build) rather than silently dropping a record. */
function validate(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("treatments.json: expected a non-empty array");
  }
  const ids = new Set();
  const intentKeys = new Set(INTENTS.map((i) => i.key));
  for (const [index, t] of raw.entries()) {
    if (!t || !t.id || typeof t.id !== "string") {
      throw new Error(
        `treatments.json: missing or invalid id on record at index ${index}`,
      );
    }
    if (ids.has(t.id)) {
      throw new Error(`treatments.json: duplicate id "${t.id}"`);
    }
    ids.add(t.id);
    const label = `treatment "${t.id}"`;
    if (!t.title || typeof t.title !== "string") {
      throw new Error(`treatments.json: missing title on ${label}`);
    }
    if (!t.description || typeof t.description !== "string") {
      throw new Error(`treatments.json: missing description on ${label}`);
    }
    if (/^DRAFT/.test(t.description)) {
      throw new Error(
        `treatments.json: ${label} has a DRAFT description — it must not go to production until the owner signs off`,
      );
    }
    if (!CATEGORY_ORDER.includes(t.category)) {
      throw new Error(
        `treatments.json: unknown category "${t.category}" on ${label}`,
      );
    }
    if (typeof t.order !== "number") {
      throw new Error(`treatments.json: missing order on ${label}`);
    }
    if (
      !Array.isArray(t.durations) ||
      t.durations.length === 0 ||
      t.durations.some(
        (d) =>
          typeof d.length !== "number" ||
          typeof d.price !== "number" ||
          d.length <= 0 ||
          d.price <= 0,
      )
    ) {
      throw new Error(
        `treatments.json: empty or invalid durations on ${label}`,
      );
    }
    if (
      !Array.isArray(t.intents) ||
      t.intents.some((i) => !intentKeys.has(i))
    ) {
      throw new Error(`treatments.json: invalid intents on ${label}`);
    }
    if (typeof t.packageEligible !== "boolean") {
      throw new Error(`treatments.json: missing packageEligible on ${label}`);
    }
    if (t.image !== null && (typeof t.image !== "string" || t.image === "")) {
      throw new Error(`treatments.json: invalid image on ${label}`);
    }
    if (typeof t.active !== "boolean") {
      throw new Error(`treatments.json: missing active on ${label}`);
    }
  }

  // Dataset-level invariants, over the records that will actually render.
  const active = raw.filter((t) => t.active !== false);
  const eligible = active.filter((t) => t.packageEligible);
  if (eligible.length !== PACKAGE_ELIGIBLE_COUNT) {
    throw new Error(
      `treatments.json: expected exactly ${PACKAGE_ELIGIBLE_COUNT} packageEligible treatments, found ${eligible.length} (${eligible.map((t) => t.id).join(", ")})`,
    );
  }
  const emptyCategories = CATEGORY_ORDER.filter(
    (key) => !active.some((t) => t.category === key),
  );
  if (emptyCategories.length > 0) {
    throw new Error(
      `treatments.json: no active treatments in category ${emptyCategories.join(", ")}`,
    );
  }
}

function formatPrice(price) {
  return `₹${price.toLocaleString("en-IN")}`;
}

function waLink(title) {
  return waHref(
    `Hi LUMA, I'd like to book a ${title} treatment. My preferred time is: `,
  );
}

function buildSchema(treatments) {
  return {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: "LUMA Goa Ayurvedic Treatment Centre",
    description:
      "Traditional Ayurvedic massage and therapies in Palolem, South Goa. Abhyangam, Podikizhi, Elakizhi and more, 200 m from Palolem Beach.",
    url: `${SITE_URL}/ayurveda-massage`,
    telephone: PHONE_DISPLAY,
    email: EMAIL,
    openingHours: "Mo-Su 08:00-21:00",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Palolem Down St",
      addressLocality: "Palolem",
      addressRegion: "South Goa",
      postalCode: "403702",
      addressCountry: "IN",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: 15.0126252,
      longitude: 74.0210419,
    },
    image: `${SITE_URL}/img/luma_flower_hut.jpg`,
    parentOrganization: {
      "@type": "Hotel",
      name: "Luma",
      url: `${SITE_URL}/`,
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Ayurvedic Treatments and Therapies",
      // One Offer per duration — a multi-duration treatment (Foot Massage)
      // has genuinely distinct prices, not one price.
      itemListElement: treatments.flatMap((t) =>
        t.durations.map((d) => ({
          "@type": "Offer",
          price: d.price,
          priceCurrency: "INR",
          itemOffered: {
            "@type": "Service",
            name:
              t.durations.length === 1
                ? t.title
                : `${t.title} (${d.length} min)`,
            description: t.description,
          },
        })),
      ),
    },
  };
}

/** Validates and shapes the treatment data for the page template. */
export function loadTreatmentPageData() {
  validate(rawTreatments);

  const treatments = rawTreatments
    .filter((t) => t.active !== false)
    .sort((a, b) => a.order - b.order)
    // Asset paths must be root-relative; tolerate owner-edited paths
    // without the leading slash.
    .map((t) =>
      t.image && !t.image.startsWith("/") ? { ...t, image: `/${t.image}` } : t,
    );

  const byCategory = CATEGORY_ORDER.map((key) => ({
    key,
    ...CATEGORIES[key],
    items: treatments.filter((t) => t.category === key),
  }));

  const unknownNonTreatment = NON_TREATMENT_IDS.filter(
    (id) => !rawTreatments.some((t) => t.id === id),
  );
  if (unknownNonTreatment.length > 0) {
    throw new Error(
      `NON_TREATMENT_IDS lists unknown ids: ${unknownNonTreatment.join(", ")}`,
    );
  }
  const therapyCount = treatments.filter(
    (t) => !NON_TREATMENT_IDS.includes(t.id),
  ).length;

  return {
    therapyCount,
    therapyCountWord: numberToWord(therapyCount),
    treatments,
    // The two-tier menu (Section 5.4): signature is tier 1, the rest are
    // tier-2 rows. Combos and the consultation render in their own section.
    signature: byCategory.find((c) => c.key === "signature"),
    tierTwo: byCategory.filter((c) =>
      ["specialized-body", "focused", "doctor-recommended", "western"].includes(
        c.key,
      ),
    ),
    combos: byCategory.find((c) => c.key === "combo"),
    consultation: byCategory.find((c) => c.key === "consultation").items[0],
    intents: INTENTS,
    formatPrice,
    waLink,
    schemaData: buildSchema(treatments),
  };
}
