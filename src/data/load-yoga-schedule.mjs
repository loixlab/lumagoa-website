// Build-time loader for the weekly schedule on /yoga. Imported by
// vite.config.mjs only — never shipped to the client. Reads the classes from
// the office's Google Sheet (one row per class, exported as CSV — see
// docs/yoga-schedule-sheet.md), validates them and shapes them into the weeks
// rendered by src/partials/yoga-schedule.ejs, plus the schema.org Event list
// for the page's JSON-LD.
//
// Without YOGA_SCHEDULE_CSV_URL (local builds, Deploy Previews) it falls back
// to yoga-schedule.sample.json; a production build refuses to, rather than
// publish placeholder classes. The sample is imported (not readFileSync'd) so
// Vite tracks it as a config dependency.
import sampleEvents from "./yoga-schedule.sample.json" with { type: "json" };
// The same RFC 4180 parser get-booking uses for its sheet — dependency-free,
// so it runs here at build time too.
import { parseCsv } from "../../netlify/utils.ts";
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

/**
 * Throws (failing the build) rather than silently dropping an event.
 * `labelOf(index)` names an event's source in messages — a sheet row or a
 * JSON index — so the error points at the line to fix.
 */
function validate(raw, labelOf) {
  if (!Array.isArray(raw)) {
    throw new Error("Yoga schedule: expected an array of events");
  }
  const perSlot = new Map();
  for (const [index, e] of raw.entries()) {
    const where = labelOf(index);
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
    perSlot.set(key, [...(perSlot.get(key) ?? []), where]);
  }
  for (const [key, sources] of perSlot) {
    if (sources.length > MAX_EVENTS_PER_SLOT) {
      throw new Error(
        `Yoga schedule: ${sources.length} classes on ${key} (${sources.join(", ")}) — a slot holds at most ${MAX_EVENTS_PER_SLOT}`,
      );
    }
  }
}

// --- The schedule sheet -----------------------------------------------------

// Sheet column headers (matched case-insensitively, in any order) → the event
// field each fills. "Notes" is for the office and never read. Keep in step
// with HEADERS in the sheet's Apps Script (docs/yoga-schedule-sheet.md).
const SHEET_COLUMNS = {
  date: "date",
  start: "timeStart",
  end: "timeEnd",
  title: "title",
  subtitle: "subTitle",
  teachers: "teachers",
  highlight: "highlight",
  notes: null,
};
const REQUIRED_COLUMNS = ["date", "start", "end", "title"];

/** "8:30", "08:30" or "08:30:00" → "08:30"; anything else is left for validate() to reject. */
function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
}

/**
 * Turns the sheet's CSV export into events, plus each one's sheet row number
 * so errors point the office at the exact row. Blank rows are skipped. Header
 * problems throw here; cell problems are left to validate().
 */
export function parseScheduleSheet(csv) {
  const [header = [], ...body] = parseCsv(csv.replace(/^\uFEFF/, ""));
  const columns = header.map((name) => name.trim().toLowerCase());
  const allowed =
    "Date, Start, End, Title, Subtitle, Teachers, Highlight, Notes";

  const unknown = columns.filter((c) => c !== "" && !(c in SHEET_COLUMNS));
  if (unknown.length > 0) {
    throw new Error(
      `Schedule sheet: unknown column(s) ${unknown.join(", ")} — allowed: ${allowed}`,
    );
  }
  const duplicate = columns.find(
    (c, i) => c !== "" && columns.indexOf(c) !== i,
  );
  if (duplicate) {
    throw new Error(`Schedule sheet: column "${duplicate}" appears twice`);
  }
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new Error(`Schedule sheet: missing column(s) ${missing.join(", ")}`);
  }

  const events = [];
  const rows = [];
  body.forEach((cells, i) => {
    if (cells.every((cell) => cell.trim() === "")) return;
    const cell = (name) => {
      const at = columns.indexOf(name);
      return at === -1 ? "" : (cells[at] ?? "").trim();
    };
    const event = {
      date: cell("date"),
      timeStart: normalizeTime(cell("start")),
      timeEnd: normalizeTime(cell("end")),
      title: cell("title"),
    };
    if (cell("subtitle")) event.subTitle = cell("subtitle");
    const teachers = cell("teachers")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (teachers.length > 0) event.teachers = teachers;
    // A checkbox column exports TRUE/FALSE. Anything else goes through as
    // text, so validate() rejects it instead of guessing.
    const highlight = cell("highlight");
    if (/^true$/i.test(highlight)) event.highlight = true;
    else if (highlight !== "" && !/^false$/i.test(highlight)) {
      event.highlight = highlight;
    }
    events.push(event);
    // +1 for the header row, +1 because sheet rows count from 1.
    rows.push(i + 2);
  });
  return { events, rows };
}

// Long enough for Google's CSV export, short enough that a hung request fails
// the build instead of stalling it.
const FETCH_TIMEOUT_MS = 30_000;

/** The sheet's CSV, or a throw. Never puts the URL in a message. */
async function fetchScheduleCsv(csvUrl) {
  let url;
  try {
    url = new URL(csvUrl);
  } catch {
    throw new Error("YOGA_SCHEDULE_CSV_URL is not a valid URL");
  }
  // Busts any cache between the build and Google, as get-booking does.
  url.searchParams.set("t", String(Date.now()));

  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Schedule sheet: request failed (${error instanceof Error ? error.message : error})`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Schedule sheet: request returned status ${response.status}`,
    );
  }
  const text = await response.text();
  // A spreadsheet that isn't shared answers 200 with Google's sign-in page.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(
      'Schedule sheet: got an HTML page instead of CSV — is the spreadsheet shared as "Anyone with the link: Viewer", and does the URL end in format=csv?',
    );
  }
  return text;
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
export function buildYogaSchedule(
  raw,
  today,
  labelOf = (index) => `Event at index ${index}`,
) {
  validate(raw, labelOf);
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

/**
 * Loads, validates and shapes the /yoga schedule as of today in Goa.
 * `csvUrl` is the schedule sheet's CSV export (YOGA_SCHEDULE_CSV_URL). Without
 * it the sample JSON is used — unless `requireSheet` (production builds), which
 * throws instead so placeholder classes never go live.
 */
export async function loadYogaSchedulePageData({ csvUrl, requireSheet }) {
  let raw;
  let labelOf;
  if (csvUrl) {
    const { events, rows } = parseScheduleSheet(await fetchScheduleCsv(csvUrl));
    raw = events;
    labelOf = (index) => `Schedule sheet row ${rows[index]}`;
  } else if (requireSheet) {
    throw new Error(
      "YOGA_SCHEDULE_CSV_URL is not set — a production build reads the /yoga schedule from the Google Sheet and never falls back to the sample data",
    );
  } else {
    console.warn(
      "YOGA_SCHEDULE_CSV_URL is not set — /yoga uses the sample data in src/data/yoga-schedule.sample.json",
    );
    raw = sampleEvents;
    labelOf = (index) => `yoga-schedule.sample.json: event at index ${index}`;
  }

  const yogaSchedule = buildYogaSchedule(raw, todayInGoa(), labelOf);
  const current = yogaSchedule.weeks[yogaSchedule.currentIndex];
  if (current.slots.every((slot) => slot.cells.every((c) => c.length === 0))) {
    console.warn(
      `Yoga schedule: no classes in the build week (${current.label}) — /yoga opens on an empty schedule`,
    );
  }
  return { yogaSchedule };
}
