#!/usr/bin/env node
/**
 * Coda migration orchestration for Cursor agent.
 * State machine that tracks progress and outputs next page to visit.
 *
 * The agent workflow:
 * 1. Navigate to Huddle Notes by Author and Date
 * 2. browser_snapshot -> pipe to extract-page-list.js (builds/updates pages-to-migrate.json)
 * 3. node crawl-coda.js next -> get { author, date, linkRef } for next undone page
 * 4. browser_click(linkRef) to open note page
 * 5. browser_snapshot -> pipe to parse-snapshot.js "Author" YYYY-MM-DD
 * 6. node crawl-coda.js mark-done "Author" YYYY-MM-DD
 * 7. Repeat from step 3 until no more pages
 *
 * Commands:
 *   next         - Output next page to migrate (JSON to stdout)
 *   mark-done    - Mark page as done: mark-done "Author" YYYY-MM-DD
 *   status       - Show progress summary
 *   list         - List all pages with done status
 */

const fs = require('fs');
const path = require('path');

const PAGES_FILE = path.join(__dirname, '..', 'docs', 'pages-to-migrate.json');
const INDEX_URL = 'https://coda.io/d/100Devs-Huddle-Notes_dRH5Faq2FwO/Huddle-Notes-by-Author-and-Date_su6WnUKK';

function loadPages() {
  if (!fs.existsSync(PAGES_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8'));
}

function savePages(pages) {
  fs.mkdirSync(path.dirname(PAGES_FILE), { recursive: true });
  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2), 'utf8');
}

function cmdNext() {
  const pages = loadPages();
  const undone = pages.filter(p => !p.done);
  if (undone.length === 0) {
    console.log(JSON.stringify({ done: true, message: 'All pages migrated' }));
    return;
  }
  const next = undone[0];
  console.log(JSON.stringify({
    done: false,
    indexUrl: INDEX_URL,
    author: next.author,
    date: next.date,
    codaLabel: next.codaLabel,
    linkRef: next.linkRef,
    remaining: undone.length,
    hint: next.linkRef
      ? 'Click the link with browser_click using linkRef, then snapshot and run: cat snapshot.json | node scripts/parse-snapshot.js "' + next.author + '" ' + next.date
      : 'Navigate to the note page, snapshot, then run: cat snapshot.json | node scripts/parse-snapshot.js "' + next.author + '" ' + next.date
  }));
}

function cmdMarkDone(author, date) {
  const pages = loadPages();
  const idx = pages.findIndex(p =>
    p.author === author && p.date === date
  );
  if (idx === -1) {
    console.error(`Page not found: ${author} ${date}`);
    process.exit(1);
  }
  pages[idx].done = true;
  savePages(pages);
  console.log(`Marked done: ${author} ${date}`);
}

function cmdStatus() {
  const pages = loadPages();
  const done = pages.filter(p => p.done).length;
  const total = pages.length;
  console.log(`Progress: ${done}/${total} (${total - done} remaining)`);
  if (total > 0 && done < total) {
    const next = pages.find(p => !p.done);
    console.log(`Next: ${next.author} - ${next.date} (${next.codaLabel})`);
  }
}

function cmdList() {
  const pages = loadPages();
  for (const p of pages) {
    const status = p.done ? '✓' : ' ';
    console.log(`[${status}] ${p.author} | ${p.date} | ${p.codaLabel}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'next':
      cmdNext();
      break;
    case 'mark-done':
      if (args.length < 3) {
        console.error('Usage: crawl-coda.js mark-done "Author" YYYY-MM-DD');
        process.exit(1);
      }
      cmdMarkDone(args[1], args[2]);
      break;
    case 'status':
      cmdStatus();
      break;
    case 'list':
      cmdList();
      break;
    default:
      console.error('Usage: crawl-coda.js <next|mark-done|status|list> [args]');
      console.error('');
      console.error('  next              - Output next page to migrate (JSON)');
      console.error('  mark-done A D     - Mark author/date as done');
      console.error('  status            - Show progress');
      console.error('  list              - List all pages');
      process.exit(1);
  }
}

main();
