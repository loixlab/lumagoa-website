/**
 * LUMA Goa — yoga schedule sheet → website.
 *
 * Paste this whole file into the schedule spreadsheet's Extensions → Apps
 * Script editor (replacing the default Code.gs), save, then reload the
 * spreadsheet: a "Website" menu appears.
 *
 *   Publish schedule now  Checks the Schedule and Teachers tabs, bumps the
 *                         Schedule tab's version header (Version 12 →
 *                         Version 13), then asks Netlify to rebuild the
 *                         website (live in about 2 minutes). Without it,
 *                         edits go live at the nightly rebuild (00:30 Goa
 *                         time) — bump the version by hand then.
 *   Check schedule        The same checks, without publishing.
 *   Set up Schedule & Teachers tabs
 *                         One-time: headers, date/time/price formats,
 *                         checkboxes, the Day formula, and the Teachers tab
 *                         (Name → Link).
 *   Fill Day column       One-time, for a Schedule tab set up before the Day
 *                         column existed: puts the formula that shows each
 *                         row's weekday in the Day column.
 *
 * One-time setup: Project Settings (gear icon) → Script properties → add
 * BUILD_HOOK_URL = the Netlify build hook created for this sheet.
 *
 * The website build applies the same rules (src/data/load-yoga-schedule.mjs)
 * and refuses to publish a schedule that breaks them; these checks report
 * the problem here, by row, instead of in a failed build nobody sees. One
 * check is this script's own: a row's Day must be its Date's weekday (the
 * website never reads Day). Columns the website doesn't know are ignored,
 * and the "All good" and Publish messages name them. Full setup guide:
 * docs/yoga-schedule-sheet.md in the website repo.
 */

const TAB_NAME = "Schedule";
// In the order setupTabs writes them. Keep in step with SHEET_COLUMNS in
// src/data/load-yoga-schedule.mjs, in the same order.
const HEADERS = [
  "Day",
  "Date",
  "Start",
  "End",
  "Title",
  "Subtitle",
  "Teachers",
  "Price",
  "Highlight",
  "Notes",
];
const REQUIRED = ["date", "start", "end", "title"];
// Never part of a class: a row with only a note or a Day is skipped.
const CLASS_COLUMNS = HEADERS.map((name) => name.toLowerCase()).filter(
  (name) => name !== "day" && name !== "notes",
);
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
// The version is a header of its own, in any column: "Version 12". The build
// logs the text after "Version"; Publish bumps it. Its cells are never read.
// Keep in step with VERSION_HEADER in src/data/load-yoga-schedule.mjs.
const VERSION_HEADER = /^version(?![a-z])[\s:#-]*/i;
const FIRST_VERSION_HEADER = "Version 1";
const MAX_PER_SLOT = 4;
// The Teachers tab links a name (as written in the Schedule tab's Teachers
// column) to the teacher's card on the website's yoga page or to their own
// page. Optional: without the tab (or a name), names are plain text. Keep in
// step with TEACHER_COLUMNS in src/data/load-yoga-schedule.mjs.
const TEACHERS_TAB_NAME = "Teachers";
const TEACHER_HEADERS = ["Name", "Link", "Notes"];
const TEACHER_REQUIRED = ["name", "link"];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Website")
    .addItem("Publish schedule now", "publishSchedule")
    .addItem("Check schedule", "checkSchedule")
    .addSeparator()
    .addItem("Set up Schedule & Teachers tabs", "setupTabs")
    .addItem("Fill Day column", "fillDayColumn")
    .addToUi();
}

function publishSchedule() {
  const ui = SpreadsheetApp.getUi();
  const check = checkTabs_();
  if (check.problems.length > 0) {
    ui.alert(
      "Not published",
      "Please fix these first:\n\n" + summarize_(check.problems),
      ui.ButtonSet.OK,
    );
    return;
  }
  const hookUrl =
    PropertiesService.getScriptProperties().getProperty("BUILD_HOOK_URL");
  if (!hookUrl) {
    ui.alert(
      "Not published",
      "The BUILD_HOOK_URL script property is missing. Please ask the website admin.",
      ui.ButtonSet.OK,
    );
    return;
  }

  // Two editors publishing at once must not bump to the same version.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    ui.alert(
      "Not published",
      "Someone else is publishing right now. Try again in a moment.",
      ui.ButtonSet.OK,
    );
    return;
  }

  let bump = null;
  let status = 0;
  try {
    bump = bumpVersion_();
    // Save the last edits and the new version before the build reads them.
    SpreadsheetApp.flush();
    status = triggerBuild_(hookUrl);
    if ((status < 200 || status >= 300) && bump) {
      // Nothing is rebuilding: put the version back, so the header keeps
      // naming what was last published.
      bump.cell.setValue(bump.previousHeader);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }

  if (status < 200 || status >= 300) {
    ui.alert(
      "Not published",
      "Netlify didn't accept the request" +
        (status ? " (status " + status + ")" : "") +
        ". Try again in a minute, or ask the website admin.",
      ui.ButtonSet.OK,
    );
    return;
  }
  ui.alert(
    "Publishing",
    "The website is rebuilding" +
      (bump ? " with version " + bump.version : "") +
      ". The new schedule will be live in about 2 minutes." +
      (bump ? "" : ' (Add a "Version 1" header to track versions.)') +
      ignoredNote_(check.ignored),
    ui.ButtonSet.OK,
  );
}

/** POSTs to the sheet's build hook; returns the HTTP status (0 if unreachable). */
function triggerBuild_(hookUrl) {
  const who = Session.getActiveUser().getEmail() || "the schedule sheet";
  const url =
    hookUrl +
    (hookUrl.indexOf("?") === -1 ? "?" : "&") +
    "trigger_title=" +
    encodeURIComponent("Schedule published by " + who);
  try {
    return UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: "{}",
      muteHttpExceptions: true,
    }).getResponseCode();
  } catch (error) {
    return 0;
  }
}

/**
 * Bumps the tab's "Version …" header in place (Version 12 → Version 13).
 * Returns the cell, its previous text and the new version — or null when the
 * tab has no version header.
 */
function bumpVersion_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_NAME);
  const header = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const at = header.findIndex((name) =>
    VERSION_HEADER.test(String(name).trim()),
  );
  if (at === -1) return null;
  const previousHeader = String(header[at]).trim();
  const prefix = previousHeader.match(VERSION_HEADER)[0];
  const version = nextVersion_(previousHeader.slice(prefix.length));
  const cell = sheet.getRange(1, at + 1);
  // A bare "Version" has no separator before the number it is about to get.
  cell.setValue((/[\s:#-]$/.test(prefix) ? prefix : prefix + " ") + version);
  return { cell: cell, previousHeader: previousHeader, version: version };
}

/**
 * The next version: the last number goes up by one, keeping its zero
 * padding — "12" → "13", "v09" → "v10", "1.9" → "1.10". No number yet:
 * "" → "1", "beta" → "beta 2".
 */
function nextVersion_(value) {
  const match = /^(.*?)(\d+)(\D*)$/.exec(value);
  if (!match) return value ? value + " 2" : "1";
  const next = String(Number(match[2]) + 1);
  return match[1] + next.padStart(match[2].length, "0") + match[3];
}

function checkSchedule() {
  const ui = SpreadsheetApp.getUi();
  const check = checkTabs_();
  if (check.problems.length > 0) {
    ui.alert("Problems found", summarize_(check.problems), ui.ButtonSet.OK);
  } else {
    const version = scheduleVersion_();
    ui.alert(
      "All good",
      "The schedule" +
        (version ? " (version " + version + ")" : "") +
        " is ready to publish." +
        ignoredNote_(check.ignored),
      ui.ButtonSet.OK,
    );
  }
}

function setupTabs() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActive();
  const notes = [];

  // Never re-header a tab with data: its columns may be in another order.
  let schedule = spreadsheet.getSheetByName(TAB_NAME);
  if (schedule && schedule.getLastRow() > 1) {
    notes.push(
      'The "' +
        TAB_NAME +
        '" tab already has rows, so it was left as it is. Set up only works on a new or empty tab.',
    );
  } else {
    if (!schedule) schedule = spreadsheet.insertSheet(TAB_NAME);
    setupScheduleTab_(schedule);
    notes.push(
      '"' +
        TAB_NAME +
        '" is ready. Add one row per class: Date, Start and End (24h, e.g. 17:30) and Title. ' +
        "Day fills itself from Date; don't type in it. " +
        "Optional: Subtitle, Teachers (comma-separated), Price (a whole INR amount, only when the class doesn't cost the drop-in price), Highlight (tick for a gold card) and Notes (never shown on the website). " +
        "Columns of your own are fine: the website ignores them. " +
        '"' +
        FIRST_VERSION_HEADER +
        '" (column ' +
        columnLetter_(HEADERS.length + 1) +
        ") names the schedule's version: Publish schedule now bumps it, and the website's build log shows the version it read.",
    );
  }

  let teachers = spreadsheet.getSheetByName(TEACHERS_TAB_NAME);
  if (teachers && teachers.getLastRow() > 1) {
    notes.push(
      'The "' +
        TEACHERS_TAB_NAME +
        '" tab already has rows, so it was left as it is.',
    );
  } else {
    if (!teachers) teachers = spreadsheet.insertSheet(TEACHERS_TAB_NAME);
    setupTeachersTab_(teachers);
    notes.push(
      '"' +
        TEACHERS_TAB_NAME +
        "\" is ready. One row per teacher: Name, exactly as written in the Schedule tab's Teachers column, and Link — #teacher-ashutosh for their card on the website's yoga page, or a full https:// address (opens in a new tab). Notes are never read.",
    );
  }

  ui.alert("Set up tabs", notes.join("\n\n"), ui.ButtonSet.OK);
}

/** Headers, formats and checkboxes of a new (or empty) Schedule tab. */
function setupScheduleTab_(sheet) {
  // The version goes in its own header, after the class columns.
  sheet
    .getRange(1, 1, 1, HEADERS.length + 1)
    .setValues([HEADERS.concat(FIRST_VERSION_HEADER)])
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  const rows = sheet.getMaxRows() - 1;
  const column = (name) => HEADERS.indexOf(name) + 1;
  sheet
    .getRange(2, column("Date"), rows, 1)
    .setNumberFormat("yyyy-mm-dd")
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(false)
        .setHelpText("A date, e.g. 2026-11-02")
        .build(),
    );
  sheet.getRange(2, column("Start"), rows, 1).setNumberFormat("HH:mm");
  sheet.getRange(2, column("End"), rows, 1).setNumberFormat("HH:mm");
  // A plain whole number: the website reads the displayed value.
  sheet.getRange(2, column("Price"), rows, 1).setNumberFormat("0");
  sheet.getRange(2, column("Highlight"), rows, 1).insertCheckboxes();
  writeDayFormula_(sheet, column("Day"), column("Date"));
}

/**
 * For a Schedule tab set up before the Day column existed: finds the Day and
 * Date columns by header and puts the Day formula in the Day column — only
 * when nothing is in that column yet below its header.
 */
function fillDayColumn() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_NAME);
  if (!sheet) {
    ui.alert(
      "Day column not filled",
      'There is no "' +
        TAB_NAME +
        '" tab. Use Website → Set up Schedule & Teachers tabs.',
      ui.ButtonSet.OK,
    );
    return;
  }
  // Max 1: an empty tab has no last column, and a range needs one.
  const header = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getDisplayValues()[0]
    .map((name) => String(name).trim().toLowerCase());
  const dayAt = header.indexOf("day");
  const dateAt = header.indexOf("date");
  if (dayAt === -1 || dateAt === -1) {
    ui.alert(
      "Day column not filled",
      'The "' +
        TAB_NAME +
        '" tab needs a "Day" column and a "Date" column. To add Day: right-click the letter above the Date column → Insert 1 column left, type Day in its first cell, then run Website → Fill Day column again.',
      ui.ButtonSet.OK,
    );
    return;
  }

  const cells = sheet.getRange(2, dayAt + 1, sheet.getMaxRows() - 1, 1);
  const formula = dayFormula_(columnLetter_(dateAt + 1));
  const sameFormula = (text) =>
    text.replace(/\s/g, "").toUpperCase() ===
    formula.replace(/\s/g, "").toUpperCase();
  if (sameFormula(cells.getCell(1, 1).getFormula())) {
    ui.alert(
      "Day column",
      "The Day column already fills itself from Date.",
      ui.ButtonSet.OK,
    );
    return;
  }
  const values = cells.getValues();
  const formulas = cells.getFormulas();
  const used = values.findIndex(
    (row, i) => row[0] !== "" || formulas[i][0] !== "",
  );
  if (used !== -1) {
    ui.alert(
      "Day column not filled",
      "The Day column already has something in row " +
        (used + 2) +
        ". The formula needs the column empty below its header: select those cells, press Delete, then run Website → Fill Day column again.",
      ui.ButtonSet.OK,
    );
    return;
  }
  writeDayFormula_(sheet, dayAt + 1, dateAt + 1);
  ui.alert(
    "Day column filled",
    "The Day column now shows each row's weekday (Mon, Tue…) from its Date, for every row, new ones included. Don't type in it: a typed cell stops the formula, and Check schedule then reports the Day column's rows.",
    ui.ButtonSet.OK,
  );
}

/**
 * Puts the Day formula in row 2 of the Day column (it fills the column) and
 * a note on its header saying so. Columns count from 1.
 */
function writeDayFormula_(sheet, dayColumn, dateColumn) {
  // A column inserted next to Date can take on its date-only rule, which
  // would flag every "Mon" as invalid.
  sheet
    .getRange(2, dayColumn, sheet.getMaxRows() - 1, 1)
    .clearDataValidations();
  sheet
    .getRange(2, dayColumn)
    .setFormula(dayFormula_(columnLetter_(dateColumn)));
  sheet
    .getRange(1, dayColumn)
    .setNote(
      "Filled from Date by the formula in row 2 — don't type in this column.",
    );
}

/**
 * Each row's weekday from its Date (column `dateLetter`), "Mon" to "Sun" in
 * the spreadsheet's language, blank while the Date is:
 * =ARRAYFORMULA(IF(B2:B="","",TEXT(B2:B,"ddd"))) when Date is column B.
 */
function dayFormula_(dateLetter) {
  const dates = dateLetter + "2:" + dateLetter;
  return "=ARRAYFORMULA(IF(" + dates + '="","",TEXT(' + dates + ',"ddd")))';
}

/** Headers of a new (or empty) Teachers tab. */
function setupTeachersTab_(sheet) {
  sheet
    .getRange(1, 1, 1, TEACHER_HEADERS.length)
    .setValues([TEACHER_HEADERS])
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/** 1 → "A", 11 → "K" (the tabs never get past column Z). */
function columnLetter_(column) {
  return String.fromCharCode(64 + column);
}

/**
 * Both tabs, checked: { problems, ignored } — every problem, by row, and the
 * columns the website will ignore, by tab ("Room, Paid (Schedule tab)").
 */
function checkTabs_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(TAB_NAME);
  if (!sheet) {
    return {
      problems: [
        'There is no "' +
          TAB_NAME +
          '" tab. Use Website → Set up Schedule & Teachers tabs.',
      ],
      ignored: [],
    };
  }
  // Displayed values are exactly what the CSV export gives the website.
  const schedule = checkRows_(sheet.getDataRange().getDisplayValues());
  const problems = schedule.problems;
  const ignored = [];
  if (schedule.ignored.length > 0) {
    ignored.push(schedule.ignored.join(", ") + " (" + TAB_NAME + " tab)");
  }
  // The Teachers tab is optional — but when it exists the website reads it,
  // so it has to pass too.
  const teachers = spreadsheet.getSheetByName(TEACHERS_TAB_NAME);
  if (teachers) {
    const result = checkTeacherRows_(
      teachers.getDataRange().getDisplayValues(),
    );
    result.problems.forEach((problem) =>
      problems.push(TEACHERS_TAB_NAME + " tab — " + problem),
    );
    if (result.ignored.length > 0) {
      ignored.push(
        result.ignored.join(", ") + " (" + TEACHERS_TAB_NAME + " tab)",
      );
    }
  }
  return { problems: problems, ignored: ignored };
}

/** The "All good" and Publish messages' last line: the columns the website ignores, or "". */
function ignoredNote_(ignored) {
  return ignored.length > 0
    ? "\n\nThe website ignores these columns: " + ignored.join("; ") + "."
    : "";
}

/** The version in the tab's "Version …" header, or "" — as the build reads it. */
function scheduleVersion_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_NAME);
  return sheet ? versionOf_(sheet.getDataRange().getDisplayValues()) : "";
}

function versionOf_(rows) {
  const header = (rows[0] || []).find((name) =>
    VERSION_HEADER.test(String(name).trim()),
  );
  return header === undefined
    ? ""
    : String(header).trim().replace(VERSION_HEADER, "");
}

/**
 * The website build's rules, applied to the tab's displayed values (header
 * row first), plus this script's own Day check. Returns { problems, ignored }:
 * one message per problem — none means the build will accept the schedule —
 * and the headers, as written, of the columns the website ignores.
 */
function checkRows_(rows) {
  const read = readHeader_(rows[0], HEADERS, REQUIRED, (name) =>
    VERSION_HEADER.test(name),
  );
  const header = read.header;
  const problems = read.problems;

  const versionHeaders = header.filter((name) => VERSION_HEADER.test(name));
  if (versionHeaders.length > 1) {
    problems.push('More than one "Version …" header');
  }
  if (problems.length > 0) return { problems: problems, ignored: read.ignored };

  const perSlot = {};
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r].map((cell) => String(cell).trim());
    const get = (name) => {
      const at = header.indexOf(name);
      return at === -1 ? "" : cells[at] || "";
    };
    if (CLASS_COLUMNS.every((name) => get(name) === "")) continue;
    const where = "Row " + (r + 1) + ": ";
    const date = get("date");
    const start = toTime_(get("start"));
    const end = toTime_(get("end"));

    if (!isDate_(date))
      problems.push(
        where + 'Date must look like 2026-11-02, not "' + date + '"',
      );
    if (!get("title")) problems.push(where + "Title is empty");
    if (!start || !end) {
      problems.push(
        where + "Start and End must be 24h times, like 08:30 or 17:30",
      );
    } else if (end <= start) {
      problems.push(where + "End must be after Start");
    }
    const highlight = get("highlight").toUpperCase();
    if (highlight !== "" && highlight !== "TRUE" && highlight !== "FALSE") {
      problems.push(where + "Highlight must be a checkbox");
    }
    const price = get("price");
    if (price !== "" && toPrice_(price) === null) {
      problems.push(
        where +
          'Price must be a whole amount in INR, like 800, not "' +
          price +
          '"',
      );
    }
    // The sheet's own check — the website never reads Day. "Mon", "MON",
    // "Monday" all pass for a Monday.
    const day = get("day");
    if (isDate_(date) && day !== "") {
      const weekday = WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()];
      if (day.toLowerCase().slice(0, 3) !== weekday.toLowerCase().slice(0, 3)) {
        problems.push(
          where + "Day says " + day + " but " + date + " is a " + weekday,
        );
      }
    }
    if (isDate_(date) && start) {
      const slot = date + (start < "12:00" ? " morning" : " evening");
      perSlot[slot] = (perSlot[slot] || []).concat(r + 1);
    }
  }
  Object.keys(perSlot).forEach((slot) => {
    if (perSlot[slot].length > MAX_PER_SLOT) {
      problems.push(
        perSlot[slot].length +
          " classes on " +
          slot +
          " (rows " +
          perSlot[slot].join(", ") +
          "). At most " +
          MAX_PER_SLOT +
          " fit in one slot.",
      );
    }
  });
  return { problems: problems, ignored: read.ignored };
}

/**
 * The website build's rules for the Teachers tab (header row first): Name and
 * Link both filled, each name listed once, and a link that is a card on the
 * yoga page (#teacher-ashutosh), a page of the site (/ayurveda-massage) or an
 * http(s):// address. A row with only Notes is skipped. Returns
 * { problems, ignored }, as checkRows_ does. Keep in step with
 * teacherLinksOf() in src/data/load-yoga-schedule.mjs.
 */
function checkTeacherRows_(rows) {
  const read = readHeader_(
    rows[0],
    TEACHER_HEADERS,
    TEACHER_REQUIRED,
    () => false,
  );
  const header = read.header;
  const problems = read.problems;
  if (problems.length > 0) return { problems: problems, ignored: read.ignored };

  const listedAt = {};
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r].map((cell) => String(cell).trim());
    const get = (name) => {
      const at = header.indexOf(name);
      return at === -1 ? "" : cells[at] || "";
    };
    const name = get("name");
    const link = get("link");
    if (name === "" && link === "") continue;
    const where = "Row " + (r + 1) + ": ";
    if (name === "") problems.push(where + "Name is empty");
    if (!isLink_(link)) {
      problems.push(
        where +
          'Link must be a card on the yoga page like #teacher-ashutosh, a page like /ayurveda-massage or an https:// address, not "' +
          link +
          '"',
      );
    }
    const key = name.toLowerCase();
    if (name !== "" && listedAt[key]) {
      problems.push(
        where + '"' + name + '" is already listed (row ' + listedAt[key] + ")",
      );
    } else if (name !== "") {
      listedAt[key] = r + 1;
    }
  }
  return { problems: problems, ignored: read.ignored };
}

/**
 * A tab's header row as the website build reads it: { header, problems,
 * ignored }. `header` is the lower-cased names, to find columns by; the
 * problems are a known column (one of `headers`) twice, a `required` one
 * missing, or another name that looks like a typo of a known one
 * (nearMiss_); every other header, as written, is ignored by the website. A
 * blank header is skipped without a mention, as a spacer column always was.
 * `isVersion(name)` exempts the Schedule tab's version header. Keep in step
 * with checkColumns() in src/data/load-yoga-schedule.mjs.
 */
function readHeader_(row, headers, required, isVersion) {
  const names = (row || []).map((name) => String(name).trim());
  const header = names.map((name) => name.toLowerCase());
  const known = headers.map((name) => name.toLowerCase());
  const problems = [];
  const ignored = [];
  header.forEach((name, i) => {
    if (name === "" || isVersion(name)) return;
    if (known.indexOf(name) === -1) {
      const near = nearMiss_(name, headers);
      if (near === null) {
        ignored.push(names[i]);
      } else {
        problems.push(
          'Column "' +
            names[i] +
            '": did you mean "' +
            near +
            "\"? Rename it: the website ignores columns it doesn't know, but not one named this close to one it does.",
        );
      }
    } else if (header.indexOf(name) !== i) {
      problems.push('Column "' + names[i] + '" appears twice');
    }
  });
  required.forEach((name) => {
    if (header.indexOf(name) === -1)
      problems.push('Missing column "' + name + '"');
  });
  return { header: header, problems: problems, ignored: ignored };
}

/**
 * The known header (one of `headers`) that `name` looks like a typo of — the
 * same letters ("Sub title"), or one letter added, dropped or changed
 * ("Teacher", "Tittle") — or null. "Day" is two letters from "Date", so both
 * are safe. Keep in step with nearMiss in src/data/load-yoga-schedule.mjs.
 */
function nearMiss_(name, headers) {
  const letters = lettersOnly_(name);
  const near = headers.find(
    (known) => editDistance_(letters, lettersOnly_(known)) <= 1,
  );
  return near === undefined ? null : near;
}

/** "Sub title", "sub-title" → "subtitle": a header as nearMiss_ compares it. */
function lettersOnly_(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The number of single-letter edits (insert, delete or replace) turning `a`
 * into `b`. Keep in step with editDistance in src/data/load-yoga-schedule.mjs.
 */
function editDistance_(a, b) {
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

/** A card anchor (#teacher-ashutosh), a page of the site (/ayurveda-massage) or an http(s):// address. */
function isLink_(value) {
  return (
    /^#[A-Za-z][\w-]*$/.test(value) ||
    /^\/(?!\/)\S*$/.test(value) ||
    /^https?:\/\/\S+$/i.test(value)
  );
}

/** A real calendar date written yyyy-mm-dd. */
function isDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * "800", "₹800", "Rs 800", "800 INR", "800.00" or "1,200" → 800; anything
 * else (0 included) → null. Keep in step with normalizePrice in
 * src/data/load-yoga-schedule.mjs.
 */
function toPrice_(value) {
  const match =
    /^(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?(?:\s*inr)?$/i.exec(
      value,
    );
  if (!match) return null;
  const price = Number(match[1].replace(/,/g, ""));
  return price > 0 ? price : null;
}

/** "8:30", "08:30" or "08:30:00" → "08:30"; anything else → null. */
function toTime_(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return (match[1].length === 1 ? "0" : "") + match[1] + ":" + match[2];
}

function summarize_(problems) {
  const shown = problems.slice(0, 12).join("\n");
  return problems.length > 12
    ? shown + "\n…and " + (problems.length - 12) + " more."
    : shown;
}
