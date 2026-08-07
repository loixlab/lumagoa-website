# AI Instruction Files — Layout and Sync

This repo gives AI agents (Claude Code, GitHub Copilot) layered instructions so the right rules load at the right time without bloating every prompt. The structure mirrors the adjacent `tradegist_website` repo.

## Why this exists

- A single large instruction file bloats every Claude / Copilot turn. Aim for **under ~200 lines per `CLAUDE.md`**.
- Claude Code auto-loads ancestor `CLAUDE.md` files **at session start** and descendant `CLAUDE.md` files **on demand** (when Claude reads a file in that subtree).
- GitHub Copilot reads a universal `.github/copilot-instructions.md` plus path-scoped `.github/instructions/*.instructions.md` files (matched by `applyTo:` globs).
- We use both lazy-loading mechanisms to keep the always-on context small while still giving full guidance when work touches a specific area.

## File layout

```
CLAUDE.md                                  # Root — always-on cross-cutting rules
docs/
  INSTRUCTION_FILES.md                     # This file
.github/
  copilot-instructions.md                  # Mirror of root CLAUDE.md (Copilot universal)
  instructions/                            # Path-scoped Copilot files
    src.instructions.md                    # applyTo: src/**
    netlify.instructions.md                # applyTo: netlify/**
    scripts.instructions.md                # applyTo: scripts/**
src/CLAUDE.md                              # Frontend: EJS MPA, Tailwind/DaisyUI, Alpine
netlify/CLAUDE.md                          # Functions: Razorpay deposits + booking lookup
scripts/CLAUDE.md                          # Python image + schedule tooling
```

`.github/instructions/daisyui.instructions.md` is a **vendored** DaisyUI v5 reference (downloaded from daisyui.com's `llms.txt`, `applyTo: "**"`). It is not a hand-maintained pair — Claude references the same content via the URL noted in `src/CLAUDE.md`, so there is no `CLAUDE.md` to keep it in sync with.

## Maintenance contract

Each `<dir>/CLAUDE.md` has a paired `.github/instructions/<slug>.instructions.md` covering the **same rules**, plus a YAML frontmatter:

```markdown
---
applyTo: "<glob matching the same files>"
---

<rules — same content as the CLAUDE.md>
```

**When editing any `CLAUDE.md`, update its mirror in the same commit.** Same for the root `CLAUDE.md` ↔ `.github/copilot-instructions.md` pair. The rule **content** must stay in sync; presentation may differ slightly.

### Allowed divergence

1. **Cross-references.** `CLAUDE.md` files link to other `CLAUDE.md` files with Markdown links; Copilot mirrors reference siblings by name (`netlify.instructions.md`) since paths differ.
2. **Glob breadth.** `applyTo:` may legitimately cover more than the `CLAUDE.md`'s own directory — document such inclusions inline.
3. **The "Where to find more guidance" table** in the root `CLAUDE.md` is Claude-specific; the root Copilot file omits it (Copilot uses `applyTo:` globs instead).

### What must stay identical

- Every **rule** (every `- **…**` bullet, every numbered step, every code block enforcing a pattern) appears in both files with the same meaning. Light prose trimming is fine; changing _when or how_ a rule applies is drift, not trimming.
- Tables of facts (env vars, sheet column indices, head.ejs params, component registry) must match row for row.

### Sanity check during review

```bash
diff <(grep -E '^(- )?\*\*' netlify/CLAUDE.md) \
     <(grep -E '^(- )?\*\*' .github/instructions/netlify.instructions.md)
```

## A note on `.gitignore`

`.gitignore` previously contained the pattern `*.github/`, which matched this repo's `.github/` directory and kept the whole thing — Copilot instructions included — untracked. If Copilot ever appears to ignore these files, check that `.github/` is actually committed:

```bash
git ls-files .github/
```
