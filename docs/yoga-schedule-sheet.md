# The yoga schedule sheet

The weekly class grid on `/yoga` is built from a Google Sheet. The office edits the sheet; the website reads it at **build time**, so the schedule ships as plain HTML (good for SEO) and nothing loads in the visitor's browser.

```
Google Sheet ("Schedule" tab)
   │  CSV export, fetched by vite.config.mjs (YOGA_SCHEDULE_CSV_URL)
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

| Column    | Required | Format                                                                  |
| --------- | -------- | ----------------------------------------------------------------------- |
| Date      | yes      | `2026-11-02` (the setup formats the column)                             |
| Start     | yes      | 24h time, `08:30` or `17:30`. Before 12:00 = Morning row, else Evening. |
| End       | yes      | 24h time, after Start                                                   |
| Title     | yes      | e.g. `Morning Hatha`                                                    |
| Subtitle  | no       | Shown small under the title                                             |
| Teachers  | no       | Comma-separated: `Balbi, Seb` → "with Balbi & Seb"                      |
| Highlight | no       | Checkbox — ticked puts the card on brand gold                           |
| Notes     | no       | For the office; never shown on the website                              |
| Version   | no       | A label you change with each edit, e.g. `v12` — see below               |

At most 4 classes fit in one day's Morning (or Evening) slot. A row with only Notes or Version filled is not a class and is skipped. Any other column name fails the build — rename or delete it.

**Version** is how you check a build read your latest edit. Type a label in the first row under the header (`v12`, a date — anything), change it whenever you edit the schedule, and the build log prints what it read:

```
Yoga schedule: Schedule sheet, version "v12" — 28 classes, 2026-11-02 → 2026-11-15 (built 2026-11-03, Goa time)
```

The log is in Netlify under Deploys → the deploy → Deploy log. The sheet's **Check schedule** and **Publish schedule now** messages show the version too.

## One-time setup

1. **Create a spreadsheet just for the schedule.** It will be readable by anyone holding its link, so keep nothing private in it.
2. **Add the script.** Extensions → Apps Script, replace `Code.gs` with [`yoga-schedule-sheet.gs`](yoga-schedule-sheet.gs), save. Reload the spreadsheet, then run **Website → Set up Schedule tab** (Google asks you to authorize the script the first time).
3. **Share it.** Share → General access: _Anyone with the link_ → _Viewer_. Add the people who edit the schedule as _Editors_ by email.
4. **Build the CSV URL** from the spreadsheet id and the Schedule tab's `gid` (both in the browser address bar while the tab is open: `…/spreadsheets/d/<SPREADSHEET_ID>/edit#gid=<GID>`):

   ```
   https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/export?format=csv&gid=<GID>
   ```

   Use this export URL rather than _File → Share → Publish to web_: the published copy can lag behind edits by several minutes, so **Publish schedule now** could rebuild the site with the old schedule.

5. **In Netlify:**
   - Environment variable `YOGA_SCHEDULE_CSV_URL` = that URL, scope **Builds**, all deploy contexts (Deploy Previews then show the real schedule too).
   - Two build hooks on branch `main` (Build hooks, in the project's continuous-deployment settings): one for the nightly rebuild → env var `DAILY_BUILD_HOOK_URL`, scope **Functions**; one for the sheet → step 6. Separate hooks can be revoked separately.
   - Deploy notifications: an email on **deploy failed**, so a rejected schedule doesn't go unnoticed.
6. **Give the sheet its hook.** In the Apps Script editor: Project Settings (gear icon) → Script properties → add `BUILD_HOOK_URL` = the sheet's build hook URL. Anyone who can edit the sheet can see it; it only lets them trigger builds, which the menu does anyway. Delete the hook in Netlify to revoke it.
7. **Local builds** read the same variable from `.env` (`YOGA_SCHEDULE_CSV_URL=…`). Without it, `yarn dev` / `yarn build` use the sample data in `src/data/yoga-schedule.sample.json` and print a warning. A production build without it fails instead of publishing the sample.

## Troubleshooting

**The build read an older schedule** (the logged Version is behind the sheet's):

- If the deploy log warns that `YOGA_SCHEDULE_CSV_URL` is a "Publish to web" link, that's the cause. Google serves the published copy with a 5-minute cache (`cache-control: max-age=300`) and refreshes it on its own schedule, so a build soon after an edit can read the old one. Switch the variable to the export link from step 4. Its `<SPREADSHEET_ID>` is the id in the sheet's own address bar (`/d/<ID>/edit`), not the `/d/e/…` id of the published link.
- `yarn dev` reads the sheet once, when it starts. Restart it to pick up edits.

## Day to day

1. Edit the Schedule tab, and change the Version.
2. **Website → Check schedule** lists any problems by row.
3. **Website → Publish schedule now** checks again, then rebuilds the site. Or do nothing: the nightly rebuild picks the changes up.

The script applies the same rules as the build. If you change a rule in `src/data/load-yoga-schedule.mjs`, change `docs/yoga-schedule-sheet.gs` to match and paste the new version into the sheet's Apps Script editor.
