/**
 * LUMA Goa — yoga schedule sheet → website.
 *
 * Paste this whole file into the schedule spreadsheet's Extensions → Apps
 * Script editor (replacing the default Code.gs), save, then reload the
 * spreadsheet: a "Website" menu appears.
 *
 *   Publish schedule now  Checks the Schedule tab, then asks Netlify to
 *                         rebuild the website (live in about 2 minutes).
 *                         Without it, edits go live at the nightly rebuild
 *                         (00:30 Goa time).
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

  // Make sure the last edits are saved before the build reads the sheet.
  SpreadsheetApp.flush();
  const who = Session.getActiveUser().getEmail() || "the schedule sheet";
  const url =
    hookUrl +
    (hookUrl.indexOf("?") === -1 ? "?" : "&") +
    "trigger_title=" +
    encodeURIComponent("Schedule published by " + who);

  let status = 0;
  try {
    status = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: "{}",
      muteHttpExceptions: true,
    }).getResponseCode();
  } catch (error) {
    status = 0;
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
    "The website is rebuilding. The new schedule will be live in about 2 minutes.",
    ui.ButtonSet.OK,
  );
}

function checkSchedule() {
  const ui = SpreadsheetApp.getUi();
  const problems = scheduleProblems_();
  if (problems.length > 0) {
    ui.alert("Problems found", summarize_(problems), ui.ButtonSet.OK);
  } else {
    ui.alert("All good", "The schedule is ready to publish.", ui.ButtonSet.OK);
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

  sheet
    .getRange(1, 1, 1, HEADERS.length)
    .setValues([HEADERS])
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
      "Optional: Subtitle, Teachers (comma-separated), Highlight (tick for a gold card) and Notes (never shown on the website).",
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

  header.forEach((name, i) => {
    if (name && known.indexOf(name) === -1) {
      problems.push(
        'Unknown column "' + name + '". Allowed: ' + HEADERS.join(", "),
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
    if (cells.every((cell) => cell === "")) continue;
    const get = (name) => {
      const at = header.indexOf(name);
      return at === -1 ? "" : cells[at] || "";
    };
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
