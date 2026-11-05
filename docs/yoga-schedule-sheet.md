# The yoga schedule sheet

The weekly class grid on `/yoga` is built from a Google Sheet. The office edits the sheet; the website reads it at **build time**, so the schedule ships as plain HTML (good for SEO) and nothing loads in the visitor's browser.

```
Google Sheet ("Schedule" tab, plus an optional "Teachers" tab)
   │  one CSV export per tab, fetched by vite.config.mjs
   │  (YOGA_SCHEDULE_CSV_URL, YOGA_TEACHERS_CSV_URL)
   ▼
src/data/load-yoga-schedule.mjs  →  validates every row, fails the build on errors
   ▼
/yoga  (src/partials/yoga-schedule.ejs + schema.org Events)
```

A build happens:

- **every night at 00:30 Goa time** — `netlify/functions/daily-rebuild.ts`, which also moves the page to the new week on Mondays;
- **on demand** — the sheet's **Website → Publish schedule now** menu, live in about 2 minutes;
- on every deploy of the site.

If a build fails (a bad row, Google unreachable), Netlify keeps the previous version live: the site never breaks, it just doesn't update.

## The Schedule tab

One row per class. Headers are matched case-insensitively, in any order.

| Column    | Required | Format                                                                                                                                                  |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Day       | no       | The weekday, `Mon`, filled from Date by a formula (below) — don't type in it. For whoever fills the rows; the website never reads it                    |
| Date      | yes      | `2026-11-02` (the setup formats the column)                                                                                                             |
| Start     | yes      | 24h time, `08:30` or `17:30`. Before 12:00 = Morning row, else Evening.                                                                                 |
| End       | yes      | 24h time, after Start                                                                                                                                   |
| Title     | yes      | e.g. `Morning Hatha`                                                                                                                                    |
| Subtitle  | no       | Shown small under the title                                                                                                                             |
| Teachers  | no       | Comma-separated: `Balbi, Seb` → "with Balbi & Seb". Each name links to what the Teachers tab (below) gives it                                           |
| Price     | no       | A whole INR amount, `800` (also `₹800`, `1,200`), for a class that doesn't cost the drop-in price shown under the grid. A price equal to it isn't shown |
| Highlight | no       | Checkbox — ticked puts the card on brand gold                                                                                                           |
| Notes     | no       | For the office; never shown on the website                                                                                                              |

At most 4 classes fit in one day's Morning (or Evening) slot. A class that starts before noon and ends after it — `11:00`–`14:00`, or just `11:30`–`12:30` — belongs to both rows, so that day shows a single tall cell listing all its classes in time order instead of a Morning and an Evening cell. For the limit it still counts in the slot it starts in (Morning), so such a day can hold up to 8 classes. A row with only Notes (or only a Day) filled is not a class and is skipped. A class's price is shown on its card only when it differs from the drop-in price (`dropIn` in `src/data/site.mjs`, the one in the Prices block under the grid); every class carries its price, that one by default, in the page's structured data.

**Columns of your own are fine.** Any column the table doesn't list — `Room`, `Paid`… — is ignored by the website. The build log names them (`Schedule sheet: ignoring column(s) Room, Paid`), and so do the sheet's **Check schedule** and **Publish schedule now** messages, so a misspelt column that slipped through shows up there. A column with no header at all is skipped without a mention, so if a column's details (subtitles, teachers, prices, highlights) vanish from the site, check its header is still there. What still fails the build:

- **A name one letter away from a known column**, or the same letters spaced differently — `Teacher`, `Prices`, `Tittle`, `Ends`, `Sub title`, `Hightlight`. That is almost always a typo, and ignoring it would silently drop the column, so the build stops with `did you mean "Teachers"?`. Rename it. A few real words are that close to a short column name (`Pay` is one letter from `Day`); give such a column a longer name. `Day` itself is two letters from `Date`, so both are fine.
- A known column twice, or a required one missing.

**The Day column** shows each class's weekday to whoever fills the rows. A formula fills it from Date, for every row, new ones included — **Set up** puts it in a new tab, **Website → Fill Day column** in an existing one (see Troubleshooting), or paste it in the Day column's row 2 yourself, with the Date column's letter (here B):

```
=ARRAYFORMULA(IF(B2:B="","",TEXT(B2:B,"ddd")))
```

Don't type in the column: a typed cell stops the formula, which then shows `#REF!`. **Check schedule** and **Publish schedule now** compare each class's Day with its Date (`Row 5: Day says Tue but 2026-11-09 is a Monday`; `Mon`, `MON` and `Monday` all pass for a Monday). Only the sheet checks this — the website never reads Day, so the nightly build publishes a mismatch the sheet would have caught. The formula writes day names in the spreadsheet's language (File → Settings → Locale), and the check expects English ones.

**The version is a header of its own**, `Version 12`, in its own column (the setup puts it in column K; any column works, but only one). It is how you check a build read your latest edit:

- **Website → Publish schedule now bumps it** before rebuilding the site: `Version 12` → `Version 13` (the last number goes up: `v09` → `v10`, a bare `Version` → `Version 1`). If Netlify rejects the request, the header is put back, so it always names what was last published.
- Edits left for the nightly rebuild don't bump it — change the number by hand if you want that build to show a new version.
- The column's cells are never read; leave them empty.

The build log prints the version it read:

```
Yoga schedule: Schedule sheet, version "12" — 28 classes, 2026-11-02 → 2026-11-15 (built 2026-11-03, Goa time)
```

followed, when the Teachers tab is read, by what it gave:

```
Yoga teachers: Teachers sheet — 2 link(s); no link for Nicky
```

The log is in Netlify under Deploys → the deploy → Deploy log. The sheet's **Check schedule** and **Publish schedule now** messages show the version too.

## The Teachers tab

Optional: it turns the names in a card's "with …" line into links. One row per teacher; headers are matched case-insensitively, in any order.

| Column | Required | Format                                                                                                                                                                                         |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name   | yes      | As written in the Schedule tab's Teachers column (case doesn't matter)                                                                                                                         |
| Link   | yes      | `#teacher-ashutosh` → the teacher's card in "Meet Your Teachers" on the yoga page · `/ayurveda-massage` → another page of the site · `https://…` → the teacher's own page, opened in a new tab |
| Notes  | no       | For the office; never shown on the website                                                                                                                                                     |

A name the tab doesn't list stays plain text; the build log names it (`no link for Nicky`), which is also how a misspelt name shows up. A name listed twice, a row with only a Name or only a Link, or a link in any other form fails the build. A row with only Notes is skipped. Other columns are ignored and named in the build log, as on the Schedule tab — except a near-miss of `Name`, `Link` or `Notes` (`Links`), which fails the build.

The card anchors are the `id`s of the teacher cards in `src/pages/yoga.ejs`: `teacher-` and the first name in lower case (`#teacher-ashutosh`, `#teacher-emilia`). Adding a teacher to the website means adding a card with such an `id` there. The build can't check that an anchor exists — a wrong one is a link that scrolls nowhere — so copy it from the page.

## One-time setup

1. **Create a spreadsheet just for the schedule.** It will be readable by anyone holding its link, so keep nothing private in it.
2. **Add the script.** Extensions → Apps Script, replace `Code.gs` with [`yoga-schedule-sheet.gs`](yoga-schedule-sheet.gs), save. Reload the spreadsheet, then run **Website → Set up Schedule & Teachers tabs** (Google asks you to authorize the script the first time).
3. **Share it.** Share → General access: _Anyone with the link_ → _Viewer_. Add the people who edit the schedule as _Editors_ by email.
4. **Build one CSV URL per tab** from the spreadsheet id and the tab's `gid` (both in the browser address bar while that tab is open: `…/spreadsheets/d/<SPREADSHEET_ID>/edit#gid=<GID>` — every tab has its own `gid`):

   ```
   https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/export?format=csv&gid=<GID>
   ```

   Use this export URL rather than _File → Share → Publish to web_: the published copy can lag behind edits by several minutes, so **Publish schedule now** could rebuild the site with the old schedule.

5. **In Netlify:**
   - Environment variable `YOGA_SCHEDULE_CSV_URL` = the Schedule tab's URL, scope **Builds**, all deploy contexts (Deploy Previews then show the real schedule too).
   - Environment variable `YOGA_TEACHERS_CSV_URL` = the Teachers tab's URL, same scope and contexts. Without it the build still succeeds, but teacher names are plain text and the deploy log says `YOGA_TEACHERS_CSV_URL is not set`.
   - Two build hooks on branch `main` (Build hooks, in the project's continuous-deployment settings): one for the nightly rebuild → env var `DAILY_BUILD_HOOK_URL`, scope **Functions**; one for the sheet → step 6. Separate hooks can be revoked separately.
   - Deploy notifications: an email on **deploy failed**, so a rejected schedule doesn't go unnoticed.
6. **Give the sheet its hook.** In the Apps Script editor: Project Settings (gear icon) → Script properties → add `BUILD_HOOK_URL` = the sheet's build hook URL. Anyone who can edit the sheet can see it; it only lets them trigger builds, which the menu does anyway. Delete the hook in Netlify to revoke it.
7. **Local builds** read the same variables from `.env` (`YOGA_SCHEDULE_CSV_URL=…`, `YOGA_TEACHERS_CSV_URL=…`). Without the first, `yarn dev` / `yarn build` use the sample data in `src/data/yoga-schedule.sample.json` and `yoga-teachers.sample.json` and print a warning. A production build without it fails instead of publishing the sample.

## Troubleshooting

**The build read an older schedule** (the logged version is behind the sheet's `Version …` header):

- If the deploy log warns that `YOGA_SCHEDULE_CSV_URL` is a "Publish to web" link, that's the cause. Google serves the published copy with a 5-minute cache (`cache-control: max-age=300`) and refreshes it on its own schedule, so a build soon after an edit can read the old one. Switch the variable to the export link from step 4. Its `<SPREADSHEET_ID>` is the id in the sheet's own address bar (`/d/<ID>/edit`), not the `/d/e/…` id of the published link.
- `yarn dev` reads the sheet once, when it starts. Restart it to pick up edits.

**The sheet still has a `Version` column with the value underneath** (the earlier layout): change the header to `Version <that value>` (e.g. `Version 5`) and clear the cell below it. Until then nothing breaks; the build just logs "version not set".

**The Schedule tab has no Day column** (it was set up before Day existed). In this order:

1. Paste the current [`yoga-schedule-sheet.gs`](yoga-schedule-sheet.gs) into the sheet's Apps Script editor and reload the spreadsheet. An older script calls `Day` an unknown column and refuses to publish.
2. Right-click the letter above the Date column → **Insert 1 column left**, and type `Day` in its first cell.
3. **Website → Fill Day column.** It finds the Day and Date columns by their headers and puts the formula in. It does nothing if the Day column already has something below its header; clear it first.

## Day to day

1. Edit the Schedule tab — and the Teachers tab when a teacher or a link changes.
2. **Website → Check schedule** lists any problems by row, in both tabs, and the columns the website ignores.
3. **Website → Publish schedule now** checks again, bumps the version, then rebuilds the site. Or do nothing: the nightly rebuild picks the changes up.

The script applies the same rules as the build, plus one of its own: the Day check. If you change a rule in `src/data/load-yoga-schedule.mjs`, change `docs/yoga-schedule-sheet.gs` to match and paste the new version into the sheet's Apps Script editor.
