# Ayurveda & Massage page — open items and data decisions

What remains relevant after implementing the massage page spec (the spec
document itself has been deleted; `/packages` guidance moved with the
packages spec).

## Gallery section — built but disabled

`src/pages/ayurveda-massage.ejs` contains a commented-out Gallery section
(masonry + PhotoSwipe, `data-theme="dim"`, same markup as `yoga-shala.ejs`).
To enable it once gallery photography exists:

1. Shoot 8–12 images: the space, details, therapist hands, exterior.
2. Place them as `/img/ayurveda/gallery/large/NN.jpg` with resized copies in
   `/img/ayurveda/gallery/524/NN.jpg`, mirroring `/img/gallery-shala/`
   (see `scripts/` for the resize tooling).
3. Generate the PhotoSwipe metadata JSON the markup already references:
   `public/gallery-ayurveda-img-metadata.json` — keys must equal the link
   `href`s exactly (see [scripts/CLAUDE.md](../scripts/CLAUDE.md)).
4. Uncomment the section and fill in one `grid-item` per image with a
   descriptive `alt`.

## Treatment data decisions — do not "fix"

`src/data/treatments.json` is owner-approved. Several apparent
inconsistencies with the printed menu PDF are deliberate:

- **Shirodhara and Pizichil are not offered.** The centre lacks the correct
  table for Shirodhara. Both are absent from the JSON by decision, not
  omission — do not re-add them.
- **Four descriptions deliberately differ from the printed menu:**
  Elakizhi, Netra Tarpanam and Nasyam + Dhoomapanam were rewritten for web
  to remove named medical conditions and implausible claims; Abhyangam ends
  "restore the body's natural balance" rather than "electrochemical
  balance". Do not "correct" them back to match the PDF.
- **Njavara Facial is `packageEligible: false` on purpose** — it sits in the
  same price band as the full-body signature treatments but is a facial.
- **The three combo descriptions are owner-approved.** The build fails on
  any description starting with `DRAFT` (see `load-treatments.mjs`), so a
  draft can never reach production.
- **Opening hours are 08:00–21:00 daily** — the 07:00 that appeared in an
  early draft of the centre's notes was superseded by the owner.

## Open owner decision

- **Walk-in vs in-house pricing** is currently identical. Worth considering
  a small preferential rate for in-house guests — it would strengthen the
  packages proposition. Never decided; raise with the owner.
