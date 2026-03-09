#!/usr/bin/env node
/**
 * Parse browser snapshot (JSON or YAML) from stdin to extract page text content.
 * Recursively collects element "name" values, filters UI chrome, outputs markdown.
 *
 * Usage: node scripts/parse-snapshot.js <author> <date-YYYY-MM-DD> < snapshot.json
 *   Or:  cat snapshot.json | node scripts/parse-snapshot.js "Michael Govaerts" 2026-02-27
 *
 * Output: writes notes/{author-slug}/{date}.md (author/date structure)
 */

const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, '..', 'notes');

// Roles to skip (UI chrome)
const SKIP_ROLES = new Set([
  'button', 'menuitem', 'menubar', 'menu', 'tab', 'tablist', 'tabpanel',
  'search', 'combobox', 'textbox', 'checkbox', 'radio', 'switch',
  'scrollbar', 'separator', 'progressbar', 'slider', 'spinbutton',
  'banner', 'contentinfo', 'navigation', 'complementary', 'form'
]);

// Roles whose children we typically want to inline (avoid duplicate text)
const INLINE_ROLES = new Set(['link', 'heading', 'paragraph', 'listitem']);

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseInput(input) {
  let trimmed = input.trim();
  if (!trimmed) return null;

  // Unwrap MCP-style response (may have content/text/snapshot key)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const inner = parsed.content ?? parsed.text ?? parsed.snapshot ?? parsed;
      if (inner !== parsed && typeof inner === 'string') {
        trimmed = inner;
      } else if (inner !== parsed && typeof inner === 'object') {
        return inner;
      }
    } catch {
      // Fall through
    }
  }

  // Try JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to YAML
    }
  }

  // Parse YAML-like accessibility tree (role "name" or - role "name")
  return parseYamlSnapshot(trimmed);
}

/**
 * Parse YAML-style accessibility snapshot.
 * Format: - role "name" or role "name" with indented children
 */
function parseYamlSnapshot(text) {
  const lines = text.split('\n');
  const stack = [{ children: [], indent: -1 }];
  const root = stack[0];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\s*)[-\s]*(\w+)\s+"([^"]*)"\s*(.*)$/) ||
      line.match(/^(\s*)[-\s]*(\w+)\s+([^\s"][^\s]*?)(?:\s+\[|\s*$)/);
    if (!match) continue;

    const indent = match[1].length;
    const role = match[2].toLowerCase();
    const name = (match[3] || '').replace(/^"|"$/g, '').trim();

    // Pop stack to correct level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const node = { role, name, children: [], indent };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root.children[0] || { role: 'root', name: '', children: root.children };
}

/**
 * Recursively extract text from accessibility tree node.
 */
function extractText(node, depth = 0) {
  if (!node) return [];

  const role = (node.role || '').toLowerCase();
  if (SKIP_ROLES.has(role)) return [];

  const name = (node.name || '').trim();
  const parts = [];

  // Collect name if non-empty and not purely URL
  if (name && !/^https?:\/\//.test(name) && name.length > 1) {
    parts.push({ text: name, role, depth });
  }

  const children = node.children || [];
  for (const child of children) {
    parts.push(...extractText(child, depth + 1));
  }

  return parts;
}

/**
 * Convert extracted parts to markdown, preserving structure.
 */
function toMarkdown(parts) {
  const lines = [];
  let lastDepth = -1;
  const seen = new Set();

  for (const { text, role, depth } of parts) {
    // Dedupe consecutive identical lines
    const key = text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);

    // Skip very short fragments that look like UI
    if (text.length < 3 && /^[A-Za-z]+$/.test(text)) continue;
    if (/^(Back|Next|Previous|Submit|Cancel|Close|Menu|Search)$/i.test(text)) continue;

    if (role === 'heading') {
      const level = Math.min(depth + 1, 6);
      lines.push('\n' + '#'.repeat(level) + ' ' + text + '\n');
    } else if (role === 'listitem') {
      lines.push('- ' + text);
    } else if (text) {
      lines.push(text);
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Infer tags from note content.
 * Returns array of tag strings.
 */
function inferTags(body) {
  const lower = body.toLowerCase();
  const tags = [];

  const huntKeywords = [
    'the hunt', 'job search', 'interview', 'resume', 'portfolio',
    'networking', 'linkedin', 'recruiter', 'application', 'apply',
    'offer', 'salary', 'negotiate', 'freelance', 'client',
    'cold outreach', 'coffee chat', 'behavioral', 'star method',
    'hired', 'hiring', 'job board', 'cover letter', 'follow up',
    'slido', 'huddle'
  ];
  const jsKeywords = [
    'javascript', ' js ', 'node.js', 'nodejs', 'react', 'express',
    'async', 'await', 'promise', 'callback', 'dom ', 'api ',
    'fetch(', 'json', 'typescript', 'vue', 'angular', 'next.js'
  ];
  const cssKeywords = [
    ' css', 'flexbox', 'grid layout', 'responsive', 'media query',
    'tailwind', 'bootstrap', 'sass', 'scss', 'animation',
    'selector', 'specificity', 'box model'
  ];
  const htmlKeywords = [
    ' html', 'semantic', 'accessibility', 'a11y', 'aria',
    'form element', '<div', '<section', '<article'
  ];

  if (huntKeywords.some(k => lower.includes(k))) tags.push('the-hunt');
  if (jsKeywords.some(k => lower.includes(k))) tags.push('js');
  if (cssKeywords.some(k => lower.includes(k))) tags.push('css');
  if (htmlKeywords.some(k => lower.includes(k))) tags.push('html');

  if (tags.length === 0) tags.push('the-hunt');

  return tags;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node parse-snapshot.js <author> <date-YYYY-MM-DD> < snapshot.json');
    console.error('  Reads snapshot from stdin (JSON or YAML), outputs markdown file.');
    process.exit(1);
  }

  const author = args[0];
  const date = args[1];

  let input;
  if (!process.stdin.isTTY) {
    input = fs.readFileSync(0, 'utf8');
  } else {
    console.error('Provide snapshot via stdin: cat snapshot.json | node parse-snapshot.js "Author" YYYY-MM-DD');
    process.exit(1);
  }

  const tree = parseInput(input);
  if (!tree) {
    console.error('Failed to parse snapshot (expected JSON or YAML)');
    process.exit(1);
  }

  const parts = extractText(tree);
  const body = toMarkdown(parts);
  const tags = inferTags(body);

  const authorSlug = slugify(author);
  const authorDir = path.join(NOTES_DIR, authorSlug);
  const filepath = path.join(authorDir, `${date}.md`);

  const tagYaml = tags.map(t => `  - ${t}`).join('\n');
  const frontmatter = `---
tags:
${tagYaml}
author: ${author}
date: ${date}
---

`;

  const content = frontmatter + body + '\n';
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`Created ${filepath} [tags: ${tags.join(', ')}]`);
}

main();
