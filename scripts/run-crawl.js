#!/usr/bin/env node
/**
 * Run crawl phase based on snapshot type and args.
 *
 * INDEX page (Huddle Notes by Author and Date):
 *   node run-crawl.js docs/snapshot-index.yaml
 *   → Runs extract-page-list.js, outputs "Index extracted. Run crawl loop."
 *
 * NOTE page:
 *   node run-crawl.js snapshot.yaml "Author" YYYY-MM-DD
 *   → Runs parse-snapshot.js, then crawl-coda mark-done
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS_DIR = path.join(__dirname);

function runIndexPhase(snapshotPath) {
  const absPath = path.resolve(snapshotPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Snapshot file not found: ${absPath}`);
    process.exit(1);
  }

  const result = spawnSync('node', [
    path.join(SCRIPTS_DIR, 'extract-page-list.js'),
    absPath,
    '--merge'
  ], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log('Index extracted. Run crawl loop.');
}

function runNotePhase(snapshotPath, author, date) {
  const absPath = path.resolve(snapshotPath);
  if (!fs.existsSync(absPath)) {
    console.error(`Snapshot file not found: ${absPath}`);
    process.exit(1);
  }

  const input = fs.readFileSync(absPath, 'utf8');

  // 1. parse-snapshot.js
  const parseResult = spawnSync('node', [
    path.join(SCRIPTS_DIR, 'parse-snapshot.js'),
    author,
    date
  ], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'inherit', 'inherit']
  });

  if (parseResult.status !== 0) {
    process.exit(parseResult.status || 1);
  }

  // 2. crawl-coda mark-done
  const markResult = spawnSync('node', [
    path.join(SCRIPTS_DIR, 'crawl-coda.js'),
    'mark-done',
    author,
    date
  ], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (markResult.status !== 0) {
    process.exit(markResult.status || 1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 1) {
    // INDEX page: snapshot path only
    runIndexPhase(args[0]);
  } else if (args.length === 3) {
    // NOTE page: snapshot path, author, date
    runNotePhase(args[0], args[1], args[2]);
  } else {
    console.error('Usage:');
    console.error('  INDEX:  node run-crawl.js <snapshot-path>');
    console.error('  NOTE:   node run-crawl.js <snapshot-path> "Author" YYYY-MM-DD');
    process.exit(1);
  }
}

main();
