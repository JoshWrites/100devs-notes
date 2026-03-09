#!/usr/bin/env node
/**
 * Re-tag all notes based on content analysis.
 * Reads each markdown file, scans the body for topic keywords,
 * and updates the frontmatter tags.
 *
 * Usage: node scripts/retag-notes.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const NOTES_DIR = path.join(__dirname, '..', 'notes');

// Coda UI chrome that leaked into snapshots — strip before analysis
const CHROME_PATTERNS = [
  /^All docs$/m,
  /^Pages$/m,
  /^Skip to content.*$/m,
  /^Page list.*$/m,
  /^Copy link.*$/m,
  /^Show pages$/m,
  /^Sign up for free$/m,
  /^Doc actions.*$/m,
  /^Huddle Notes by Author and Date$/m,
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\.\d{1,2}\.\d{4}$/gm,
  /^(Mon|Tue|Tues|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\/\d{2,4}.*$/gm,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/gm,
  /^Friday\s+\d{1,2}\.\d{1,2}\.\d{4}$/gm,
  /^100Devs Huddle Notes$/m,
  /Options$/gm
];

const TAG_RULES = [
  {
    tag: 'networking',
    keywords: [
      'networking', 'network', 'coffee chat', 'cold outreach',
      'linkedin profile', 'connect with', 'warm intro',
      'reach out', 'building connections', 'professional network',
      'informational interview', 'meetup', 'tech event',
      'discord community', 'follow up with', 'connection request'
    ],
    weight: 2
  },
  {
    tag: 'interview',
    keywords: [
      'interview', 'behavioral question', 'star method',
      'technical interview', 'whiteboard', 'coding challenge',
      'take-home', 'mock interview', 'recruiter call',
      'phone screen', 'hiring manager', 'interview prep',
      'answer question', 'tell me about yourself'
    ],
    weight: 2
  },
  {
    tag: 'resume',
    keywords: [
      'resume', 'cv ', 'cover letter', 'application',
      'job board', 'apply', 'applying', 'applied',
      'ats ', 'applicant tracking', 'job posting',
      'tailor your resume', 'work experience'
    ],
    weight: 2
  },
  {
    tag: 'freelance',
    keywords: [
      'freelance', 'freelancing', 'client', 'evergreen client',
      'agency', 'contract', 'invoice', 'upwork', 'fiverr',
      'retainer', 'proposal', 'scope of work', 'pricing',
      'side project', 'side hustle'
    ],
    weight: 2
  },
  {
    tag: 'portfolio',
    keywords: [
      'portfolio', '100 hours', '100hours', 'hundred hours',
      'project showcase', 'personal site', 'personal website',
      'github profile', 'deploy', 'show off', 'case study',
      'capstone', 'final project'
    ],
    weight: 2
  },
  {
    tag: 'mindset',
    keywords: [
      'mindset', 'imposter syndrome', 'motivation', 'burnout',
      'mental health', 'self care', 'self-care', 'growth mindset',
      'embrace the struggle', 'embrace the suck', 'keep going',
      'don\'t give up', 'believe in yourself', 'proof list',
      'celebrate wins', 'accountability', 'discipline',
      'procrastinat', 'overwhelm', 'anxiety', 'stress',
      'comparison', 'patience'
    ],
    weight: 2
  },
  {
    tag: 'salary',
    keywords: [
      'salary', 'negotiat', 'compensation', 'offer letter',
      'equity', 'stock option', 'benefits', 'base pay',
      'total comp', 'counter offer', 'pay range', 'market rate',
      'glassdoor', 'levels.fyi'
    ],
    weight: 2
  },
  {
    tag: 'technical',
    keywords: [
      'javascript', 'react', 'node.js', 'nodejs', 'express',
      'css', 'html', 'typescript', 'python', 'api ',
      'database', 'sql', 'mongodb', 'git ', 'github',
      'deployment', 'aws', 'docker', 'algorithm',
      'data structure', 'leetcode', 'hackerrank',
      'code review', 'debugging', 'testing', 'unit test',
      'full stack', 'fullstack', 'frontend', 'backend',
      'web development', 'coding bootcamp'
    ],
    weight: 1
  }
];

function stripChrome(text) {
  let clean = text;
  for (const pat of CHROME_PATTERNS) {
    clean = clean.replace(pat, '');
  }
  return clean;
}

function inferTags(body) {
  const clean = stripChrome(body);
  const lower = clean.toLowerCase();

  // Score each tag by number of keyword hits
  const scores = TAG_RULES.map(rule => {
    const hits = rule.keywords.filter(k => lower.includes(k)).length;
    return { tag: rule.tag, hits, threshold: rule.weight };
  }).filter(s => s.hits >= s.threshold);

  // Sort by hit count descending, keep top 3 non-trivial tags
  scores.sort((a, b) => b.hits - a.hits);
  const topTags = scores.slice(0, 3).map(s => s.tag);

  // All huddle notes get the-hunt as base tag
  const tags = ['the-hunt', ...topTags.filter(t => t !== 'the-hunt')];
  return tags;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (key === 'tags') {
      const tags = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        tags.push(lines[++i].replace(/^\s+-\s+/, '').trim());
      }
      fm.tags = tags;
    } else {
      fm[key] = value;
    }
  }
  return { frontmatter: fm, body: match[2] };
}

function buildFrontmatter(fm) {
  const lines = ['---'];
  if (fm.tags && fm.tags.length > 0) {
    lines.push('tags:');
    for (const t of fm.tags) lines.push(`  - ${t}`);
  }
  if (fm.author) lines.push(`author: ${fm.author}`);
  if (fm.date) lines.push(`date: ${fm.date}`);
  lines.push('---');
  return lines.join('\n');
}

function collectFiles(dir, prefix = '') {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) {
      files.push(...collectFiles(path.join(dir, e.name), rel));
    } else if (e.name.endsWith('.md')) {
      files.push(rel);
    }
  }
  return files;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = collectFiles(NOTES_DIR);
  const tagCounts = {};
  let updated = 0;

  for (const file of files) {
    const filePath = path.join(NOTES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      console.warn(`Skipping ${file} (no frontmatter)`);
      continue;
    }

    const newTags = inferTags(parsed.body);
    const oldTags = parsed.frontmatter.tags || [];

    for (const t of newTags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }

    const changed = JSON.stringify(newTags) !== JSON.stringify(oldTags);
    if (changed) {
      if (dryRun) {
        console.log(`${file}: [${oldTags.join(', ')}] → [${newTags.join(', ')}]`);
      } else {
        parsed.frontmatter.tags = newTags;
        const newFm = buildFrontmatter(parsed.frontmatter);
        const newContent = newFm + '\n' + parsed.body;
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log(`${file}: [${newTags.join(', ')}]`);
      }
      updated++;
    }
  }

  console.log(`\n${dryRun ? 'Would update' : 'Updated'} ${updated}/${files.length} notes`);
  console.log('\nTag distribution:');
  const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  for (const [tag, count] of sorted) {
    console.log(`  ${tag}: ${count}`);
  }
}

main();
