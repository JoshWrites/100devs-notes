#!/usr/bin/env node
/**
 * Full automated crawl of Coda Huddle Notes using Puppeteer.
 *
 * Flow:
 * 1. Launch Puppeteer, navigate to index
 * 2. Extract author labels (text spans "by X") + date links (a.href) from DOM
 * 3. Sort by vertical position to get document order, assign authors to dates
 * 4. For each undone page: page.goto(url), accessibility snapshot, parse-snapshot, mark-done
 *
 * Author formats on the Coda page:
 *   - Plain text: "by choir241 (Richard)", "by Ashton (class 10)"
 *   - Text with link: "by Anny Levine (https://linkedin.com/in/annylevine)"
 *   - LinkedIn/linktr.ee links rendered inline
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer');

const PAGES_FILE = path.join(__dirname, '..', 'docs', 'pages-to-migrate.json');
const INDEX_URL = 'https://coda.io/d/100Devs-Huddle-Notes_dRH5Faq2FwO/Huddle-Notes-by-Author-and-Date_su6WnUKK';
const CODA_DOC_SLUG = '_dRH5Faq2FwO';

const { parseCodaDate } = require('./lib/parse-coda-date.js');

const KNOWN_AUTHORS = {
  annylevine: 'Anny Levine',
  michaelgovaerts: 'Michael Govaerts',
  jess_stpierre: 'Jess St Pierre'
};

function loadPages() {
  if (!fs.existsSync(PAGES_FILE)) return [];
  return JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8'));
}

function savePages(pages) {
  fs.mkdirSync(path.dirname(PAGES_FILE), { recursive: true });
  fs.writeFileSync(PAGES_FILE, JSON.stringify(pages, null, 2), 'utf8');
}

/**
 * Extract ordered items from the Coda page DOM.
 * Combines text-node author labels with link hrefs, sorted by position.
 */
async function extractItemsFromIndex(page) {
  return page.evaluate((codaDocSlug, indexUrl, knownAuthors) => {
    const items = [];

    function resolveAuthor(text) {
      const li = text.match(/linkedin\.com\/in\/([^/?]+)/i);
      if (li) {
        const slug = li[1].toLowerCase();
        return knownAuthors[slug] || slug.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      const lt = text.match(/linktr\.ee\/([^/?]+)/i);
      if (lt) {
        const slug = lt[1].toLowerCase();
        return knownAuthors[slug] || slug.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
      return null;
    }

    // 1. Find "by X" text in spans (covers plain-text authors)
    document.querySelectorAll('span').forEach(s => {
      const t = s.textContent.trim();
      if (!/^by\s+/i.test(t)) return;
      const rect = s.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;
      let author = t.replace(/^by\s+/i, '').trim();
      author = author.replace(/\s*\(https?:\/\/[^)]+\)\s*$/, '').trim();
      if (author) {
        items.push({ type: 'author', value: author, top: rect.top });
      }
    });

    // 2. Find LinkedIn/linktr.ee links (covers linked authors)
    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      const resolved = resolveAuthor(href);
      if (!resolved) return;
      const rect = a.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;
      items.push({ type: 'author', value: resolved, top: rect.top });
    });

    // 3. Find date-page links in content area
    //    Coda links have empty textContent; the label is in a nearby text node.
    //    We match all <a> whose href property contains the doc slug.
    //    Then look at the closest parent's text for the date label.
    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      if (!href.includes(codaDocSlug)) return;
      if (href.includes('Huddle-Notes-by-Author-and-Date')) return;
      const rect = a.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;

      // Dedupe: only take content-area links (skip sidebar duplicates).
      // Content links have left > 200px typically; sidebar links are narrower.
      // More robust: check if inside the sidebar list element.
      const inSidebar = !!a.closest('[class*="pageList"], [class*="sidebar"], [role="navigation"], nav');
      if (inSidebar) return;

      let label = a.innerText.trim() || a.textContent.trim();
      if (!label) {
        const parent = a.closest('div, span, td, li');
        if (parent) label = parent.innerText.trim();
      }
      if (label) {
        items.push({ type: 'dateLink', value: label, href, top: rect.top });
      }
    });

    // Sort by vertical position
    items.sort((a, b) => a.top - b.top);

    // Deduplicate authors at same position
    const deduped = [];
    let lastAuthor = null;
    let lastTop = -1;
    for (const item of items) {
      if (item.type === 'author') {
        if (Math.abs(item.top - lastTop) < 5 && item.value === lastAuthor) continue;
        lastAuthor = item.value;
        lastTop = item.top;
      }
      deduped.push(item);
    }
    return deduped;
  }, CODA_DOC_SLUG, INDEX_URL, KNOWN_AUTHORS);
}

async function extractPagesFromIndex(page) {
  const items = await extractItemsFromIndex(page);

  const authors = items.filter(i => i.type === 'author');
  const dates = items.filter(i => i.type === 'dateLink');
  console.log(`  Found ${authors.length} authors: ${authors.map(a => a.value).join(', ')}`);
  console.log(`  Found ${dates.length} date links`);

  const pages = [];
  const seen = new Set();
  let currentAuthor = null;

  for (const item of items) {
    if (item.type === 'author') {
      currentAuthor = item.value;
      continue;
    }
    if (item.type === 'dateLink') {
      const date = parseCodaDate(item.value);
      if (!date) {
        console.warn(`  Could not parse date: "${item.value}"`);
        continue;
      }
      const author = currentAuthor || 'Unknown';
      const key = `${author}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push({
        author,
        date,
        codaLabel: item.value,
        url: item.href,
        done: false
      });
    }
  }
  return pages;
}

function mergePages(newPages) {
  const existing = loadPages();
  const key = (p) => `${p.author}|${p.date}`;
  const existingMap = new Map(existing.map((p) => [key(p), p]));
  return newPages.map((p) => {
    const prev = existingMap.get(key(p));
    if (!prev) return p;
    return { ...p, done: prev.done, url: p.url || prev.url };
  });
}

function runParseSnapshot(author, date, snapshotJson) {
  const result = spawnSync(
    'node',
    [path.join(__dirname, 'parse-snapshot.js'), author, date],
    { input: snapshotJson, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] }
  );
  return result.status === 0;
}

function runMarkDone(author, date) {
  const result = spawnSync(
    'node',
    [path.join(__dirname, 'crawl-coda.js'), 'mark-done', author, date],
    { encoding: 'utf8', stdio: 'inherit' }
  );
  return result.status === 0;
}

async function main() {
  const headless = !process.env.CODA_HEADED;
  console.log(`Launching browser (headless: ${headless})...`);
  const browser = await puppeteer.launch({
    headless,
    args: headless ? ['--no-sandbox'] : []
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);

    console.log('Loading index...');
    await page.goto(INDEX_URL, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 8000));

    // Scroll to bottom to ensure all content is rendered
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 1000));

    const newPages = await extractPagesFromIndex(page);
    console.log(`Extracted ${newPages.length} pages from index`);

    if (newPages.length === 0) {
      console.error('No pages found! Coda may require login. Try: CODA_HEADED=1 npm run coda:automate');
      return;
    }

    const pages = mergePages(newPages);
    savePages(pages);

    const undone = pages.filter((p) => !p.done);
    if (undone.length === 0) {
      console.log('All pages already migrated.');
      return;
    }

    console.log(`\nProcessing ${undone.length} remaining pages...`);

    for (const p of undone) {
      if (!p.url) {
        console.warn(`Skipping ${p.author} ${p.date} - no URL`);
        continue;
      }

      console.log(`\n→ ${p.author} | ${p.date} (${p.codaLabel})`);

      await page.goto(p.url, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 2000));

      const snapshot = await page.accessibility.snapshot();
      const snapshotJson = JSON.stringify(snapshot, null, 2);

      if (!runParseSnapshot(p.author, p.date, snapshotJson)) {
        console.error(`  ✗ parse-snapshot failed`);
        continue;
      }

      if (!runMarkDone(p.author, p.date)) {
        console.error(`  ✗ mark-done failed`);
        continue;
      }

      console.log(`  ✓ Done`);
    }

    console.log('\nCrawl complete.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
