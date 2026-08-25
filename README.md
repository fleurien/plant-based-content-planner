# Plant-Based Content Planner

A small, personal keyword research and content planning tool for a solo plant-based recipe blogger. It's a single-page app with two tabs:

- **Keyword Planner** — track candidate recipe keywords (manually or bulk-imported from a Google Keyword Planner CSV export), see an auto-computed Go / Maybe / Skip verdict for each, and promote good ones straight into the Content Planner.
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
- Because `localStorage` can be lost (cleared cache, browser reinstall, switching devices), use the **"Export data (JSON)"** button regularly to download a backup file, and **"Import data (JSON)"** to restore from one. Importing replaces all current data after a confirmation prompt.
- Keyword CSV import is separate from the JSON backup — it's for bulk-adding keywords from a Google Keyword Planner "Keyword Ideas" export, not for restoring a backup.

## Deploying to GitHub Pages

1. Push this repo to GitHub (create a new repository on GitHub, then add it as a remote and push `main`).
2. On GitHub, go to your repository's **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch".
4. Under "Branch", select `main` and folder `/ (root)`, then click **Save**.
5. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/` within a minute or two. Refresh the Pages settings screen to get the exact link.

No further configuration is needed — `index.html` at the repo root and relative asset paths (`css/`, `js/`) work as-is on Pages.

## Keyword decision rule

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

## CSV import notes

The importer expects a Google Keyword Planner "Keyword Ideas" export (CSV or TSV). It:

- Scans the file for the row containing a "Keyword" column header, rather than assuming row 1 is the header (Keyword Planner exports usually have a few preamble lines first).
- Maps `Keyword` → phrase, `Avg. monthly searches` → volume, `Competition` → competition.
- Normalizes volume into the buckets above, including simple range-like values (e.g. `"1K - 10K"` is averaged).
- Skips exact duplicate phrases already in your list and reports a short import summary.
- Imports all new rows with "Quick to produce" unchecked by default — toggle it per keyword afterward via Edit.

I tested the importer against synthetic sample data shaped like a real export. **You should verify it against an actual Google Keyword Planner CSV export**, since real exports can vary slightly in column naming, ordering, or preamble format between Google Ads account settings/locales.

## What's intentionally not here

Per the original spec, this tool deliberately does not include: analytics/traffic integration, a rich text editor, multi-user/collaboration features, automated reminders or notifications, calendar integration, an image/media library, version history beyond the single "last updated" timestamp, or approval/comment workflows.
