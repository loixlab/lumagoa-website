// Build-time loader for the weekly schedule on /yoga. Imported by
// vite.config.mjs only — never shipped to the client. Reads the classes from
// the office's Google Sheet (one row per class, exported as CSV — see
// docs/yoga-schedule-sheet.md), validates them and shapes them into the weeks
// rendered by src/partials/yoga-schedule.ejs, plus the schema.org Event list
// for the page's JSON-LD. The same spreadsheet's Teachers tab maps a teacher's
// name to a link — their card in "Meet Your Teachers" on /yoga, or their own
// page elsewhere — so each name in a card's "with …" line can be a link.
//
// Without YOGA_SCHEDULE_CSV_URL (local builds, Deploy Previews) it falls back
// to yoga-schedule.sample.json and yoga-teachers.sample.json; a production
// build refuses to, rather than publish placeholder classes. The samples are
// imported (not readFileSync'd) so Vite tracks them as config dependencies.
import sampleEvents from "./yoga-schedule.sample.json" with { type: "json" };
import sampleTeachers from "./yoga-teachers.sample.json" with { type: "json" };
// The same RFC 4180 parser get-booking uses for its sheet — dependency-free,
// so it runs here at build time too.
import { parseCsv } from "../../netlify/utils.ts";
import { PRICES, SITE_URL } from "./site.mjs";
import { formatPrice } from "./utils.mjs";

// The resort's clock. Which week the page opens on and the JSON-LD
// timestamps are both Goa time, whatever timezone the build runs in —
// Netlify builds in UTC.
const TIME_ZONE = "Asia/Kolkata";
const UTC_OFFSET = "+05:30";

// Classes starting before noon go in the Morning row, the rest in Evening —
// the row is derived, never stored, so it can't contradict timeStart. A class
// that starts before noon and ends after it (11:00–16:00, or just 11:30–12:30)
// belongs to both rows, so its day gets one tall cell listing every class of
// the day in time order instead of a Morning and an Evening cell (buildWeek).
const NOON = "12:00";
const SLOTS = [
  { id: "morning", label: "Morning" },
  { id: "evening", label: "Evening" },
];

// One day's Morning (or Evening) cell stacks its cards; more than this
// won't fit legibly. A class counts in the slot it starts in, so a merged day
// (see crossesNoon) can hold twice this.
const MAX_EVENTS_PER_SLOT = 4;

const FIELDS = [
  "date",
  "timeStart",
  "timeEnd",
  "title",
  "subTitle",
  "teachers",
  "price",
  "highlight",
];
const TEACHER_FIELDS = ["name", "link"];

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

// --- Teachers -------------------------------------------------------------

/** What goes before the i-th of n names: "with A", "with A & B", "with A, B & C". */
function teacherPrefix(i, n) {
  if (i === 0) return "with ";
  return i === n - 1 ? " & " : ", ";
}

/** ["A"] → "with A"; ["A", "B", "C"] → "with A, B & C"; [] → null. */
function formatTeachers(teachers) {
  if (teachers.length === 0) return null;
  return teachers
    .map((name, i) => teacherPrefix(i, teachers.length) + name)
    .join("");
}

/** The Teachers tab's key for a name: the schedule's "Emilia " matches its "emilia". */
function teacherKey(name) {
  return name.trim().toLowerCase();
}

/**
 * A teacher's link, as written in the Teachers tab: a card in "Meet Your
 * Teachers" on /yoga ("#teacher-ashutosh"), a page of this site
 * ("/ayurveda-massage") or an http(s) URL. A bare "//host" is not a page of
 * this site, so it is rejected with everything else.
 */
function isLink(value) {
  return (
    typeof value === "string" &&
    (/^#[A-Za-z][\w-]*$/.test(value) ||
      /^\/(?!\/)\S*$/.test(value) ||
      /^https?:\/\/\S+$/i.test(value))
  );
}

function isExternal(link) {
  return /^https?:\/\//i.test(link);
}

function slotOf(event) {
  return event.timeStart < NOON ? "morning" : "evening";
}

/** Starts before noon and ends after it — the class sits across both rows. */
function crossesNoon(event) {
  return event.timeStart < NOON && event.timeEnd > NOON;
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
    // A whole INR amount. The sheet's cell arrives as a number only when it
    // reads as one (normalizePrice), so a typo is rejected, not guessed.
    if (e.price !== undefined && (!Number.isInteger(e.price) || e.price <= 0)) {
      throw new Error(
        `${label}: price must be a whole INR amount, like 800, got ${JSON.stringify(e.price)}`,
      );
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

/**
 * The Teachers tab's rows (or the sample JSON) as a Map from teacherKey(name)
 * to { href, external } — or a throw naming the row to fix. A name listed
 * twice is an error: the build must not pick one of its two links.
 */
function teacherLinksOf(raw, labelOf) {
  if (!Array.isArray(raw)) {
    throw new Error("Yoga teachers: expected an array of teachers");
  }
  const links = new Map();
  const listedAt = new Map();
  for (const [index, t] of raw.entries()) {
    const where = labelOf(index);
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      throw new Error(`${where} is not an object`);
    }
    const unknown = Object.keys(t).filter(
      (key) => !TEACHER_FIELDS.includes(key),
    );
    if (unknown.length > 0) {
      throw new Error(
        `${where} has unknown field(s) ${unknown.join(", ")} — allowed: ${TEACHER_FIELDS.join(", ")}`,
      );
    }
    if (!isText(t.name)) {
      throw new Error(`${where}: missing name`);
    }
    if (!isLink(t.link)) {
      throw new Error(
        `${where} ("${t.name}"): link must be a card on /yoga like #teacher-ashutosh, a page like /ayurveda-massage or an https:// URL, got ${JSON.stringify(t.link)}`,
      );
    }
    const key = teacherKey(t.name);
    if (listedAt.has(key)) {
      throw new Error(
        `${where}: "${t.name}" is already listed (${listedAt.get(key)})`,
      );
    }
    listedAt.set(key, where);
    links.set(key, { href: t.link, external: isExternal(t.link) });
  }
  return links;
}

// --- The schedule spreadsheet ---------------------------------------------

// Schedule tab column headers (matched case-insensitively, in any order) →
// the event field each fills. "Day" (the weekday, filled from Date by a
// formula — the sheet script checks it) and "Notes" are for the office and
// never read. Any other header is ignored, unless it is a near-miss of one of
// these (nearMiss). Keep in step with HEADERS in the sheet's Apps Script
// (docs/yoga-schedule-sheet.gs), in the same order.
const SHEET_COLUMNS = {
  day: null,
  date: "date",
  start: "timeStart",
  end: "timeEnd",
  title: "title",
  subtitle: "subTitle",
  teachers: "teachers",
  price: "price",
  highlight: "highlight",
  notes: null,
};
// The columns that describe a class — a row with none of them filled (only
// a note or a Day, say) is not a class.
const CLASS_COLUMNS = Object.keys(SHEET_COLUMNS).filter(
  (name) => SHEET_COLUMNS[name] !== null,
);
const REQUIRED_COLUMNS = ["date", "start", "end", "title"];

// Teachers tab: one row per teacher; any other header is ignored, as on the
// Schedule tab. Keep in step with TEACHER_HEADERS in
// docs/yoga-schedule-sheet.gs.
const TEACHER_COLUMNS = { name: "name", link: "link", notes: null };
const REQUIRED_TEACHER_COLUMNS = ["name", "link"];

// The version is a header of its own: "Version 12", "Version: v12"… in any
// column, case-insensitive. The build logs the text after "Version", so a
// deploy log shows which edit it read; the sheet's "Publish schedule now"
// button bumps it. The column's cells are never read. Keep in step with
// VERSION_HEADER in docs/yoga-schedule-sheet.gs.
const VERSION_HEADER = /^version(?![a-z])[\s:#-]*/i;

/** "8:30", "08:30" or "08:30:00" → "08:30"; anything else is left for validate() to reject. */
function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
}

/**
 * "800", "₹800", "Rs 800", "800 INR", "800.00" or "1,200" → the number;
 * anything else is left for validate() to reject. Keep in step with toPrice_
 * in docs/yoga-schedule-sheet.gs.
 */
function normalizePrice(value) {
  const match =
    /^(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?(?:\s*inr)?$/i.exec(
      value,
    );
  return match ? Number(match[1].replace(/,/g, "")) : value;
}

/**
 * The number of single-letter edits (insert, delete or replace) turning `a`
 * into `b`. Keep in step with editDistance_ in docs/yoga-schedule-sheet.gs.
 */
function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** "Sub title", "sub-title" → "subtitle": a header as nearMiss compares it. */
function lettersOnly(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The known column (as its key in `known`) that the unknown header `name`
 * looks like a typo of — the same letters ("Sub title"), or one letter added,
 * dropped or changed ("Teacher", "Tittle") — or null. "Day" is two letters
 * from "Date", so both are safe. Keep in step with nearMiss_ in
 * docs/yoga-schedule-sheet.gs.
 */
function nearMiss(name, known) {
  const letters = lettersOnly(name);
  return (
    Object.keys(known).find(
      (key) => editDistance(letters, lettersOnly(key)) <= 1,
    ) ?? null
  );
}

/** "subtitle" → "Subtitle", as the column is spelled in the sheet. */
function headerName(key) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Header problems throw here, naming the tab: a header that isn't one of
 * `known` but looks like a typo of one, a known one that appears twice, or a
 * `required` one that is missing. Any other header (`isExtra(index)` exempts
 * the Schedule tab's version header) is ignored: returns those headers, as
 * written in the sheet, for the build log. A blank header is skipped without
 * a mention, as a spacer column always was. `allowed` describes the tab's
 * columns in the typo message.
 */
function checkColumns(
  header,
  columns,
  { known, required, label, allowed, isExtra },
) {
  const ignored = [];
  const typos = [];
  columns.forEach((c, i) => {
    if (c === "" || Object.hasOwn(known, c) || isExtra(i)) return;
    const near = nearMiss(c, known);
    if (near === null) {
      ignored.push(header[i].trim());
    } else {
      typos.push(
        `column "${header[i].trim()}" (did you mean "${headerName(near)}"?)`,
      );
    }
  });
  if (typos.length > 0) {
    throw new Error(
      `${label}: ${typos.join(", ")} — too close to a known column to be ignored. Known columns: ${allowed}. Any other column is ignored.`,
    );
  }
  const duplicate = columns.find(
    (c, i) => Object.hasOwn(known, c) && columns.indexOf(c) !== i,
  );
  if (duplicate) {
    throw new Error(`${label}: column "${duplicate}" appears twice`);
  }
  const missing = required.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new Error(`${label}: missing column(s) ${missing.join(", ")}`);
  }
  return ignored;
}

/**
 * The header row (trimmed, lower-cased) and the body of a tab's CSV export.
 * Google's export starts with a byte-order mark, which would otherwise end
 * up on the first header.
 */
function parseSheetCsv(csv) {
  const [header = [], ...body] = parseCsv(csv.replace(/^\uFEFF/, ""));
  return {
    header,
    columns: header.map((name) => name.trim().toLowerCase()),
    body,
  };
}

/** Reads `row`'s cell under the column called `name` ("" when absent), trimmed. */
function cellReader(columns, cells) {
  return (name) => {
    const at = columns.indexOf(name);
    return at === -1 ? "" : (cells[at] ?? "").trim();
  };
}

/**
 * Turns the Schedule tab's CSV export into events, plus each one's sheet row
 * number so errors point the office at the exact row, the sheet's version
 * (from its "Version …" header, or null) and the headers it ignored. Rows
 * with no class column filled are skipped. Header problems throw here; cell
 * problems are left to validate().
 */
function parseScheduleSheet(csv) {
  const { header, columns, body } = parseSheetCsv(csv);

  const versionAt = columns.flatMap((c, i) =>
    VERSION_HEADER.test(c) ? [i] : [],
  );
  if (versionAt.length > 1) {
    throw new Error('Schedule sheet: more than one "Version …" header');
  }
  const version =
    versionAt.length === 1
      ? header[versionAt[0]].trim().replace(VERSION_HEADER, "") || null
      : null;
  const ignored = checkColumns(header, columns, {
    known: SHEET_COLUMNS,
    required: REQUIRED_COLUMNS,
    label: "Schedule sheet",
    allowed:
      'required Date, Start, End, Title; optional Day, Subtitle, Teachers, Price, Highlight, Notes; and one "Version …" header',
    isExtra: (i) => versionAt.includes(i),
  });

  const events = [];
  const rows = [];
  body.forEach((cells, i) => {
    const cell = cellReader(columns, cells);
    if (CLASS_COLUMNS.every((name) => cell(name) === "")) return;
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
    if (cell("price")) event.price = normalizePrice(cell("price"));
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
  return { events, rows, version, ignored };
}

/**
 * Turns the Teachers tab's CSV export into { name, link } rows plus their
 * sheet row numbers, and the headers it ignored. A row with only Notes filled
 * is skipped; one with a name but no link (or the reverse) goes through for
 * teacherLinksOf() to reject by row.
 */
function parseTeachersSheet(csv) {
  const { header, columns, body } = parseSheetCsv(csv);
  const ignored = checkColumns(header, columns, {
    known: TEACHER_COLUMNS,
    required: REQUIRED_TEACHER_COLUMNS,
    label: "Teachers sheet",
    allowed: "required Name, Link; optional Notes",
    isExtra: () => false,
  });

  const teachers = [];
  const rows = [];
  body.forEach((cells, i) => {
    const cell = cellReader(columns, cells);
    if (cell("name") === "" && cell("link") === "") return;
    teachers.push({ name: cell("name"), link: cell("link") });
    rows.push(i + 2);
  });
  return { teachers, rows, ignored };
}

/** Names the columns a tab's build skipped — the office's own, or a typo too far from a known name to be caught. */
function logIgnored(label, ignored) {
  if (ignored.length > 0) {
    console.log(`${label}: ignoring column(s) ${ignored.join(", ")}`);
  }
}

// Long enough for Google's CSV export, short enough that a hung request fails
// the build instead of stalling it.
const FETCH_TIMEOUT_MS = 30_000;

/**
 * A tab's CSV, or a throw. `envVar` and `label` ("Schedule sheet") name the
 * source in messages; the URL itself never appears in one.
 */
async function fetchSheetCsv(csvUrl, { envVar, label }) {
  let url;
  try {
    url = new URL(csvUrl);
  } catch {
    throw new Error(`${envVar} is not a valid URL`);
  }
  // A "Publish to web" link (/d/e/…/pub) serves a copy Google refreshes on
  // its own schedule and caches for 5 minutes (max-age=300), so a build
  // right after an edit can read the old schedule. The export link reads the
  // live sheet.
  if (url.pathname.includes("/d/e/") || url.pathname.endsWith("/pub")) {
    console.warn(
      `${envVar} is a "Publish to web" link, which can lag several minutes behind the sheet — use https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/export?format=csv&gid=<GID> instead (docs/yoga-schedule-sheet.md)`,
    );
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
      `${label}: request failed (${error instanceof Error ? error.message : error})`,
    );
  }
  if (!response.ok) {
    throw new Error(`${label}: request returned status ${response.status}`);
  }
  const text = await response.text();
  // A spreadsheet that isn't shared answers 200 with Google's sign-in page.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(
      `${label}: got an HTML page instead of CSV — is the spreadsheet shared as "Anyone with the link: Viewer", and does the URL end in format=csv?`,
    );
  }
  return text;
}

// --- Shaping ----------------------------------------------------------------

function byStart(a, b) {
  return a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart);
}

function toCard(e, teacherLinks) {
  const teachers = e.teachers ?? [];
  return {
    time: formatTimeRange(e.timeStart, e.timeEnd),
    // The row the class starts in colours the card — in a merged day's cell
    // the two rows' cards sit together.
    slot: slotOf(e),
    title: e.title,
    subTitle: e.subTitle ?? null,
    // "with A, B & C" — each name with its link from the Teachers tab, if any
    // (`href` null otherwise). The partial renders the parts in order.
    teachers: teachers.map((name, i) => ({
      prefix: teacherPrefix(i, teachers.length),
      name,
      ...(teacherLinks.get(teacherKey(name)) ?? {
        href: null,
        external: false,
      }),
    })),
    // Only a price that differs from the drop-in price — that one is in the
    // Prices block under the grid, so repeating it on every card is noise.
    price:
      e.price !== undefined && e.price !== PRICES.dropIn
        ? formatPrice(e.price)
        : null,
    highlight: e.highlight === true,
  };
}

function buildWeek(monday, events, teacherLinks) {
  const dates = DAY_NAMES.map((_, i) => addDays(monday, i));
  // `events` arrive sorted by start, so each day's list is in time order.
  const byDay = dates.map((date) => events.filter((e) => e.date === date));
  // A day with a class across noon is shown as one tall cell — its Morning
  // cell, spanning both rows — holding every class of the day; the partial
  // skips its Evening cell.
  const merged = byDay.map((day) => day.some(crossesNoon));
  return {
    monday,
    label: weekLabel(monday),
    days: dates.map((date, i) => ({
      date,
      name: DAY_NAMES[i],
      dateLabel: shortDayMonth(date),
      merged: merged[i],
    })),
    slots: SLOTS.map((slot) => ({
      ...slot,
      // One list of cards per day, Monday first; empty renders as "—". On a
      // merged day the Morning cell carries the whole day and the Evening
      // cell is left empty: the partial skips it (day.merged), and the
      // grid's auto-placement lets the tall cell take the track. Every cell
      // is an array, so nothing downstream needs a null check.
      cells: byDay.map((day, i) => {
        if (merged[i]) {
          return slot.id === "morning"
            ? day.map((e) => toCard(e, teacherLinks))
            : [];
        }
        return day
          .filter((e) => slotOf(e) === slot.id)
          .map((e) => toCard(e, teacherLinks));
      }),
    })),
  };
}

/** A class's teacher as a schema.org Person, linked the way the card is. */
function toPerson(name, teacherLinks) {
  const link = teacherLinks.get(teacherKey(name));
  if (!link) return { "@type": "Person", name };
  // Their own page elsewhere is `sameAs`; a page of this site (a /yoga card
  // anchor included) is their `url` here.
  return link.external
    ? { "@type": "Person", name, sameAs: link.href }
    : {
        "@type": "Person",
        name,
        url: `${SITE_URL}${link.href.startsWith("#") ? "/yoga" : ""}${link.href}`,
      };
}

function toJsonLdEvent(e, teacherLinks) {
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
    // Every class has a price: its own, or the drop-in price.
    offers: {
      "@type": "Offer",
      price: e.price ?? PRICES.dropIn,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/yoga#schedule`,
    },
    ...(teachers.length > 0
      ? { performer: teachers.map((name) => toPerson(name, teacherLinks)) }
      : {}),
  };
}

/**
 * Pure core of the loader — `today` ("YYYY-MM-DD", Goa time) is a parameter
 * so a run can be pinned to any date; `teacherLinks` is teacherLinksOf()'s
 * Map (empty: no name is linked).
 *
 * Weeks run Monday–Sunday and cover every week from the earliest event to
 * the latest, gaps included, so the arrows always step one week. The week
 * containing `today` is always present (even if empty) and is the one the
 * page renders as plain HTML; `currentIndex` points at it.
 */
function buildYogaSchedule(raw, { today, labelOf, teacherLinks }) {
  validate(raw, labelOf);
  const events = [...raw].sort(byStart);

  const currentMonday = mondayOf(today);
  const mondays = [currentMonday, ...events.map((e) => mondayOf(e.date))];
  const first = mondays.reduce((a, b) => (b < a ? b : a));
  const last = mondays.reduce((a, b) => (b > a ? b : a));

  const weeks = [];
  for (let monday = first; monday <= last; monday = addDays(monday, 7)) {
    weeks.push(buildWeek(monday, events, teacherLinks));
  }
  const currentIndex = weeks.findIndex((w) => w.monday === currentMonday);

  return {
    // Also the /yoga <lastmod> in the built sitemap (vite.config.mjs).
    buildDate: today,
    weeks,
    currentIndex,
    // From the build date, not the build week's Monday: a mid-week deploy
    // must not list classes that already happened as EventScheduled.
    jsonLdEvents: events
      .filter((e) => e.date >= today)
      .map((e) => toJsonLdEvent(e, teacherLinks)),
  };
}

/**
 * Loads, validates and shapes the /yoga schedule as of today in Goa.
 * `csvUrl` is the Schedule tab's CSV export (YOGA_SCHEDULE_CSV_URL) and
 * `teachersCsvUrl` the Teachers tab's (YOGA_TEACHERS_CSV_URL) — optional:
 * without it no teacher name is a link. Without `csvUrl` the sample JSON is
 * used for both — unless `requireSheet` (production builds), which throws
 * instead so placeholder classes never go live.
 */
export async function loadYogaSchedulePageData({
  csvUrl,
  teachersCsvUrl,
  requireSheet,
}) {
  let raw;
  let labelOf;
  let source;
  // Null until a Teachers tab (or the sample) was read.
  let teacherLinks = null;
  let teachersSource;
  if (csvUrl) {
    // Two tabs of the same spreadsheet — fetched together.
    const [scheduleCsv, teachersCsv] = await Promise.all([
      fetchSheetCsv(csvUrl, {
        envVar: "YOGA_SCHEDULE_CSV_URL",
        label: "Schedule sheet",
      }),
      teachersCsvUrl
        ? fetchSheetCsv(teachersCsvUrl, {
            envVar: "YOGA_TEACHERS_CSV_URL",
            label: "Teachers sheet",
          })
        : null,
    ]);
    const { events, rows, version, ignored } = parseScheduleSheet(scheduleCsv);
    logIgnored("Schedule sheet", ignored);
    raw = events;
    labelOf = (index) => `Schedule sheet row ${rows[index]}`;
    source = `Schedule sheet, version ${version ? `"${version}"` : 'not set (give the sheet a header like "Version 1")'}`;
    if (teachersCsv !== null) {
      const {
        teachers,
        rows: teacherRows,
        ignored: teachersIgnored,
      } = parseTeachersSheet(teachersCsv);
      logIgnored("Teachers sheet", teachersIgnored);
      teacherLinks = teacherLinksOf(
        teachers,
        (index) => `Teachers sheet row ${teacherRows[index]}`,
      );
      teachersSource = "Teachers sheet";
    } else {
      console.warn(
        "YOGA_TEACHERS_CSV_URL is not set — teacher names on /yoga are plain text, not links",
      );
    }
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
    source = "sample data";
    teacherLinks = teacherLinksOf(
      sampleTeachers,
      (index) => `yoga-teachers.sample.json: teacher at index ${index}`,
    );
    teachersSource = "sample data";
  }

  const yogaSchedule = buildYogaSchedule(raw, {
    today: todayInGoa(),
    labelOf,
    teacherLinks: teacherLinks ?? new Map(),
  });
  // What this build read — compare the version with the sheet's to confirm
  // it picked up the latest edit.
  const dates = raw.map((e) => e.date).sort();
  console.log(
    `Yoga schedule: ${source} — ${raw.length} classes${dates.length > 0 ? `, ${dates[0]} → ${dates.at(-1)}` : ""} (built ${yogaSchedule.buildDate}, Goa time)`,
  );
  if (teacherLinks) {
    // A name the tab doesn't list stays plain text — fine when deliberate,
    // but this is also how a misspelt name shows up.
    const unlinked = [
      ...new Set(raw.flatMap((e) => e.teachers ?? []).map((n) => n.trim())),
    ].filter((name) => !teacherLinks.has(teacherKey(name)));
    console.log(
      `Yoga teachers: ${teachersSource} — ${teacherLinks.size} link(s)${unlinked.length > 0 ? `; no link for ${unlinked.join(", ")}` : ""}`,
    );
  }
  const current = yogaSchedule.weeks[yogaSchedule.currentIndex];
  if (current.slots.every((slot) => slot.cells.every((c) => c.length === 0))) {
    console.warn(
      `Yoga schedule: no classes in the build week (${current.label}) — /yoga opens on an empty schedule`,
    );
  }
  return { yogaSchedule };
}
