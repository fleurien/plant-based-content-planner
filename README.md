# Plant-Based Content Planner

A small, personal keyword research and content planning tool for a solo plant-based recipe blogger. It's a single-page app with two tabs:

- **Keyword Planner** — track candidate recipe keywords (manually or bulk-imported from a Google Keyword Planner CSV export), see an auto-computed Go / Maybe / Skip verdict for each, manually verify the tough calls against real Google search results (SERP Review), and send the good ones on to the Content Planner.
- **Content Planner** — track content items through a 6-stage pipeline (Idea → Tested → Photographed → Drafted → Published (v1) → Refined (v2+)), grouped by content cluster, with freshness tracking to flag posts that need a refresh.

It is plain HTML/CSS/JS with **no build step, no framework, and no npm dependencies**. All data is stored locally in your browser (`localStorage`), with manual JSON export/import as a backup mechanism.

## Running it locally

**Simplest option:** just double-click `index.html` (or open it via File → Open in your browser). Everything — including CSV import/export — works directly from the local file, no server required.

If you'd rather run a tiny local server (optional, not required), any of these work from the project folder:

```
# Python 3
python -m http.server 8000

# Node (if you have it)
npx serve .
```

Then visit `http://localhost:8000`.

## Data & backups

- All keywords and content items are saved automatically to your browser's `localStorage` as you work. Nothing is sent anywhere — there is no backend.
- Because `localStorage` can be lost (cleared cache, browser reinstall, switching devices), use the **"Export data (JSON)"** button regularly to download a backup file, and **"Import data (JSON)"** to restore from one. Importing replaces all current data after a confirmation prompt, and the file is validated on the way in (checked for the expected version marker and minimum required fields per item) so a corrupted or hand-edited backup gets rejected with a clear message instead of silently breaking the app.
- Keyword CSV import is separate from the JSON backup — it's for bulk-adding keywords from a Google Keyword Planner "Keyword Ideas" export, not for restoring a backup.
- If you have this app open in two browser tabs at once, editing in one will show a banner in the other warning you to reload before making changes — otherwise the older tab's next save could silently overwrite the newer one.

## Deploying to GitHub Pages

1. Push this repo to GitHub (create a new repository on GitHub, then add it as a remote and push `main`).
2. On GitHub, go to your repository's **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch".
4. Under "Branch", select `main` and folder `/ (root)`, then click **Save**.
5. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/` within a minute or two. Refresh the Pages settings screen to get the exact link.

No further configuration is needed — `index.html` at the repo root and relative asset paths (`css/`, `js/`) work as-is on Pages.

## Keyword Planner

### Decision rule

Each keyword's Go / Maybe / Skip verdict is computed automatically from three inputs: search volume, competition, and whether you've marked it "Quick to produce" (a lightweight post like an ingredient substitute vs. a full recipe/photo shoot).

| Volume bucket | Competition | Quick to produce | Decision |
|---|---|---|---|
| 0 (no data) | any | any | Skip |
| 10–100 | Low/Medium | Yes | Go |
| 10–100 | Low/Medium | No | Maybe |
| 10–100 | High | Yes | Maybe |
| 10–100 | High | No | Skip |
| 100–1K | Low/Medium | any | Go |
| 100–1K | High | any | Maybe |
| 1K–10K / 10K+ | Low/Medium | any | Go |
| 1K–10K / 10K+ | High | any | Maybe |
| volume or competition unset | — | — | — (pending) |

Volume buckets are derived from the raw number you enter or import: 0, 10–100, 100–1K, 1K–10K, 10K+.

**Note:** Keyword Planner's Competition field measures *ad-auction* competition (how many advertisers bid on a phrase) — for recipe content, which almost never has advertisers, this is a weak proxy for how hard a keyword actually is to *rank* for organically. That's what SERP Review (below) is for.

### SERP Review

A manual check of the real Google results for a keyword, recorded as its own verdict — **Genuine gap**, **Doable, need an angle**, or **Skip, dominated by majors** — kept separate from the automated Decision above (it never overrides or feeds into it). Click "Start SERP Review" with one or more keywords selected to step through them (highest-priority — Go, then Maybe, then the rest — by volume) with a one-click Google search link per keyword; each verdict can also be edited later directly from its badge in the keyword table.

### Sending to Content Planner

Sending a keyword to Content Planner is a **one-way move**, not a copy — the keyword is removed from Keyword Planner (its data preserved on the new Content Planner card) rather than left behind as a duplicate. It won't come back if you re-import the same phrase later either (see CSV import below). The per-row "Send to Content" button only appears once a keyword has both a Go decision and a Genuine-gap/Doable SERP verdict; the bulk "Send" action (with keywords selected) skips that gate and sends whatever you've selected.

### Bulk actions

Select one or more keywords (checkboxes, or "select all visible" to grab everything matching your current filters) to reveal a bulk action bar: set cluster, set competition to Low, set volume to 0, send to Content Planner, start a SERP Review scoped to just the selection, or delete. All of these apply unconditionally to your selection — e.g. "set competition to Low" overwrites an existing Medium/High value too, not just blanks — so the confirm dialogs always show an exact count before anything happens. On narrow/mobile screens the non-destructive actions collapse into an "Actions ▾" menu; Delete stays outside it.

### Keeping the keyword list clean

Deleting a keyword (single or bulk) also adds its phrase to a **"Previously excluded"** list, so a future CSV import of the same keyword won't resurface it for re-triage. This is different from a keyword you've *sent* to Content Planner — that's "in progress," not excluded, and isn't added to this list. Open "Previously excluded (N)" to see everything on it, and remove entries individually or in bulk if you want a phrase eligible for import again — removing an entry only clears the exclusion, it doesn't restore the keyword itself.

### CSV import

The importer expects a Google Keyword Planner "Keyword Ideas" export (CSV or TSV). It:

- Scans the file for the row containing a "Keyword" column header, rather than assuming row 1 is the header (Keyword Planner exports usually have a few preamble lines first).
- Maps `Keyword` → phrase, `Avg. monthly searches` → volume, `Competition` → competition.
- Normalizes volume into the buckets above, including simple range-like values (e.g. `"1K - 10K"` is averaged).
- Skips a phrase already present in any of three places, and reports each separately in the import summary: an active Keyword Planner row (duplicate), the "Previously excluded" list, or an existing Content Planner item's target keyword (already in progress).
- Imports all new rows with "Quick to produce" unchecked by default — toggle it per keyword afterward.

Real Google Keyword Planner exports can vary slightly in column naming, ordering, or preamble format between Ads account settings/locales — worth a spot-check against your own export if something looks off.

## Content Planner

Each item is a fully editable card — no separate edit screen. Title, target keyword (autocompletes against your Keyword Planner list), cluster (autocompletes against clusters you've already used), status, target publish date, published date, last updated date, and notes are all editable directly on the card. Text fields save when you click away; the status dropdown and date fields save the instant you change them.

Items created via "Send to Content Planner" show a read-only "From keyword: … — SERP: …" line carrying over that keyword's data and rationale, so the context isn't lost once it's out of the Keyword Planner list.

Changing Status to "Published (v1)" auto-fills the Published date the first time (won't overwrite one you've set manually); changing it to "Refined (v2+)" auto-fills/updates the Last updated date every time. Both dates can always be edited by hand too.

Cards are grouped into collapsible sections by Cluster, each showing a progress summary (e.g. "World Cuisine — 4 Published, 1 Drafted, 1 Idea (4/6 done)"); anything with no cluster set lands under "Uncategorized." A "Needs refresh only" filter surfaces published items untouched for 6+ months.

"+ Add content item" drops a new blank card straight into the list with its title field focused, ready to type — no dialog. The same checkbox/select-all/bulk-delete pattern as Keyword Planner is available here too, plus a bulk "set cluster" action; deletions here are plain and permanent (nothing here feeds a CSV re-import, so there's no exclusion list on this tab).

## What's intentionally not here

Per the original spec, this tool deliberately does not include: analytics/traffic integration, a rich text editor, multi-user/collaboration features, automated reminders or notifications, calendar integration, an image/media library, version history beyond the single "last updated" timestamp, or approval/comment workflows.
