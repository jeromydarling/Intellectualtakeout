#!/usr/bin/env node
/**
 * One-way content sync: live WordPress -> this repo.
 *
 * Fetches posts published or modified since the stamp in
 * src/data/wp-sync.json and (re)writes their markdown files, so articles the
 * team publishes on WordPress keep flowing to the new site until cutover.
 * New images need no handling: the worker lazily mirrors /wp-content/uploads/
 * from the legacy origin. Run from the repo root:
 *
 *   node scripts/sync-from-wordpress.mjs [--since 2026-07-01T00:00:00] [--dry]
 *
 * Prints one line per written article; exits 0 with "SYNC OK n=<count>".
 * The publishing routine commits/pushes whatever this writes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import TurndownService from 'turndown';

const ROOT = join(import.meta.dirname, '..');
const STATE = join(ROOT, 'src/data/wp-sync.json');
const BASE = 'https://intellectualtakeout.org/wp-json/wp/v2';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;

const state = JSON.parse(readFileSync(STATE, 'utf8'));
const since = sinceArg ?? state.lastSync;
if (!since) throw new Error('no lastSync in src/data/wp-sync.json and no --since given');

// curl honors the environment proxy; node fetch does not.
function fetchJSON(url) {
  const out = execFileSync('curl', ['-sS', '--max-time', '90', '--retry', '3', '--retry-delay', '2', url], {
    encoding: 'utf8',
    maxBuffer: 64e6,
  });
  return JSON.parse(out);
}

// -- conversion (mirrors the original migration converter) -------------------

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_' });
td.keep(['iframe', 'figure', 'figcaption', 'blockquote', 'video', 'audio', 'source', 'cite']);
td.addRule('dropJunk', {
  filter: (node) => {
    const cls = (node.getAttribute && node.getAttribute('class')) || '';
    return /simplefavorite-button|sharedaddy|jp-relatedposts|playht/i.test(cls)
      || node.nodeName === 'SCRIPT' || node.nodeName === 'STYLE' || node.nodeName === 'FORM';
  },
  replacement: () => '',
});

const decode = (s) => (s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…');
const stripTags = (s) => decode((s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\[…\]|\[\.\.\.\]/g, '').trim();
const relativize = (s) => (s || '').replace(/https?:\/\/(www\.)?intellectualtakeout\.org\//g, '/');
const yamlStr = (s) => JSON.stringify(String(s ?? ''));

function writeArticle(p) {
  const linkPath = new URL(p.link).pathname;
  const m = /^\/(\d{4})\/(\d{2})\/([^/]+)\/?$/.exec(linkPath);
  if (!m) { console.log(`SKIP odd-link ${p.link}`); return null; }
  const [, yyyy, mm, slug] = m;

  const lines = ['---'];
  const push = (k, v) => { if (v !== undefined && v !== null && v !== '') lines.push(`${k}: ${v}`); };
  push('title', yamlStr(stripTags(p.title?.rendered)));
  push('description', yamlStr(stripTags(p.excerpt?.rendered).slice(0, 300)));
  push('pubDate', yamlStr(p.date_gmt + 'Z'));
  push('updatedDate', yamlStr(p.modified_gmt + 'Z'));
  push('author', yamlStr(p.author_info?.display_name || 'Intellectual Takeout'));
  const aSlug = /\/author\/([^/]+)\//.exec(p.author_info?.author_link || '')?.[1] ?? 'intellectual-takeout';
  push('authorSlug', yamlStr(aSlug));
  lines.push(`categories: [${(p.category_info || []).map((c) => yamlStr(c.name)).join(', ')}]`);
  lines.push(`categorySlugs: [${(p.category_info || []).map((c) => yamlStr(c.slug)).join(', ')}]`);
  lines.push(`tags: [${(p.tag_info || []).map((t) => yamlStr(t.name)).join(', ')}]`);
  if (p.featured_image_src_large?.[0]) push('heroImage', yamlStr(relativize(p.featured_image_src_large[0])));
  push('wpId', yamlStr(p.id));
  lines.push('---');

  const body = td.turndown(relativize(p.content?.rendered || ''));
  const dir = join(ROOT, 'src/content/articles', yyyy, mm);
  const file = join(dir, `${slug}.md`);
  if (!dry) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, lines.join('\n') + '\n\n' + body + '\n');
  }
  console.log(`WROTE /${yyyy}/${mm}/${slug}/  (${stripTags(p.title?.rendered).slice(0, 60)})`);
  return { authorSlug: aSlug, authorName: p.author_info?.display_name };
}

// -- fetch new + modified ----------------------------------------------------

const seen = new Map();
for (const param of ['after', 'modified_after']) {
  let page = 1;
  for (;;) {
    let posts;
    try {
      posts = fetchJSON(`${BASE}/posts?per_page=50&page=${page}&status=publish&orderby=date&order=desc&${param}=${encodeURIComponent(since)}`);
    } catch (e) {
      if (page > 1) break; // "page beyond total" errors end pagination
      throw e;
    }
    if (!Array.isArray(posts) || posts.length === 0) break;
    for (const p of posts) seen.set(p.id, p);
    if (posts.length < 50) break;
    page++;
  }
}

let wrote = 0;
const newAuthors = [];
for (const p of seen.values()) {
  const res = writeArticle(p);
  if (res) { wrote++; newAuthors.push(res); }
}

// register unseen authors so their archive pages build
if (wrote > 0 && !dry) {
  const authorsPath = join(ROOT, 'src/data/authors.json');
  const authors = JSON.parse(readFileSync(authorsPath, 'utf8'));
  const known = new Set(authors.map((a) => a.slug));
  let added = 0;
  for (const { authorSlug, authorName } of newAuthors) {
    if (authorSlug && !known.has(authorSlug)) {
      authors.push({ slug: authorSlug, name: authorName || authorSlug, count: 1 });
      known.add(authorSlug);
      added++;
    }
  }
  if (added) writeFileSync(authorsPath, JSON.stringify(authors, null, 1));
}

if (!dry) {
  // WP's after/modified_after filters compare in SITE-LOCAL time
  // (America/Chicago), so the stamp must be local too. 10-min overlap guard.
  const local = new Date(Date.now() - 10 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
    .replace(' ', 'T');
  state.lastSync = local;
  writeFileSync(STATE, JSON.stringify(state, null, 1));
}
console.log(`SYNC OK n=${wrote} since=${since}`);
