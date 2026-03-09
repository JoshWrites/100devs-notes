#!/usr/bin/env node
/**
 * Reorganize flat notes into author/date structure.
 * Reads frontmatter from each note, moves to notes/{author-slug}/{date}.md
 *
 * Usage: node scripts/reorganize-by-author.js
 */

const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, '..', 'notes');

function slugify(str) {
  return (str || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const fm = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter: fm, body: match[2] };
}

function main() {
  if (!fs.existsSync(NOTES_DIR)) {
    console.error('Notes dir not found');
    process.exit(1);
  }

  const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.md'));
  let moved = 0;

  for (const file of files) {
    const srcPath = path.join(NOTES_DIR, file);
    const content = fs.readFileSync(srcPath, 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      console.warn(`Skipping ${file} (no frontmatter)`);
      continue;
    }

    const author = parsed.frontmatter.author || 'Unknown';
    const date = parsed.frontmatter.date;
    if (!date) {
      console.warn(`Skipping ${file} (no date)`);
      continue;
    }

    const authorSlug = slugify(author);
    const dir = path.join(NOTES_DIR, authorSlug);
    const destPath = path.join(dir, `${date}.md`);

    if (srcPath === destPath) continue;
    if (fs.existsSync(destPath)) {
      console.warn(`Target exists, skipping: ${destPath}`);
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(srcPath, destPath);
    console.log(`${file} → ${authorSlug}/${date}.md`);
    moved++;
  }

  console.log(`Moved ${moved} notes`);
}

main();
