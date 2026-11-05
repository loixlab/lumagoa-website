/**
 * LUMA Goa — yoga schedule sheet → website.
 *
 * Paste this whole file into the schedule spreadsheet's Extensions → Apps
 * Script editor (replacing the default Code.gs), save, then reload the
 * spreadsheet: a "Website" menu appears.
 *
 *   Publish schedule now  Checks the Schedule tab, bumps its version
 *                         header (Version 12 → Version 13), then asks Netlify
 *                         to rebuild the website (live in about 2 minutes).
 *                         Without it, edits go live at the nightly rebuild
 *                         (00:30 Goa time) — bump the version by hand then.
 *   Check schedule        The same checks, without publishing.
 *   Set up Schedule tab   One-time: headers, date/time formats, checkboxes.
 *
 * One-time setup: Project Settings (gear icon) → Script properties → add
 * BUILD_HOOK_URL = the Netlify build hook created for this sheet.
 *
 * The website build applies the same rules (src/data/load-yoga-schedule.mjs)
 * and refuses to publish a schedule that breaks them; these checks report
 * the problem here, by row, instead of in a failed build nobody sees. Full
 * setup guide: docs/yoga-schedule-sheet.md in the website repo.
 */

const TAB_NAME = "Schedule";
// Keep in step with SHEET_COLUMNS in src/data/load-yoga-schedule.mjs.
const HEADERS = [
  "Date",
  "Start",
  "End",
  "Title",
  "Subtitle",
  "Teachers",
  "Highlight",
  "Notes",
];
const REQUIRED = ["date", "start", "end", "title"];
// Never part of a class: a row with only a note is skipped.
const CLASS_COLUMNS = HEADERS.map((name) => name.toLowerCase()).filter(
  (name) => name !== "notes",
);
// The version is a header of its own, in any column: "Version 12". The build
// logs the text after "Version"; Publish bumps it. Its cells are never read.
// Keep in step with VERSION_HEADER in src/data/load-yoga-schedule.mjs.
const VERSION_HEADER = /^version(?![a-z])[\s:#-]*/i;
const FIRST_VERSION_HEADER = "Version 1";
const MAX_PER_SLOT = 4;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Website")
    .addItem("Publish schedule now", "publishSchedule")
    .addItem("Check schedule", "checkSchedule")
    .addSeparator()
    .addItem("Set up Schedule tab", "setupScheduleTab")
    .addToUi();
}

function publishSchedule() {
  const ui = SpreadsheetApp.getUi();
  const problems = scheduleProblems_();
  if (problems.length > 0) {
    ui.alert(
      "Not published",
      "Please fix these first:\n\n" + summarize_(problems),
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
      (bump ? "" : ' (Add a "Version 1" header to track versions.)'),
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
  const problems = scheduleProblems_();
  if (problems.length > 0) {
    ui.alert("Problems found", summarize_(problems), ui.ButtonSet.OK);
  } else {
    const version = scheduleVersion_();
    ui.alert(
      "All good",
      "The schedule" +
        (version ? " (version " + version + ")" : "") +
        " is ready to publish.",
      ui.ButtonSet.OK,
    );
  }
}

function setupScheduleTab() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(TAB_NAME);
  // Never re-header a tab with data: its columns may be in another order.
  if (sheet && sheet.getLastRow() > 1) {
    ui.alert(
      "Set up Schedule tab",
      'The "' +
        TAB_NAME +
        '" tab already has rows, so it was left as it is. Set up only works on a new or empty tab.',
      ui.ButtonSet.OK,
    );
    return;
  }
  if (!sheet) sheet = spreadsheet.insertSheet(TAB_NAME);

  // The version goes in its own header, after the class columns (column I).
  sheet
    .getRange(1, 1, 1, HEADERS.length + 1)
    .setValues([HEADERS.concat(FIRST_VERSION_HEADER)])
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  const rows = sheet.getMaxRows() - 1;
  // Columns A (Date), B–C (Start, End) and G (Highlight), as in HEADERS.
  sheet
    .getRange(2, 1, rows, 1)
    .setNumberFormat("yyyy-mm-dd")
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(false)
        .setHelpText("A date, e.g. 2026-11-02")
        .build(),
    );
  sheet.getRange(2, 2, rows, 2).setNumberFormat("HH:mm");
  sheet.getRange(2, 7, rows, 1).insertCheckboxes();

  ui.alert(
    "Set up Schedule tab",
    "Done. Add one row per class: Date, Start and End (24h, e.g. 17:30) and Title. " +
      "Optional: Subtitle, Teachers (comma-separated), Highlight (tick for a gold card) and Notes (never shown on the website). " +
      '"' +
      FIRST_VERSION_HEADER +
      "\" (column I) names the schedule's version: Publish schedule now bumps it, and the website's build log shows the version it read.",
    ui.ButtonSet.OK,
  );
}

function scheduleProblems_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_NAME);
  if (!sheet) {
    return [
      'There is no "' + TAB_NAME + '" tab. Use Website → Set up Schedule tab.',
    ];
  }
  // Displayed values are exactly what the CSV export gives the website.
  return checkRows_(sheet.getDataRange().getDisplayValues());
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
 * row first). Returns one message per problem; an empty list means the build
 * will accept the schedule.
 */
function checkRows_(rows) {
  const header = (rows[0] || []).map((name) =>
    String(name).trim().toLowerCase(),
  );
  const known = HEADERS.map((name) => name.toLowerCase());
  const problems = [];

  const versionHeaders = header.filter((name) => VERSION_HEADER.test(name));
  if (versionHeaders.length > 1) {
    problems.push('More than one "Version …" header');
  }
  header.forEach((name, i) => {
    if (VERSION_HEADER.test(name)) return;
    if (name && known.indexOf(name) === -1) {
      problems.push(
        'Unknown column "' +
          name +
          '". Allowed: ' +
          HEADERS.join(", ") +
          ', and one "Version …" header',
      );
    } else if (name && header.indexOf(name) !== i) {
      problems.push('Column "' + name + '" appears twice');
    }
  });
  REQUIRED.forEach((name) => {
    if (header.indexOf(name) === -1)
      problems.push('Missing column "' + name + '"');
  });
  if (problems.length > 0) return problems;

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
  return problems;
}

/** A real calendar date written yyyy-mm-dd. */
function isDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
