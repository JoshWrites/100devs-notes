#!/usr/bin/env node
/**
 * Re-crawl all notes from Coda with proper formatting.
 *
 * Instead of accessibility snapshots (which lose all formatting),
 * this script extracts the rendered HTML from the Coda page's
 * content area and converts it to markdown using Turndown.
 *
 * Always runs headed so you can watch for CAPTCHAs or login prompts.
 *
 * Usage:
 *   CODA_HEADED=1 node scripts/recrawl-formatted.js          # all notes
 *   CODA_HEADED=1 node scripts/recrawl-formatted.js --errors  # only error notes
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const TurndownService = require('turndown');

const NOTES_DIR = path.join(__dirname, '..', 'notes');
const PAGES_FILE = path.join(__dirname, '..', 'docs', 'pages-to-migrate.json');
const INDEX_URL = 'https://coda.io/d/100Devs-Huddle-Notes_dRH5Faq2FwO/Huddle-Notes-by-Author-and-Date_su6WnUKK';
const CODA_DOC_SLUG = '_dRH5Faq2FwO';

const { parseCodaDate } = require('./lib/parse-coda-date.js');

const KNOWN_AUTHORS = {
  annylevine: 'Anny Levine',
  michaelgovaerts: 'Michael Govaerts',
  jess_stpierre: 'Jess St Pierre'
};

const DELAY_BETWEEN_PAGES_MS = 8000;

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});

turndown.addRule('removeEmptyLinks', {
  filter: (node) => node.nodeName === 'A' && !node.textContent.trim(),
  replacement: () => '',
});

turndown.addRule('skipImages', {
  filter: 'img',
  replacement: () => '',
});

function slugify(str) {
  return (str || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function inferTags(body) {
  const lower = body.toLowerCase();
  const TAG_RULES = [
    { tag: 'networking', keywords: ['networking', 'network', 'coffee chat', 'cold outreach', 'linkedin profile', 'connect with', 'reach out', 'informational interview', 'meetup', 'tech event', 'connection request'], weight: 2 },
    { tag: 'interview', keywords: ['interview', 'behavioral question', 'star method', 'technical interview', 'whiteboard', 'coding challenge', 'mock interview', 'phone screen', 'hiring manager', 'interview prep', 'tell me about yourself'], weight: 2 },
    { tag: 'resume', keywords: ['resume', 'cv ', 'cover letter', 'application', 'job board', 'apply', 'applying', 'ats ', 'applicant tracking', 'job posting', 'tailor your resume', 'work experience'], weight: 2 },
    { tag: 'freelance', keywords: ['freelance', 'freelancing', 'client', 'evergreen client', 'agency', 'contract', 'invoice', 'upwork', 'fiverr', 'retainer', 'proposal', 'scope of work', 'pricing'], weight: 2 },
    { tag: 'portfolio', keywords: ['portfolio', '100 hours', '100hours', 'hundred hours', 'project showcase', 'personal site', 'personal website', 'github profile', 'deploy', 'case study'], weight: 2 },
    { tag: 'mindset', keywords: ['mindset', 'imposter syndrome', 'motivation', 'burnout', 'mental health', 'self care', 'self-care', 'growth mindset', 'embrace the struggle', 'keep going', 'believe in yourself', 'accountability', 'discipline', 'overwhelm', 'patience'], weight: 2 },
    { tag: 'salary', keywords: ['salary', 'negotiat', 'compensation', 'offer letter', 'equity', 'stock option', 'benefits', 'base pay', 'total comp', 'counter offer', 'pay range', 'market rate'], weight: 2 },
    { tag: 'technical', keywords: ['javascript', 'react', 'node.js', 'nodejs', 'express', 'css', 'html', 'typescript', 'python', 'api ', 'database', 'sql', 'mongodb', 'git ', 'github', 'deployment', 'aws', 'docker', 'algorithm', 'data structure', 'leetcode', 'full stack', 'frontend', 'backend'], weight: 1 },
  ];

  const scores = TAG_RULES.map(rule => {
    const hits = rule.keywords.filter(k => lower.includes(k)).length;
    return { tag: rule.tag, hits, threshold: rule.weight };
  }).filter(s => s.hits >= s.threshold);

  scores.sort((a, b) => b.hits - a.hits);
  const topTags = scores.slice(0, 3).map(s => s.tag);
  return ['the-hunt', ...topTags.filter(t => t !== 'the-hunt')];
}

async function extractItemsFromIndex(page) {
  return page.evaluate((codaDocSlug, knownAuthors) => {
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

    document.querySelectorAll('span').forEach(s => {
      const t = s.textContent.trim();
      if (!/^by\s+/i.test(t)) return;
      const rect = s.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;
      let author = t.replace(/^by\s+/i, '').trim();
      author = author.replace(/\s*\(https?:\/\/[^)]+\)\s*$/, '').trim();
      if (author) items.push({ type: 'author', value: author, top: rect.top });
    });

    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      const resolved = resolveAuthor(href);
      if (!resolved) return;
      const rect = a.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;
      items.push({ type: 'author', value: resolved, top: rect.top });
    });

    document.querySelectorAll('a').forEach(a => {
      const href = a.href || '';
      if (!href.includes(codaDocSlug)) return;
      if (href.includes('Huddle-Notes-by-Author-and-Date')) return;
      const rect = a.getBoundingClientRect();
      if (rect.top === 0 && rect.height === 0) return;
      const inSidebar = !!a.closest('[class*="pageList"], [class*="sidebar"], [role="navigation"], nav');
      if (inSidebar) return;

      let label = a.innerText.trim() || a.textContent.trim();
      if (!label) {
        const parent = a.closest('div, span, td, li');
        if (parent) label = parent.innerText.trim();
      }
      if (label) items.push({ type: 'dateLink', value: label, href, top: rect.top });
    });

    items.sort((a, b) => a.top - b.top);

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
  }, CODA_DOC_SLUG, KNOWN_AUTHORS);
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
    if (item.type === 'author') { currentAuthor = item.value; continue; }
    if (item.type === 'dateLink') {
      const date = parseCodaDate(item.value);
      if (!date) { console.warn(`  Could not parse date: "${item.value}"`); continue; }
      const author = currentAuthor || 'Unknown';
      const key = `${author}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push({ author, date, codaLabel: item.value, url: item.href });
    }
  }
  return pages;
}

/**
 * Scroll the Coda content area to ensure lazy-loaded content is rendered.
 */
async function scrollToLoadAll(page) {
  await page.evaluate(async () => {
    const container = document.querySelector('[data-coda-ui-id="canvas-content-container"]') || document.documentElement;
    const step = 500;
    let pos = 0;
    const max = container.scrollHeight || document.body.scrollHeight;
    while (pos < max) {
      pos += step;
      container.scrollTop = pos;
      await new Promise(r => setTimeout(r, 200));
    }
    container.scrollTop = 0;
  });
  await sleep(1000);
}

/**
 * Extract the main note content HTML from a Coda page.
 * Uses [data-coda-ui-id="editable"] which contains the actual note content.
 */
async function extractContentHtml(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || '';
    if (bodyText.includes('Too Many Requests') || bodyText.includes('Error - Coda')) {
      return { error: 'rate-limited', html: '' };
    }

    // Primary: Coda's editable content area
    const editable = document.querySelector('[data-coda-ui-id="editable"]');
    if (editable && editable.innerHTML.length > 100) {
      return { error: null, html: editable.innerHTML };
    }

    // Fallback: canvas area minus the header
    const canvas = document.querySelector('[data-coda-ui-id="canvas"]');
    if (canvas) {
      const clone = canvas.cloneNode(true);
      const header = clone.querySelector('[data-coda-ui-id="canvasHeader"]');
      if (header) header.remove();
      return { error: null, html: clone.innerHTML };
    }

    // Last resort: body minus chrome
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('[data-coda-ui-id="sectionList"], [data-coda-ui-id="docTitleBar"], nav, [role="navigation"], script, style').forEach(el => el.remove());
    return { error: null, html: clone.innerHTML };
  });
}

/**
 * Convert HTML to clean markdown, stripping Coda UI chrome.
 */
function htmlToMarkdown(html) {
  let md = turndown.turndownify ? turndown.turndownify(html) : turndown.turndown(html);

  const chromePatterns = [
    /^100Devs Huddle Notes\n*/m,
    /^Skip to content\n*/m,
    /^Page list\n*/m,
    /^Copy link to this page\n*/m,
    /^All docs\n*/m,
    /^Pages\n*/m,
    /^Show pages\n*/m,
    /^Sign up for free\n*/m,
    /^Doc actions.*\n*/m,
    /^Huddle Notes by Author and Date\n*/m,
    /^Options\n*/gm,
  ];

  for (const pat of chromePatterns) {
    md = md.replace(pat, '');
  }

  // Strip trailing "by Author (linkedin...)" attribution that leaks from Coda
  md = md.replace(/\n*by\s+[\w\s()]+\(\s*\n*\[?https?:\/\/(?:www\.)?linkedin\.com[^\n]*\n*⁠?\n*\)?\s*$/i, '');
  md = md.replace(/\n*by\s+[\w\s()]+\(\s*\n*\[?https?:\/\/(?:www\.)?linktr\.ee[^\n]*\n*⁠?\n*\)?\s*$/i, '');
  // Strip trailing author-only lines (no link)
  md = md.replace(/\n*by\s+[\w\s()]+\s*$/i, '');

  // Remove zero-width spaces
  md = md.replace(/⁠/g, '').replace(/\u2060/g, '');

  // Remove sidebar page list at end of notes
  const sidebarStart = md.search(/\n(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}[\./]\d{1,2}[\./]\d{2,4}/);
  if (sidebarStart > 200) {
    md = md.slice(0, sidebarStart);
  }

  // Clean up excessive whitespace
  md = md.replace(/\n{3,}/g, '\n\n').trim();

  return md;
}

function writeNote(author, date, markdown) {
  const tags = inferTags(markdown);
  const authorSlug = slugify(author);
  const authorDir = path.join(NOTES_DIR, authorSlug);
  const filepath = path.join(authorDir, `${date}.md`);

  const tagYaml = tags.map(t => `  - ${t}`).join('\n');
  const content = `---\ntags:\n${tagYaml}\nauthor: ${author}\ndate: ${date}\n---\n\n${markdown}\n`;

  fs.mkdirSync(authorDir, { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
  return { filepath, tags };
}

function isErrorNote(filepath) {
  if (!fs.existsSync(filepath)) return true;
  const content = fs.readFileSync(filepath, 'utf8');
  return content.includes('Too Many Requests') || content.includes('Error - Coda');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const errorsOnly = process.argv.includes('--errors');
  const headless = !process.env.CODA_HEADED;

  console.log(`Mode: ${errorsOnly ? 'errors only' : 'ALL notes'}`);
  console.log(`Browser: ${headless ? 'headless' : 'headed'}`);
  console.log(`Delay between pages: ${DELAY_BETWEEN_PAGES_MS}ms\n`);

  const browser = await puppeteer.launch({
    headless,
    args: headless ? ['--no-sandbox'] : [],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);

    // Step 1: Load index and extract page list
    console.log('Loading index...');
    await page.goto(INDEX_URL, { waitUntil: 'networkidle2' });
    await sleep(8000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1000);

    const allPages = await extractPagesFromIndex(page);
    console.log(`Extracted ${allPages.length} pages from index\n`);

    if (allPages.length === 0) {
      console.error('No pages found! Try: CODA_HEADED=1 node scripts/recrawl-formatted.js');
      return;
    }

    // Save full page list for reference
    fs.mkdirSync(path.dirname(PAGES_FILE), { recursive: true });
    fs.writeFileSync(PAGES_FILE, JSON.stringify(allPages, null, 2), 'utf8');

    // Step 2: Filter pages to crawl
    let toCrawl;
    if (errorsOnly) {
      toCrawl = allPages.filter(p => {
        const authorSlug = slugify(p.author);
        const filepath = path.join(NOTES_DIR, authorSlug, `${p.date}.md`);
        return isErrorNote(filepath);
      });
      console.log(`Found ${toCrawl.length} error/missing notes to re-crawl\n`);
    } else {
      toCrawl = allPages;
      console.log(`Will re-crawl all ${toCrawl.length} notes\n`);
    }

    // Step 3: Crawl each page
    let success = 0;
    let errors = 0;
    let rateLimited = 0;

    for (let i = 0; i < toCrawl.length; i++) {
      const p = toCrawl[i];
      const progress = `[${i + 1}/${toCrawl.length}]`;

      if (!p.url) {
        console.warn(`${progress} Skipping ${p.author} ${p.date} - no URL`);
        continue;
      }

      console.log(`${progress} ${p.author} | ${p.date}`);

      try {
        await page.goto(p.url, { waitUntil: 'networkidle2' });
        await sleep(3000);
        await scrollToLoadAll(page);

        const { error, html } = await extractContentHtml(page);

        if (error === 'rate-limited') {
          console.log(`  ⚠ Rate limited — waiting 60s then retrying...`);
          rateLimited++;
          await sleep(60000);
          await page.reload({ waitUntil: 'networkidle2' });
          await sleep(3000);
          await scrollToLoadAll(page);
          const retry = await extractContentHtml(page);
          if (retry.error) {
            console.error(`  ✗ Still rate limited after retry`);
            errors++;
            continue;
          }
          const md = htmlToMarkdown(retry.html);
          if (md.length < 50) {
            console.error(`  ✗ Content too short (${md.length} chars)`);
            errors++;
            continue;
          }
          const { filepath, tags } = writeNote(p.author, p.date, md);
          console.log(`  ✓ ${filepath} (${md.length} chars) [${tags.join(', ')}]`);
          success++;
        } else if (!html || html.length < 100) {
          console.error(`  ✗ No content extracted`);
          errors++;
        } else {
          const md = htmlToMarkdown(html);
          if (md.length < 50) {
            console.error(`  ✗ Content too short after cleanup (${md.length} chars)`);
            errors++;
            continue;
          }
          const { filepath, tags } = writeNote(p.author, p.date, md);
          console.log(`  ✓ ${filepath} (${md.length} chars) [${tags.join(', ')}]`);
          success++;
        }
      } catch (err) {
        console.error(`  ✗ Error: ${err.message}`);
        errors++;
      }

      // Rate-limit protection: wait between pages
      if (i < toCrawl.length - 1) {
        await sleep(DELAY_BETWEEN_PAGES_MS);
      }
    }

    console.log(`\n=== Crawl complete ===`);
    console.log(`  Success: ${success}`);
    console.log(`  Errors:  ${errors}`);
    console.log(`  Rate-limited retries: ${rateLimited}`);

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
