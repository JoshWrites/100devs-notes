#!/usr/bin/env node
/**
 * Build script: parses markdown notes with frontmatter, generates static site
 * Uses git log for author when available, normalizes via contributors.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { marked } = require('marked');

const NOTES_DIR = path.join(__dirname, '..', 'notes');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const REPO_ROOT = path.join(__dirname, '..');

function loadContributors() {
  const p = path.join(REPO_ROOT, 'contributors.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getGitAuthor(filePath) {
  try {
    const rel = path.relative(REPO_ROOT, filePath);
    const out = execSync(`git log -1 --format=%an -- "${rel.replace(/"/g, '\\"')}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    return out.trim();
  } catch {
    return null;
  }
}

function normalizeAuthor(author, contributors) {
  if (!author) return 'Unknown';
  const trimmed = author.trim();
  return contributors[trimmed] || trimmed;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter = {};
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (key === 'tags') {
      const tags = [];
      if (value && value !== '[]') {
        tags.push(...value.replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean));
      }
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        tags.push(lines[++i].replace(/^\s+-\s+/, '').trim());
      }
      frontmatter.tags = tags;
    } else if (key === 'lesson') {
      frontmatter.lesson = parseInt(value, 10) || 0;
    } else {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, body: match[2] };
}

function extractTitle(body) {
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : '';
}

function build() {
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const contributors = loadContributors();
  const files = [];
  function collectMd(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path.join(prefix, e.name);
      if (e.isDirectory()) {
        collectMd(path.join(dir, e.name), rel);
      } else if (e.name.endsWith('.md')) {
        files.push(rel);
      }
    }
  }
  collectMd(NOTES_DIR);
  const index = [];

  for (const file of files) {
    const filePath = path.join(NOTES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    const html = marked.parse(body);
    // slug = author/date (e.g. michaelgovaerts/2026-02-27)
    const slug = file.replace(/\.md$/, '').replace(/\\/g, '/');

    let author = frontmatter.author;
    if (!author) {
      const gitAuthor = getGitAuthor(filePath);
      author = gitAuthor || 'Unknown';
    }
    author = normalizeAuthor(author, contributors);

    const note = {
      slug,
      lesson: frontmatter.lesson ?? 0,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : (frontmatter.tags ? [frontmatter.tags] : []),
      author,
      date: frontmatter.date ?? '',
      title: frontmatter.title || extractTitle(body) || slug,
      html
    };
    index.push(note);
    const htmlPath = path.join(DIST_DIR, ...slug.split('/')) + '.html';
    fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
    fs.writeFileSync(htmlPath, html, 'utf8');
  }

  index.sort((a, b) => a.lesson - b.lesson || a.slug.localeCompare(b.slug));
  fs.writeFileSync(path.join(DIST_DIR, 'index.json'), JSON.stringify(index), 'utf8');

  const viewerHtml = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), viewerHtml, 'utf8');

  console.log(`Built ${index.length} notes to ${DIST_DIR}`);
}

build();
