#!/usr/bin/env node
/**
 * Bulk import notes from mixed file formats into the notes/ directory.
 *
 * Supported formats: .md, .html, .rtf, .docx
 * All conversions use LibreOffice — must be installed locally.
 * Install on Ubuntu/Debian: sudo apt install libreoffice
 *
 * Usage:
 *   node scripts/import-notes.js --dir ./import-files
 *
 * Reads import/manifest.json for per-file metadata. Any file not listed
 * in the manifest will be skipped with a warning.
 *
 * manifest.json format:
 * {
 *   "filename.rtf": {
 *     "authorSlug": "annylevine",        // folder name under notes/
 *     "author": "Anny Levine",           // display name in frontmatter
 *     "date": "2024-05-21",              // YYYY-MM-DD
 *     "tags": ["the-hunt", "networking"] // from approved tag list
 *   }
 * }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..');
const NOTES_DIR = path.join(REPO_ROOT, 'notes');
const MANIFEST_PATH = path.join(REPO_ROOT, 'import', 'manifest.json');

const VALID_TAGS = new Set([
  'the-hunt', 'resume', 'networking', 'interview', 'freelance',
  'salary', 'technical', 'portfolio', 'mindset', 'branding',
]);

// ── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const importDir = dirFlag !== -1 ? path.resolve(args[dirFlag + 1]) : path.join(REPO_ROOT, 'import');
const dryRun = args.includes('--dry-run');

if (!fs.existsSync(importDir)) {
  console.error(`Import directory not found: ${importDir}`);
  console.error('Create it and add your files, then run again.');
  process.exit(1);
}

// ── Load manifest ─────────────────────────────────────────────────
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`manifest.json not found at ${MANIFEST_PATH}`);
  console.error('See the usage comment at the top of this script.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// ── Conversion helpers ────────────────────────────────────────────

function convertRtfToHtml(rtfPath) {
  // Use LibreOffice headlessly to convert RTF → HTML
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-import-'));
  const result = spawnSync('libreoffice', [
    '--headless',
    '--convert-to', 'html',
    '--outdir', tmpDir,
    rtfPath,
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error('LibreOffice conversion failed: ' + (result.stderr || result.stdout));
  }

  const basename = path.basename(rtfPath, path.extname(rtfPath));
  const htmlPath = path.join(tmpDir, basename + '.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error('LibreOffice did not produce an HTML file at ' + htmlPath);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return html;
}

function convertDocxToHtml(docxPath) {
  // Use LibreOffice headlessly to convert DOCX → HTML
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-import-'));
  const result = spawnSync('libreoffice', [
    '--headless',
    '--convert-to', 'html',
    '--outdir', tmpDir,
    docxPath,
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error('LibreOffice conversion failed: ' + (result.stderr || result.stdout));
  }

  const basename = path.basename(docxPath, path.extname(docxPath));
  const htmlPath = path.join(tmpDir, basename + '.html');
  if (!fs.existsSync(htmlPath)) {
    throw new Error('LibreOffice did not produce an HTML file at ' + htmlPath);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return html;
}

function htmlToMarkdown(html) {
  let TurndownService;
  try {
    TurndownService = require('turndown');
  } catch (e) {
    throw new Error('turndown not installed. Run: npm install');
  }
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  return td.turndown(html);
}

// ── Validate metadata ─────────────────────────────────────────────

function validateMeta(filename, meta) {
  const errors = [];
  if (!meta.authorSlug || !/^[a-z0-9-]+$/.test(meta.authorSlug)) {
    errors.push('authorSlug must be lowercase letters, numbers, and hyphens only');
  }
  if (!meta.author || !meta.author.trim()) {
    errors.push('author (display name) is required');
  }
  if (!meta.date || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
    errors.push('date must be in YYYY-MM-DD format');
  }
  if (!meta.tags || !Array.isArray(meta.tags) || meta.tags.length === 0) {
    errors.push('at least one tag is required');
  } else {
    const invalid = meta.tags.filter(t => !VALID_TAGS.has(t));
    if (invalid.length) errors.push('unrecognized tags: ' + invalid.join(', '));
    if (meta.tags.length > 4) errors.push('max 4 tags allowed');
  }
  return errors;
}

// ── Build frontmatter ─────────────────────────────────────────────

function buildFrontmatter(meta) {
  return [
    '---',
    'tags:',
    ...meta.tags.map(t => '  - ' + t),
    'author: ' + meta.author,
    'date: ' + meta.date,
    '---',
    '',
    '',
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────

function main() {
  const files = fs.readdirSync(importDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.md', '.html', '.rtf', '.docx'].includes(ext);
  });

  if (files.length === 0) {
    console.log('No supported files found in ' + importDir);
    console.log('Supported: .md, .html, .rtf, .docx');
    process.exit(0);
  }

  console.log(`Found ${files.length} file(s) to import.\n`);
  if (dryRun) console.log('DRY RUN — no files will be written.\n');

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const filename of files) {
    const meta = manifest[filename];
    if (!meta) {
      console.warn(`⚠  ${filename}: not in manifest.json — skipping`);
      skipped++;
      continue;
    }

    const metaErrors = validateMeta(filename, meta);
    if (metaErrors.length) {
      console.error(`❌ ${filename}: invalid metadata`);
      metaErrors.forEach(e => console.error('   - ' + e));
      errors++;
      continue;
    }

    const filePath = path.join(importDir, filename);
    const ext = path.extname(filename).toLowerCase();
    let markdown;

    try {
      process.stdout.write(`⟳  ${filename} (${ext}) → `);

      if (ext === '.md') {
        markdown = fs.readFileSync(filePath, 'utf8');
        // Strip existing frontmatter if present, we'll regenerate it
        markdown = markdown.replace(/^---[\s\S]*?---\n+/, '').trim();
        process.stdout.write('pass-through');
      } else if (ext === '.html') {
        const html = fs.readFileSync(filePath, 'utf8');
        markdown = htmlToMarkdown(html).trim();
        process.stdout.write('HTML → Markdown');
      } else if (ext === '.rtf') {
        process.stdout.write('RTF → HTML (LibreOffice) → Markdown');
        const html = convertRtfToHtml(filePath);
        markdown = htmlToMarkdown(html).trim();
      } else if (ext === '.docx') {
        process.stdout.write('DOCX → HTML (LibreOffice) → Markdown');
        const html = convertDocxToHtml(filePath);
        markdown = htmlToMarkdown(html).trim();
      }

      const noteContent = buildFrontmatter(meta) + markdown + '\n';
      const noteDir = path.join(NOTES_DIR, meta.authorSlug);
      const notePath = path.join(noteDir, meta.date + '.md');

      if (!dryRun) {
        fs.mkdirSync(noteDir, { recursive: true });
        fs.writeFileSync(notePath, noteContent, 'utf8');
      }

      console.log(` ✓  → notes/${meta.authorSlug}/${meta.date}.md`);
      imported++;
    } catch (e) {
      console.error(`\n❌ ${filename}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Imported: ${imported}  Skipped: ${skipped}  Errors: ${errors}`);

  if (!dryRun && imported > 0) {
    console.log('\nRunning npm run build to rebuild index.json...');
    const build = spawnSync('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'inherit' });
    if (build.status === 0) {
      console.log('\nDone! Commit the new notes/ and index.json to push them live.');
      console.log('  git add notes/ index.json');
      console.log('  git commit -m "Import notes with corrected attributions"');
      console.log('  git push');
    } else {
      console.error('Build failed. Check the output above.');
    }
  }
}

try {
  main();
} catch (e) {
  console.error('Fatal error:', e.message);
  process.exit(1);
}
