# Plant-Based Content Planner — Claude Code Instructions

A personal keyword-research + content-planning tool for a solo plant-based recipe blogger (the blog itself lives in a sibling repo, `the-plant-based-blog` at `D:\03_Resources\Repos\the-plant-based-blog` — its `CLAUDE.md` has the content/growth strategy that shaped this app's design; read it if you need the "why" behind a feature). This app is where that strategy is actually operationalized day-to-day.

[README.md](README.md) covers how to run/deploy the app, the full feature set of both tabs, and the CSV import format — read it too. It's current as of 2026-08-30; if you add or change a user-facing feature, update README.md's relevant section in the same change rather than letting it drift again.

## Stack & conventions
- Plain HTML/CSS/JS, **no build step, no framework, no npm dependencies**. `index.html`, `css/styles.css`, `js/app.js`.
- Persistence is **localStorage only** — no backend. Real user data lives in the browser, not in this repo. JSON export/import is the manual backup mechanism.
- **Test via a local static server before committing** (`python -m http.server <port>`), drive the real UI (JS-driven DOM interaction + `getBoundingClientRect()` checks work well when screenshots aren't available in-session), and check the console for errors — this has been the working pattern throughout development, not just a suggestion.
- **Do not push to `origin`** (`https://github.com/fleurien/plant-based-content-planner.git`) without the user explicitly asking — commits have been kept local-only through development so far; ask before the first push.
- When a design/layout change is non-trivial, verify it yourself in-browser (measure real rendered widths/positions) rather than trusting a build report at face value — a prior session's "looks correct" self-report on a bulk-action bar turned out to have a real layout bug the user had to catch manually.

## Design system
Warm food-inspired palette — mustard/gold accent, fennel green (Go/positive), amber (Maybe), rust (Skip/danger). Fraunces (headings), Public Sans (body), IBM Plex Mono (data/phrases/numbers, tabular figures). Full light/dark/system theming via CSS custom properties (`:root`, `:root:not([data-theme="light"])` under the dark media query, `:root[data-theme="dark"]` for the explicit toggle — check `css/styles.css` for actual token names before inventing new ones). `prefers-reduced-motion` respected throughout. Editorial-but-utilitarian — this is a data tool used weekly, not a marketing page; favor clarity and legible dense tables over decoration.

## Core business logic (don't casually change without confirming with the user — these encode real product decisions)

**Go/Maybe/Skip decision** — computed from volume bucket × competition × a per-keyword "Quick to produce" flag. Full rule table is in README.md and mirrored in `computeDecision()`/`computeDecisionRaw()` in `js/app.js`. Note: Keyword Planner's Competition field measures *ad-auction* competition, not organic SEO ranking difficulty — that's *why* the SERP Review feature exists as a separate signal.

**SERP Review** — a manual, per-keyword verdict (Genuine gap / Doable, need an angle / Skip, dominated by majors) stored separately from the automated Decision (`serpVerdict`, `serpCheckedAt` fields). Never let SERP verdict feed back into or override the automated Decision computation — they're deliberately independent signals.

**Sending a keyword to Content Planner is a one-way move, not a copy.** The keyword is removed from Keyword Planner (its data snapshotted onto the new content item via `sourceKeywordSnapshot`, plus `sourceKeywordId` kept for a live-lookup fallback) and is *not* added to the exclusion list — "in progress" and "excluded" are different concepts on purpose, don't conflate them.

**The "Previously excluded" list** (`state.deletedPhrases`) is a CSV re-import guard, not a delete history — phrases here get silently skipped on future CSV imports. Bulk keyword deletes add to this list; Content Planner deletes never do (not CSV-sourced, nothing to guard against). Internal variable/function/localStorage-key names still say "deleted" (`deletedPhrases`, `addDeletedPhrases`) — that's intentional, only user-facing copy was renamed to "excluded" for clarity; don't rename the internals without a real reason, it'd need a data migration for zero user benefit.

**CSV import** skips a phrase if it matches (normalized: trim + lowercase, via `normalizePhrase()`) any of: an active Keyword Planner row, the exclusion list, or an existing Content Planner item's target keyword — three separate, distinctly-reported checks. Don't collapse them into one "duplicate" category; the user relies on the distinction.

**Content Planner cards are fully inline-editable** (no modal) — title, target keyword, cluster (autocomplete), a 6-stage status `<select>` styled as a pill, three dates, and notes, all editable directly on the card. Auto-saves on `blur` for text-like fields, on `change` for select/date fields. The Published-date and Last-updated-date auto-fill-on-status-transition logic (fires when Status changes *into* "Published (v1)" / "Refined (v2+)" from a different previous value, never stomping a manually-set date) lives in `commitContentField()` — preserve this exact transition logic if you touch status handling.

## Where the content actually comes from
The keyword clusters and priorities loaded into this tool trace back to the growth strategy in the blog repo's `CLAUDE.md` — if you're deciding what a "good" keyword or cluster looks like, that context matters more than generic SEO heuristics.
