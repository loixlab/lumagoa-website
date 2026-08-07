---
applyTo: "scripts/**"
---

# `scripts/` — Python Image & Schedule Tooling

Standalone Python 3 helpers run by hand from the repo root. They are **content-prep tools, not part of the build** — nothing in `yarn build` or the Netlify deploy invokes them, and their output is committed to `public/`.

## Dependencies

Not managed by `package.json` — install them yourself:

```bash
pip3 install pillow pillow-heif requests python-dotenv pyperclip
```

`pillow-heif` is what lets the resize scripts read the `.HEIC` files that come off a phone. `pyperclip` is optional — the schedule script falls back to printing.

## The scripts

### `resize_images.py <maxWidth> <folder>` — gallery images

Resizes every image in `<folder>` that is wider than `<maxWidth>`, writing JPEGs into a **`resized/` subfolder of the input folder**. Handles `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.heic`; everything comes out as `.jpg`.

```bash
python3 ./scripts/resize_images.py 1600 ~/Desktop/gallery/originals
```

### `resize_hero_image.py <image>` — hero / social images

Takes one image and writes three center-cropped variants **next to it**, using the naming the pages already reference:

| Output               | Size      | Used for         |
| -------------------- | --------- | ---------------- |
| `<name>_display.jpg` | 1920×1080 | the on-page hero |
| `<name>_og.jpg`      | 1200×630  | `og:image`       |
| `<name>_twitter.jpg` | 1200×675  | `twitter:image`  |

```bash
python3 ./scripts/resize_hero_image.py ./public/img/cafe-hero.HEIC
```

**Keep the `_display` / `_og` / `_twitter` suffixes** — `head.ejs`'s `extraMeta` blocks reference them by name.

### `image_metadata.py <folder> <basepath> --output <file>` — PhotoSwipe dimensions

Emits the JSON that the galleries need, keyed by the image's **web path** (`<folder>` relative to `<basepath>`, with a leading slash):

```json
{
  "/img/gallery/large/01.jpg": {
    "filename": "…",
    "width": 1600,
    "height": 1055
  }
}
```

### `generate_shala_schedule_table.py [csv]` — yoga schedule table

Turns the office's class schedule into the HTML table pasted into `src/pages/yoga-shala.ejs`. With no argument it fetches `SCHEDULE_SPREADSHEET` (a published-as-CSV Google Sheet URL) from `.env`; pass a path to use a local CSV instead. Prints the HTML and copies it to the clipboard when `pyperclip` is installed.

```bash
python3 ./scripts/generate_shala_schedule_table.py
```

The output is **pasted into the page by hand** — the schedule is not fetched at runtime, so the page is stale until someone regenerates and commits it.

## Adding gallery images (MANDATORY sequence)

The galleries break silently if the metadata isn't regenerated — PhotoSwipe needs real pixel dimensions, and `src/ts/gallery.ts` only logs a per-image `console.warn` when they're missing.

1. Resize to full-size (`resize_images.py 1600 …`) → move into `public/img/<gallery>/large/`.
2. Resize to thumbnails (`resize_images.py 524 …`) → move into `public/img/<gallery>/524/`.
3. Add the `.grid-item` markup to the page: `href` → the `large/` path, `<img src>` → the `524/` path, plus a descriptive `alt` and `loading="lazy"`.
4. **Regenerate that gallery's metadata file:**

   ```bash
   # /gallery — there is a yarn script for this one
   yarn generate-gallery-metadata

   # /yoga-shala — no yarn script; run it directly
   python3 ./scripts/image_metadata.py \
     $PWD/public/img/gallery-shala/large $PWD/public \
     --output ./public/gallery-shala-img-metadata.json
   ```

5. Commit the regenerated JSON along with the images.

**`yarn generate-gallery-metadata` only covers `public/img/gallery`.** The shala gallery has its own folder and its own output file — running the yarn script after adding shala images does nothing useful.

## Rules

- **Keep these scripts dependency-light and runnable standalone.** They're occasional-use office tooling; don't wire them into the Vite build or make them require a `node_modules` install.
- **Commit the generated output** (resized images and metadata JSON). Nothing regenerates them at deploy time.
- **Filenames are content, not implementation** — the metadata JSON keys, the page markup and the files on disk must agree exactly, including case and extension.
- **`.env` is gitignored**, so `SCHEDULE_SPREADSHEET` has to be set up locally per machine.
