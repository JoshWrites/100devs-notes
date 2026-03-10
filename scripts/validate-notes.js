#!/usr/bin/env node
/**
 * Validates note files changed in a PR.
 * Usage: node validate-notes.js <base-sha> <head-sha>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..');
const VALID_TAGS = new Set([
  'the-hunt', 'resume', 'networking', 'interview', 'freelance',
  'salary', 'technical', 'portfolio', 'mindset', 'branding',
]);

const [baseSha, headSha] = process.argv.slice(2);

if (!baseSha || !headSha) {
  console.error('Usage: validate-notes.js <base-sha> <head-sha>');
  process.exit(1);
}

const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=AM', baseSha, headSha], {
  cwd: REPO_ROOT, encoding: 'utf8',
});
const changedFiles = diff.stdout.trim().split('\n').filter(f => f.startsWith('notes/') && f.endsWith('.md'));

if (changedFiles.length === 0) {
  console.log('No note files changed.');
  process.exit(0);
}

let errors = 0;

for (const file of changedFiles) {
  const filePath = path.join(REPO_ROOT, file);
  const parts = file.split('/'); // ['notes', 'author-slug', 'YYYY-MM-DD.md']

  if (parts.length !== 3) {
    console.error(`❌ ${file}: must be in notes/{author-slug}/YYYY-MM-DD.md format`);
    errors++;
    continue;
  }

  const filenameDate = parts[2].replace('.md', '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filenameDate)) {
    console.error(`❌ ${file}: filename must be YYYY-MM-DD.md`);
    errors++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    console.error(`❌ ${file}: missing frontmatter block`);
    errors++;
    continue;
  }

  let fm;
  try {
    fm = yaml.load(match[1]) || {};
  } catch (e) {
    console.error(`❌ ${file}: invalid YAML in frontmatter — ${e.message}`);
    errors++;
    continue;
  }

  if (!fm.author || !String(fm.author).trim()) {
    console.error(`❌ ${file}: frontmatter missing required field: author`);
    errors++;
  }

  if (!fm.date) {
    console.error(`❌ ${file}: frontmatter missing required field: date`);
    errors++;
  } else if (String(fm.date) !== filenameDate) {
    console.error(`❌ ${file}: frontmatter date (${fm.date}) does not match filename (${filenameDate})`);
    errors++;
  }

  if (!fm.tags || !Array.isArray(fm.tags) || fm.tags.length === 0) {
    console.error(`❌ ${file}: frontmatter missing required field: tags`);
    errors++;
  } else {
    const invalidTags = fm.tags.filter(t => !VALID_TAGS.has(t));
    if (invalidTags.length > 0) {
      console.error(`❌ ${file}: unrecognized tags: ${invalidTags.join(', ')} — propose new tags in the PR description`);
      errors++;
    }
    if (fm.tags.length > 4) {
      console.error(`❌ ${file}: too many tags (max 4, got ${fm.tags.length})`);
      errors++;
    }
  }

  const body = match[2].trim();
  if (body.length < 20) {
    console.error(`❌ ${file}: note body appears empty or too short`);
    errors++;
  }

  if (errors === 0 || !changedFiles.slice(0, changedFiles.indexOf(file) + 1).some(() => true)) {
    console.log(`✓ ${file}`);
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found. Please fix before merging.`);
  process.exit(1);
} else {
  console.log(`\nAll ${changedFiles.length} note(s) valid.`);
}
