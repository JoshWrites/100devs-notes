# Migrating Notes from Coda

Coda export doesn't work, so we migrate manually via the browser.

## Structure

- **Coda "by Author and Date"**: Table linking Author → Date pages (sorted by author)
- **Each page**: One contributor's notes for one huddle date
- **Format**: "Notes by [Author]" at top, then huddle content
- **Repo layout**: Notes are organized as `notes/{author-slug}/{date}.md` (e.g. `notes/michaelgovaerts/2026-02-27.md`)

## Automated Migration

### Full automated crawl (Puppeteer)

Run the full crawl in one command:

```bash
npm run coda:automate
```

This will:

1. Launch Puppeteer, navigate to the Coda index
2. Extract all note links (author + date + URL) and merge with `docs/pages-to-migrate.json`
3. For each undone page: visit URL → accessibility snapshot → parse to markdown → mark done

If Coda requires login, run with a visible browser:

```bash
CODA_HEADED=1 npm run coda:automate
```

### Manual agent flow (browser MCP + scripts)

The Cursor agent can also automate migration using browser MCP + scripts:

### 1. Extract page list (one-time or when table changes)

1. Navigate to [Huddle Notes by Author and Date](https://coda.io/d/100Devs-Huddle-Notes_dRH5Faq2FwO/Huddle-Notes-by-Author-and-Date_su6WnUKK)
2. Take `browser_snapshot`
3. Pipe snapshot to extractor:
   ```bash
   # Save snapshot to file, then:
   cat snapshot.json | node scripts/extract-page-list.js --merge
   ```
   Use `--merge` to preserve `done` flags on already-migrated pages.

### 2. Migrate each page (agent loop)

1. Run `node scripts/crawl-coda.js next` → get `{ author, date, linkRef }`
2. `browser_click(linkRef)` to open the note page
3. `browser_snapshot` → save to file
4. Run:
   ```bash
   cat snapshot.json | node scripts/parse-snapshot.js "Author Name" YYYY-MM-DD
   ```
5. Run `node scripts/crawl-coda.js mark-done "Author Name" YYYY-MM-DD`
6. Repeat until `next` returns `{ done: true }`

### Scripts

| Script | Purpose |
|--------|---------|
| `crawl-loop.js` | **Full automated crawl**: index → extract pages → visit each note → parse → mark done |
| `run-crawl.js` | Entry point: INDEX (extract) or NOTE (parse + mark-done) based on args |
| `parse-snapshot.js` | Read snapshot from stdin, extract content, write markdown |
| `extract-page-list.js` | Parse index snapshot → `docs/pages-to-migrate.json` |
| `crawl-coda.js` | State machine: `next`, `mark-done`, `status`, `list` |

### npm scripts

```bash
npm run coda:automate # Full automated crawl (Puppeteer)
npm run coda:crawl    # Run crawl phase (INDEX or NOTE based on args)
npm run coda:next     # Next page to migrate
npm run coda:status   # Progress summary
npm run coda:list     # All pages with done status
```

### run-crawl.js

Single entry point for crawl phases:

- **INDEX** (1 arg): `npm run coda:crawl -- docs/snapshot-index.yaml` → extracts page list, outputs "Index extracted. Run crawl loop."
- **NOTE** (3 args): `npm run coda:crawl -- snapshot.yaml "Author" YYYY-MM-DD` → parses snapshot, writes markdown, marks done

## Manual Process (fallback)

1. Open [Huddle Notes by Author and Date](https://coda.io/d/100Devs-Huddle-Notes_dRH5Faq2FwO/Huddle-Notes-by-Author-and-Date_su6WnUKK)
2. For each page link (Author + Date):
   - Click to open the page
   - Select all content (Cmd+A), copy (Cmd+C)
   - Paste into a temp file or run:
     ```bash
     # Paste content, then Ctrl+D to end stdin
     node scripts/migrate-from-coda.js "Author Name" YYYY-MM-DD
     ```
   - Or with a file:
     ```bash
     node scripts/migrate-from-coda.js "Author Name" YYYY-MM-DD /path/to/pasted.txt
     ```
3. Add new contributors to `contributors.json` when you have their GitHub username
4. Run `npm run build` to verify
5. Commit and push

## Date format

The `parse-coda-date` utility converts Coda labels to `YYYY-MM-DD`:

| Coda format | Result |
|-------------|--------|
| Fri 2/27/26 | 2026-02-27 |
| Tues 2/24/26 | 2026-02-24 |
| Tuesday 3.3.2026 | 2026-03-03 |
| Friday 28.2.2026 | 2026-02-28 |
| 10/21/2025 | 2025-10-21 |
| 9/19/2025 | 2025-09-19 |

Labels may have trailing text (e.g. "Fri 12/9/25 Memory Dump") — only the date part is parsed.

## Contributors

After adding notes, map GitHub usernames in `contributors.json` so future PRs cluster correctly.
