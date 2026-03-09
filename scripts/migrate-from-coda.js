#!/usr/bin/env node
/**
 * Migrate Coda notes to markdown.
 * Usage: node scripts/migrate-from-coda.js <author> <date-YYYY-MM-DD> [content-file]
 *   Or pipe content: cat content.txt | node scripts/migrate-from-coda.js "Michael Govaerts" 2026-02-27
 *
 * Creates notes/huddle-YYYY-MM-DD-authorslug.md
 */

const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, '..', 'notes');

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node migrate-from-coda.js <author> <date-YYYY-MM-DD> [content-file]');
    console.error('  Or: cat content.txt | node migrate-from-coda.js "Author Name" 2026-02-27');
    process.exit(1);
  }

  const author = args[0];
  const date = args[1];
  const contentFile = args[2];

  let body;
  if (contentFile) {
    body = fs.readFileSync(contentFile, 'utf8');
  } else if (!process.stdin.isTTY) {
    body = fs.readFileSync(0, 'utf8');
  } else {
    console.error('Provide content via file or stdin');
    process.exit(1);
  }

  const authorSlug = slugify(author);
  const filename = `huddle-${date}-${authorSlug}.md`;
  const filepath = path.join(NOTES_DIR, filename);

  const frontmatter = `---
lesson: 0
tags:
  - the-hunt
author: ${author}
date: ${date}
---

`;

  const content = frontmatter + body.trim() + '\n';
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`Created ${filepath}`);
}

main();
