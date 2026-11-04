/**
 * LUMA Goa — booking IDs for the bookings spreadsheet.
 *
 * Paste this whole file into the bookings spreadsheet's Extensions → Apps
 * Script editor (replacing the default Code.gs), save, then reload the
 * spreadsheet: a "Bookings" menu appears.
 *
 *   Generate booking ID for selected rows
 *     Select one or more booking rows (any cells in them, several ranges
 *     allowed) in the tab whose column A is headed "bookingId", then click.
 *     Each selected row with no ID yet gets a new one in column A.
 *
 * The booking ID is what a guest enters on the website's /deposit-payment
 * page, and the only thing standing between a caller and that guest's name,
 * email and phone (netlify/functions/get-booking.ts reads the bookingId
 * column). So IDs are long, random and never reused:
 *   - ID_LENGTH characters from an alphabet without look-alikes (no 0/O,
 *     1/I/L), drawn from Utilities.getUuid()'s random bits, not Math.random();
 *   - unique against every ID already in column A;
 *   - an existing ID is never overwritten — changing it would break the
 *     guest's deposit link;
 *   - empty rows are skipped, so selecting a whole column can't fill
 *     thousands of blank rows.
 *
 * If the spreadsheet's Apps Script project already has an onOpen(), add this
 * menu to it instead of keeping two onOpen functions.
 */

const ID_HEADER = "bookingId";
// Unambiguous when read aloud or typed: no 0/O, no 1/I/L.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ID_LENGTH = 8;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Bookings")
    .addItem("Generate booking ID for selected rows", "generateBookingIds")
    .addToUi();
}

function generateBookingIds() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const header = String(sheet.getRange(1, 1).getDisplayValue()).trim();
  if (header.toLowerCase() !== ID_HEADER.toLowerCase()) {
    ui.alert(
      "Booking IDs",
      'Select rows in the bookings tab: its column A must be headed "' +
        ID_HEADER +
        '".',
      ui.ButtonSet.OK,
    );
    return;
  }

  // Two people clicking at the same moment must not hand out the same ID.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    ui.alert(
      "Booking IDs",
      "Someone else is generating IDs right now. Try again in a moment.",
      ui.ButtonSet.OK,
    );
    return;
  }

  const added = [];
  let alreadyHadId = 0;
  let emptyRows = 0;
  try {
    const lastRow = sheet.getLastRow();
    const rows = selectedRows_(sheet, lastRow);
    if (rows.length === 0) {
      ui.alert(
        "Booking IDs",
        "Select one or more booking rows below the header first.",
        ui.ButtonSet.OK,
      );
      return;
    }

    // Every row's displayed values, read once: row r is values[r - 2].
    const values =
      lastRow > 1
        ? sheet
            .getRange(2, 1, lastRow - 1, sheet.getLastColumn())
            .getDisplayValues()
        : [];
    const taken = new Set(
      values.map((cells) => normalize_(cells[0])).filter(Boolean),
    );

    rows.forEach((row) => {
      const cells = values[row - 2] || [];
      if (normalize_(cells[0])) {
        alreadyHadId++;
        return;
      }
      if (cells.slice(1).every((cell) => String(cell).trim() === "")) {
        emptyRows++;
        return;
      }
      const id = unusedId_(taken);
      taken.add(id);
      // Plain text, so an ID like "2E5…" is never read as a number.
      sheet.getRange(row, 1).setNumberFormat("@").setValue(id);
      added.push(id);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  const skipped = [];
  if (alreadyHadId) {
    skipped.push(
      alreadyHadId +
        (alreadyHadId === 1
          ? " row already had an ID"
          : " rows already had an ID"),
    );
  }
  if (emptyRows) {
    skipped.push(emptyRows + (emptyRows === 1 ? " empty row" : " empty rows"));
  }
  ui.alert(
    "Booking IDs",
    (added.length
      ? "Added " +
        added.length +
        (added.length === 1 ? " booking ID: " : " booking IDs: ") +
        added.join(", ") +
        "."
      : "No booking IDs added.") +
      (skipped.length ? "\nSkipped: " + skipped.join(", ") + "." : ""),
    ui.ButtonSet.OK,
  );
}

/** The selected rows below the header (and within the data), sorted, each once. */
function selectedRows_(sheet, lastRow) {
  const rangeList = sheet.getActiveRangeList();
  if (!rangeList) return [];
  const rows = {};
  rangeList.getRanges().forEach((range) => {
    const last = Math.min(range.getLastRow(), lastRow);
    for (let row = Math.max(range.getRow(), 2); row <= last; row++) {
      rows[row] = true;
    }
  });
  return Object.keys(rows)
    .map(Number)
    .sort((a, b) => a - b);
}

/** How get-booking compares IDs: trimmed, case-insensitive. */
function normalize_(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function unusedId_(taken) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = randomId_();
    if (!taken.has(id)) return id;
  }
  throw new Error("Could not find an unused booking ID");
}

/** ID_LENGTH characters from ALPHABET, all equally likely. */
function randomId_() {
  const accept = ALPHABET.length * Math.floor(256 / ALPHABET.length); // 248
  let id = "";
  while (id.length < ID_LENGTH) {
    // A v4 UUID is 32 hex digits, two of them fixed: the version (index 12)
    // and the variant (index 16). The other 30 are random — 15 bytes.
    const hex = Utilities.getUuid().replace(/-/g, "");
    const random = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
    for (let i = 0; i + 2 <= random.length && id.length < ID_LENGTH; i += 2) {
      const byte = parseInt(random.slice(i, i + 2), 16);
      // Rejection sampling: bytes 248–255 would favour the first characters.
      if (byte < accept) id += ALPHABET.charAt(byte % ALPHABET.length);
    }
  }
  return id;
}
