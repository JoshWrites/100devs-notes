#!/usr/bin/env node
/**
 * Extract page list from "Huddle Notes by Author and Date" browser snapshot.
 * Parses table structure: each row has Author (from link text) and Date links.
 * Outputs JSON: [{author, date, codaLabel, linkRef}, ...]
 *
 * Usage: cat snapshot.json | node scripts/extract-page-list.js [--stdout] [--merge]
 *   Or:  node scripts/extract-page-list.js <path-to-snapshot> [--stdout] [--merge]
 *
 * Writes to docs/pages-to-migrate.json (or stdout with --stdout)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parseCodaDate } = require('./lib/parse-coda-date.js');

const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'pages-to-migrate.json');

// Map LinkedIn/linktr.ee URLs to author names
const KNOWN_AUTHORS = {
  'annylevine': 'Anny Levine',
  'michaelgovaerts': 'Michael Govaerts',
  'jess_stpierre': 'Jess St Pierre'
};

/**
 * Extract author from text. Handles LinkedIn/linktr.ee URLs and display names.
 */
function extractAuthorFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  // LinkedIn: https://www.linkedin.com/in/annylevine
  const liMatch = t.match(/linkedin\.com\/in\/([^/?]+)/i);
  if (liMatch) return KNOWN_AUTHORS[liMatch[1].toLowerCase()] || toTitleCase(liMatch[1]);
  // linktr.ee: https://linktr.ee/jess_stpierre
  const ltMatch = t.match(/linktr\.ee\/([^/?]+)/i);
  if (ltMatch) return KNOWN_AUTHORS[ltMatch[1].toLowerCase()] || toTitleCase(ltMatch[1]);
  // Skip if it looks like a date or plain URL
  if (parseCodaDate(t)) return null;
  if (/^https?:\/\//.test(t)) return null;
  if (/^\d{1,2}[\/\.]\d{1,2}/.test(t)) return null;
  if (t.length < 2 || t.length > 80) return null;
  return t;
}

/**
 * Extract author from a link node. Browser snapshot may put URL in name, url, href, or description.
 * Document order: author link (LinkedIn) then date links. Each date uses the most recent author.
 */
function extractAuthorFromLink(link) {
  if (!link) return null;
  const candidates = [
    link.name,
    link.url,
    link.href,
    link.description,
    link.value
  ].filter(Boolean).map(s => String(s).trim());
  for (const c of candidates) {
    const a = extractAuthorFromText(c);
    if (a) return a;
  }
  return null;
}

function toTitleCase(s) {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function parseInput(input) {
  let trimmed = input.trim();
  if (!trimmed) return null;
  // Unwrap MCP-style response
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const inner = parsed.content ?? parsed.text ?? parsed.snapshot ?? parsed;
      if (inner !== parsed && typeof inner === 'object') return normalizeTree(inner);
      if (inner !== parsed && typeof inner === 'string') trimmed = inner;
    } catch {
      // fall through
    }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return normalizeTree(JSON.parse(trimmed));
    } catch {
      // fall through to YAML
    }
  }
  try {
    const parsed = yaml.load(trimmed);
    return normalizeTree(parsed);
  } catch {
    return null;
  }
}

/**
 * Normalize browser snapshot tree. cursor-ide-browser may return:
 * - A single root node with children (links in document order: author then dates)
 * - Wrapped structure: { content/text/snapshot: tree }
 * - Array with one element
 */
function normalizeTree(obj) {
  if (!obj) return null;
  const arr = Array.isArray(obj) ? obj : [obj];
  const first = arr[0];
  if (first && (first.children || first.role)) return first;
  return first;
}

/**
 * Recursively find all nodes with role and optional name match.
 */
function findNodes(node, predicate, acc = []) {
  if (!node) return acc;
  if (predicate(node)) acc.push(node);
  const children = node.children || [];
  for (const child of children) {
    findNodes(child, predicate, acc);
  }
  return acc;
}

/**
 * Get ref from node (cursor-ide-browser may use ref, id, or similar)
 */
function getRef(node) {
  return node.ref || node.id || node.elementRef || null;
}

/**
 * Get URL from link node when available (url, href, value).
 * Returns the URL if it looks like a Coda doc page link.
 */
function getUrlFromLink(link) {
  if (!link) return null;
  const candidates = [link.url, link.href, link.value].filter(Boolean).map(s => String(s).trim());
  for (const c of candidates) {
    if (c && /^https?:\/\//.test(c) && c.includes('coda.io')) return c;
  }
  return null;
}

/**
 * Extract pages from snapshot. Handles:
 * - Table with rows: Author | Date1 | Date2 | ...
 * - Document-order: author link followed by date links
 */
function extractPages(tree) {
  const pages = [];

  // Strategy 1: Row-based (table structure)
  const rows = findNodes(tree, n => (n.role || '').toLowerCase() === 'row');
  if (rows.length > 0) {
    for (const row of rows) {
      const cells = (row.children || []).filter(c =>
        ['cell', 'columnheader', 'rowheader', 'gridcell'].includes((c.role || '').toLowerCase())
      );
      let rowAuthor = null;
      for (const cell of cells) {
        const cellLinks = findNodes(cell, n => (n.role || '').toLowerCase() === 'link');
        for (const cl of cellLinks) {
          const name = (cl.name || '').trim();
          const date = parseCodaDate(name);
          if (date) {
            const page = {
              author: rowAuthor || 'Unknown',
              date,
              codaLabel: name,
              linkRef: getRef(cl),
              done: false
            };
            const url = getUrlFromLink(cl);
            if (url) page.url = url;
            pages.push(page);
          } else {
            const a = extractAuthorFromLink(cl);
            if (a) rowAuthor = a;
          }
        }
      }
    }
    return pages;
  }

  // Strategy 2: Flat link list - use findAuthorForLink for row context, else document order
  const links = findNodes(tree, n => (n.role || '').toLowerCase() === 'link');
  let currentAuthor = null;

  for (const link of links) {
    const name = (link.name || '').trim();
    const date = parseCodaDate(name);
    if (date) {
      const author = findAuthorForLink(link, tree) || currentAuthor || 'Unknown';
      const page = { author, date, codaLabel: name, linkRef: getRef(link), done: false };
      const url = getUrlFromLink(link);
      if (url) page.url = url;
      pages.push(page);
    } else {
      const a = extractAuthorFromLink(link);
      if (a) currentAuthor = a;
    }
  }

  return pages;
}

function findAuthorForLink(linkNode, tree) {
  const pathToLink = [];
  function search(root, target) {
    if (root === target) {
      pathToLink.push(root);
      return true;
    }
    const children = root.children || [];
    for (const c of children) {
      if (search(c, target)) {
        pathToLink.unshift(root);
        return true;
      }
    }
    return false;
  }
  search(tree, linkNode);

  for (let i = pathToLink.length - 1; i >= 0; i--) {
    const n = pathToLink[i];
    if ((n.role || '').toLowerCase() === 'row') {
      const cells = (n.children || []).filter(c =>
        ['cell', 'columnheader', 'rowheader'].includes((c.role || '').toLowerCase())
      );
      for (const cell of cells) {
        const links = findNodes(cell, x => (x.role || '').toLowerCase() === 'link');
        for (const l of links) {
          const name = (l.name || '').trim();
          if (!parseCodaDate(name)) {
            const a = extractAuthorFromLink(l);
            if (a) return a;
          }
        }
      }
      break;
    }
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const stdoutOnly = args.includes('--stdout');
  const merge = args.includes('--merge');
  const fileArgs = args.filter(a => a !== '--stdout' && a !== '--merge');

  let input;
  if (fileArgs.length > 0) {
    const filePath = path.resolve(fileArgs[0]);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    input = fs.readFileSync(filePath, 'utf8');
  } else if (!process.stdin.isTTY) {
    input = fs.readFileSync(0, 'utf8');
  } else {
    console.error('Usage: cat snapshot.json | node extract-page-list.js [--stdout] [--merge]');
    console.error('   Or: node extract-page-list.js <path-to-snapshot> [--stdout] [--merge]');
    process.exit(1);
  }

  const tree = parseInput(input);
  if (!tree) {
    console.error('Failed to parse JSON snapshot');
    process.exit(1);
  }

  let pages = extractPages(tree);

  if (merge && fs.existsSync(OUTPUT_PATH)) {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    const key = p => `${p.author}|${p.date}`;
    const existingMap = new Map(existing.map(p => [key(p), p]));
    pages = pages.map(p => {
      const k = key(p);
      const prev = existingMap.get(k);
      if (!prev) return p;
      return { ...p, done: prev.done, url: p.url || prev.url };
    });
  }

  const output = JSON.stringify(pages, null, 2);

  if (stdoutOnly) {
    console.log(output);
  } else {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log(`Wrote ${pages.length} pages to ${OUTPUT_PATH}`);
  }
}

main();
