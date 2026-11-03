// Build-time loader for the weekly schedule on /yoga. Imported by
// vite.config.mjs only — never shipped to the client. Validates
// yoga-schedule.json and shapes it into the weeks rendered by
// src/partials/yoga-schedule.ejs, plus the schema.org Event list for the
// page's JSON-LD.
//
// The JSON is imported (not readFileSync'd) so Vite tracks it as a config
// dependency and auto-restarts the dev server when it changes.
import rawEvents from "./yoga-schedule.json" with { type: "json" };
import { SITE_URL } from "./site.mjs";

// The resort's clock. Which week the page opens on and the JSON-LD
// timestamps are both Goa time, whatever timezone the build runs in —
// Netlify builds in UTC.
const TIME_ZONE = "Asia/Kolkata";
const UTC_OFFSET = "+05:30";

// Classes starting before noon go in the Morning row, the rest in Evening —
// the row is derived, never stored, so it can't contradict timeStart.
const NOON = "12:00";
const SLOTS = [
  { id: "morning", label: "Morning" },
  { id: "evening", label: "Evening" },
];

// One day's Morning (or Evening) cell stacks its cards; more than this
// won't fit legibly.
const MAX_EVENTS_PER_SLOT = 4;

const FIELDS = [
  "date",
  "timeStart",
  "timeEnd",
  "title",
  "subTitle",
  "teachers",
  "highlight",
];

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHALA_PLACE = {
  "@type": "Place",
  name: "Luma Goa Yoga Shala",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Palolem Down St",
    addressLocality: "Palolem",
    addressRegion: "South Goa",
    postalCode: "403702",
    addressCountry: "IN",
  },
};

// --- Dates, as "YYYY-MM-DD" strings (they sort and compare as text) ------

function parseIso(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

function isRealDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    // Round-trip rejects dates that roll over, like 2026-02-30.
    !Number.isNaN(parseIso(value).getTime()) &&
    parseIso(value).toISOString().slice(0, 10) === value
  );
}

function addDays(iso, days) {
  const date = parseIso(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday starting the week that contains `iso`. */
function mondayOf(iso) {
  return addDays(iso, -((parseIso(iso).getUTCDay() + 6) % 7));
}

function todayInGoa() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "2026-11-02" → "2 Nov" (the column header). */
function shortDayMonth(iso) {
  const date = parseIso(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()].slice(0, 3)}`;
}

/** Monday "2026-11-02" → "2 – 8 November 2026", spanning months/years as needed. */
function weekLabel(monday) {
  const start = parseIso(monday);
  const end = parseIso(addDays(monday, 6));
  const [d1, m1, y1] = [
    start.getUTCDate(),
    MONTHS[start.getUTCMonth()],
    start.getUTCFullYear(),
  ];
  const [d2, m2, y2] = [
    end.getUTCDate(),
    MONTHS[end.getUTCMonth()],
    end.getUTCFullYear(),
  ];
  if (y1 !== y2) return `${d1} ${m1} ${y1} – ${d2} ${m2} ${y2}`;
  if (m1 !== m2) return `${d1} ${m1} – ${d2} ${m2} ${y2}`;
  return `${d1} – ${d2} ${m2} ${y2}`;
}

// --- Times, as 24h "HH:MM" strings (they compare as text too) -----------

function isTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function to12h(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return {
    clock: `${hours % 12 || 12}:${String(minutes).padStart(2, "0")}`,
    period: hours < 12 ? "AM" : "PM",
  };
}

/** "08:30", "09:30" → "8:30 – 9:30 AM"; "11:30", "12:30" → "11:30 AM – 12:30 PM". */
function formatTimeRange(start, end) {
  const a = to12h(start);
  const b = to12h(end);
  return a.period === b.period
    ? `${a.clock} – ${b.clock} ${b.period}`
    : `${a.clock} ${a.period} – ${b.clock} ${b.period}`;
}

/** ["A"] → "with A"; ["A", "B", "C"] → "with A, B & C"; [] → null. */
function formatTeachers(teachers) {
  if (teachers.length === 0) return null;
  if (teachers.length === 1) return `with ${teachers[0]}`;
  return `with ${teachers.slice(0, -1).join(", ")} & ${teachers.at(-1)}`;
}

function slotOf(event) {
  return event.timeStart < NOON ? "morning" : "evening";
}

// --- Validation -----------------------------------------------------------

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Throws (failing the build) rather than silently dropping an event. */
function validate(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("yoga-schedule.json: expected an array of events");
  }
  const perSlot = new Map();
  for (const [index, e] of raw.entries()) {
    const where = `yoga-schedule.json: event at index ${index}`;
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      throw new Error(`${where} is not an object`);
    }
    const unknown = Object.keys(e).filter((key) => !FIELDS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `${where} has unknown field(s) ${unknown.join(", ")} — allowed: ${FIELDS.join(", ")}`,
      );
    }
    if (!isRealDate(e.date)) {
      throw new Error(
        `${where}: date must be a real YYYY-MM-DD date, got ${JSON.stringify(e.date)}`,
      );
    }
    const label = `${where} (${e.date} "${e.title}")`;
    if (!isText(e.title)) {
      throw new Error(`${where} (${e.date}): missing title`);
    }
    if (!isTime(e.timeStart) || !isTime(e.timeEnd)) {
      throw new Error(
        `${label}: timeStart and timeEnd must be 24h HH:MM, got ${JSON.stringify(e.timeStart)} / ${JSON.stringify(e.timeEnd)}`,
      );
    }
    if (e.timeEnd <= e.timeStart) {
      throw new Error(`${label}: timeEnd must be after timeStart`);
    }
    if (e.subTitle !== undefined && !isText(e.subTitle)) {
      throw new Error(`${label}: subTitle must be non-empty text when set`);
    }
    if (
      e.teachers !== undefined &&
      (!Array.isArray(e.teachers) || !e.teachers.every(isText))
    ) {
      throw new Error(`${label}: teachers must be an array of names`);
    }
    // A strict boolean — the string "false" would otherwise read as truthy
    // and highlight the card.
    if (e.highlight !== undefined && typeof e.highlight !== "boolean") {
      throw new Error(`${label}: highlight must be true or false`);
    }
    const key = `${e.date} ${slotOf(e)}`;
    perSlot.set(key, (perSlot.get(key) ?? 0) + 1);
  }
  for (const [key, count] of perSlot) {
    if (count > MAX_EVENTS_PER_SLOT) {
      throw new Error(
        `yoga-schedule.json: ${count} events on ${key} — a slot holds at most ${MAX_EVENTS_PER_SLOT}`,
      );
    }
  }
}

// --- Shaping ----------------------------------------------------------------

function byStart(a, b) {
  return a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart);
}

function toCard(e) {
  return {
    time: formatTimeRange(e.timeStart, e.timeEnd),
    title: e.title,
    subTitle: e.subTitle ?? null,
    teachers: formatTeachers(e.teachers ?? []),
    highlight: e.highlight === true,
  };
}

function buildWeek(monday, events) {
  const dates = DAY_NAMES.map((_, i) => addDays(monday, i));
  return {
    monday,
    label: weekLabel(monday),
    days: dates.map((date, i) => ({
      date,
      name: DAY_NAMES[i],
      dateLabel: shortDayMonth(date),
    })),
    slots: SLOTS.map((slot) => ({
      ...slot,
      // One list of cards per day, Monday first; empty renders as "—".
      cells: dates.map((date) =>
        events
          .filter((e) => e.date === date && slotOf(e) === slot.id)
          .map(toCard),
      ),
    })),
  };
}

function toJsonLdEvent(e) {
  const teachers = e.teachers ?? [];
  const withTeachers = formatTeachers(teachers);
  return {
    "@type": "Event",
    name: e.title,
    description: `${e.title}${e.subTitle ? ` (${e.subTitle})` : ""}${withTeachers ? ` ${withTeachers}` : ""} at the LUMA Goa yoga shala in Palolem, South Goa.`,
    startDate: `${e.date}T${e.timeStart}:00${UTC_OFFSET}`,
    endDate: `${e.date}T${e.timeEnd}:00${UTC_OFFSET}`,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: SHALA_PLACE,
    image: `${SITE_URL}/img/yoga-shala-hero_display.jpg`,
    organizer: {
      "@type": "Organization",
      name: "Luma Goa Yoga Shala",
      url: `${SITE_URL}/yoga`,
    },
    ...(teachers.length > 0
      ? { performer: teachers.map((name) => ({ "@type": "Person", name })) }
      : {}),
  };
}

/**
 * Pure core of the loader — `today` ("YYYY-MM-DD", Goa time) is a parameter
 * so a run can be pinned to any date.
 *
 * Weeks run Monday–Sunday and cover every week from the earliest event to
 * the latest, gaps included, so the arrows always step one week. The week
 * containing `today` is always present (even if empty) and is the one the
 * page renders as plain HTML; `currentIndex` points at it.
 */
export function buildYogaSchedule(raw, today) {
  validate(raw);
  const events = [...raw].sort(byStart);

  const currentMonday = mondayOf(today);
  const mondays = [currentMonday, ...events.map((e) => mondayOf(e.date))];
  const first = mondays.reduce((a, b) => (b < a ? b : a));
  const last = mondays.reduce((a, b) => (b > a ? b : a));

  const weeks = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    weeks.push(buildWeek(monday, events));
  }
  const currentIndex = weeks.findIndex((w) => w.monday === currentMonday);

  return {
    // Also the /yoga <lastmod> in the built sitemap (vite.config.mjs).
    buildDate: today,
    weeks,
    currentIndex,
    // From the build date, not the build week's Monday: a mid-week deploy
    // must not list classes that already happened as EventScheduled.
    jsonLdEvents: events.filter((e) => e.date >= today).map(toJsonLdEvent),
  };
}

/** Validates and shapes yoga-schedule.json for /yoga, as of today in Goa. */
export function loadYogaSchedulePageData() {
  const yogaSchedule = buildYogaSchedule(rawEvents, todayInGoa());
  const current = yogaSchedule.weeks[yogaSchedule.currentIndex];
  if (current.slots.every((slot) => slot.cells.every((c) => c.length === 0))) {
    console.warn(
      `yoga-schedule.json: no classes in the build week (${current.label}) — /yoga opens on an empty schedule`,
    );
  }
  return { yogaSchedule };
}
