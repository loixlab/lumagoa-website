---
name: handle-cr-comments
description: Handle a round of code-review (CR) comments on a PR in the LUMA Goa website repo — fetch, categorize, fix, AND adversarially audit your own changes before pushing. Use when the user asks to "check the CR", "address PR comments", "validate and fix the review", pastes a GitHub PR review URL (`/pullrequestreview-N`), or otherwise points at unresolved reviewer feedback. This skill exists because reactive fixing (only addressing flagged items) lets the same class of issue survive elsewhere in the site and the next review round finds it — be adversarial up front to break the loop.
---

# Handling a round of CR comments (LUMA Goa website)

The default failure mode is **reactive fixing**: read each comment, patch each item, push, repeat. Reviewers flag _patterns_ — an unregistered page, a hardcoded brand colour, a missing `x-cloak`, an unguarded env var. Patch only the one line they cite and the same pattern survives on the next page or the other function, so the next round re-flags it. The fix is to find every sibling of each flagged issue before pushing.

This repo has **no test suite**, so the audit below is the safety net. Nothing else will catch a regression.

## The flow

```
[before each round]
assess: still real issues? or nits/diminishing returns? → if nits, surface + ask before fixing
                                ↓
fetch comments → categorize → fix → adversarial self-audit → validate → commit + push → reply to false positives
                                              ^
                                    this is the step that's usually skipped
```

## Step 0 — Decide whether to address this round at all

Automated reviewers have **no built-in "ship it" threshold** — they will always find at least one thing. Treating every round as "address everything" turns review into a treadmill.

**After every round** (especially round 4+), classify the trajectory before fetching:

- **Rounds 1–3 usually surface real consistency/correctness issues.** Address them.
- **Rounds 4+ often shift to hardening, "could also clarify", and style nits.** Diminishing returns.

If the trajectory has shifted from "real issues" to "nits", **surface it to the user with a concrete recommendation before doing the work** — a short round-history table (round / #comments / nature) and a clear choice: ship now / fix this round then ship / keep iterating / dismiss the reviewer on the PR. The operator decides when to ship. Only proceed if they say keep going.

## Step 1 — Fetch the comments

The repo is `loixlab/lumagoa-website`. For a URL like `https://github.com/loixlab/lumagoa-website/pull/N#pullrequestreview-REVIEW_ID`:

```bash
gh api repos/loixlab/lumagoa-website/pulls/N/reviews/REVIEW_ID --jq '{state, body}'
gh api repos/loixlab/lumagoa-website/pulls/N/comments --paginate \
  --jq '.[] | select(.pull_request_review_id == REVIEW_ID) | {id, path, line, body}'
```

Capture each comment's `id` — you need it to reply to false positives in Step 7.

## Step 2 — Categorize every comment

- **Valid** — a real bug, an unregistered page, a convention violation, a security or PII issue. Fix.
- **Valid-but-nit** — technically correct wording/style nit. Fix if cheap.
- **False positive** — the reviewer is wrong. Verify against the actual code before deciding. Do not change the file; reply with evidence in Step 7. Common false positives in this repo are listed inline in Step 4 — the `x-cloak` and `data-theme="dim"` ones especially.

## Step 3 — Fix each valid item

Minimal, scoped edits. Don't bundle unrelated rewrites into a CR-response commit.

## Step 4 — Adversarial self-audit (THE step that breaks the loop)

After fixing the cited lines, **grep the whole tree for every sibling of each pattern** the reviewer raised. The next reviewer reads the integrated site, not just your diff.

### 4a. New/changed page wiring (the #1 source of silent breakage)

There is **no layout partial** — every page assembles the skeleton itself, so a new page can be missing any piece with no build error:

```bash
# every page registered in vite.config.mjs?
for f in src/pages/*.ejs; do n=$(basename "$f" .ejs); \
  grep -q "\"$n\"" vite.config.mjs || echo "UNREGISTERED: $n"; done
# every page loading Alpine?
for f in src/pages/*.ejs; do grep -q 'src="/src/main.ts"' "$f" || echo "NO ALPINE: $f"; done
# every page carrying the GTM noscript iframe?
grep -rLn 'googletagmanager.com/ns.html' src/pages/*.ejs
```

Also check: the page is in `public/sitemap.xml`, `Disallow`ed in `public/robots.txt` if it shouldn't be indexed, has a canonical via `extraContent`, and passes `title` + `description` to `head.ejs`.

### 4b. `schemaData` and meta

- **`schemaData` must be a single object.** `head.ejs` wraps it in a JSON-LD array already, so an array argument emits `[[…]]` and invalidates the whole block. Validate the rendered JSON-LD if a page's schema changed.
- If a reviewer flags one page's `og:`/`twitter:` block, check every page's `extraMeta` — they're hand-written per page and drift.

### 4c. Alpine conventions

- **`x-show` needs `x-cloak`** only when the element is _hidden_ in the initial render. Grep candidates, then filter:
  ```bash
  grep -rn 'x-show' src/pages src/partials | grep -v 'x-cloak'
  ```
  **Expect false positives.** An element whose initial state is visible (e.g. `x-show="view === 'loading'"` where `view` starts as `loading`) does not need it, and neither does an element nested inside an already-cloaked parent. Flagging those is churn — verify the component's initial state in `src/ts/` before "fixing".
- **Logic belongs in `src/ts/`**, not inline. Grep for inline object literals and stray scripts:
  ```bash
  grep -rn 'x-data="{' src/pages src/partials
  grep -rn '<script>' src/pages src/partials
  ```
  Legitimate exceptions: the GTM/Meta Pixel snippets in `head.ejs` and Razorpay's `checkout.js` tag on `deposit-payment.ejs`.
- **Every component must be registered in `src/main.ts` before `Alpine.start()`** — an unregistered `x-data` name fails silently at runtime.
- **URL-supplied values render with `x-text`, never `x-html`** (see `paymentSuccess`, which reads the guest name from the query string).

### 4d. Endpoint paths and function conventions

```bash
grep -rn '\.netlify/functions' src/ --include='*.ts' --include='*.ejs'   # must be empty
```

If a reviewer flags one function, **check the other one too** — there are only two, and they share every convention: V2 signature returning `Response.json(...)`, params via `new URL(req.url).searchParams`, required env vars guarded with a logged generic 500, `response.ok` checked on `fetch`, indexed access defaulted (`guest[9] ?? ""`) rather than asserted.

**`get-booking` is public and unauthenticated over guest PII** (name, email, phone, dates). If a change widens its response, that's a valid finding even if the reviewer framed it as something else. Its column indices are a contract with the Google Sheet, and the CSV parse is a naive `split(",")`.

### 4e. Duplicated constants (fix one, grep the rest)

Several values legitimately live in more than one place because CSS can't reach the JS ones. When a reviewer flags a hardcoded value, fix **every** occurrence or none:

```bash
grep -rn 'c66f54' src/ --include='*.ts' --include='*.css' --include='*.ejs'   # brand colour: ~10 sites
grep -rln 'GTM-KFRQ57PP' src/                                                # GTM id: head.ejs + every page
```

The brand colour is the DaisyUI `--color-primary` in `styles.css`, `PRIMARY_BRAND_COLOR` in `google-map.ts`, the Razorpay checkout theme in `deposit-payment.ts`, plus arbitrary `bg-[#c66f54]` utilities in the pages. Prefer `primary`/`bg-primary` in markup over a new literal.

### 4f. Styling

- **DaisyUI component first**, Tailwind utilities for layout. Custom CSS in `styles.css` needs a reason.
- The footer sets `data-theme="dim"` on itself deliberately — a reviewer calling that inconsistent with the page's `pastel` is a **false positive**.
- Mobile-first: check the change at a narrow viewport before claiming it's responsive.

### 4g. Galleries

Images added or renamed require the matching metadata JSON to be regenerated (`yarn generate-gallery-metadata` for `/gallery`; run `scripts/image_metadata.py` directly for `gallery-shala`). The JSON keys must equal the link `href` exactly — a mismatch is a silent `console.warn` and a broken lightbox, not an error.

### 4h. Instruction-file sync

Changing a `CLAUDE.md` requires updating its `.github/instructions/*.instructions.md` mirror (or `.github/copilot-instructions.md` for the root) **in the same commit**. If a reviewer catches drift in one pair, check all four:

```bash
diff <(grep -E '^(- )?\*\*' netlify/CLAUDE.md) \
     <(grep -E '^(- )?\*\*' .github/instructions/netlify.instructions.md)
```

See `docs/INSTRUCTION_FILES.md` for the allowed divergences.

## Step 5 — Validate

Run what CI runs, in this order — the format step rewrites files, so it must come before you stage:

```bash
yarn format      # CI fails if this changes anything after your commit
yarn typecheck   # both TS projects; the only thing that type-checks either one
yarn build       # catches EJS/template errors the type-checker can't see
```

For anything touching `/api/*` or the deposit flow, exercise it through `yarn dev:netlify` (`:8888`) — plain `yarn dev` does not serve functions. **`create-order` uses the live Razorpay key**, so a local call creates a real order.

## Step 6 — Commit and push

Single descriptive commit:

```
Address CR (round N): <short summary of the changes, not the comments>

- <change 1 with the *why*>
- <change 2>
```

End the message with the `Co-Authored-By: Claude …` trailer (see `CLAUDE.md`). Push to the PR's branch — note the local branch may track a differently-named remote branch (`git rev-parse --abbrev-ref @{u}`), so prefer `git push -q origin HEAD`.

## Step 7 — Reply to false positives

For any comment flagged as a false positive, reply inline with evidence:

```bash
gh api -X POST repos/loixlab/lumagoa-website/pulls/N/comments/COMMENT_ID/replies -f body="..."
```

Be specific and show the evidence: "`view` initialises to `loading`, so this section is visible on first paint and needs no `x-cloak` — the guard is only for elements hidden in the initial render." Don't be defensive.

## Report

Summarize: which comments were valid vs false positives, what you fixed, **which siblings the audit caught that the reviewer hadn't flagged yet**, and the results of `yarn format` / `yarn typecheck` / `yarn build`. If the trajectory is trending to nits, restate the ship/iterate recommendation.
