#!/usr/bin/env node
/**
 * Emit the search corpus as static JSON chunks into dist/search-data/.
 * Runs after `astro build`. The worker's /api/search/reindex endpoint reads
 * these chunks (as assets) and loads them into the D1 FTS5 index, so the
 * search index can be refreshed from the deployed site itself.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const ARTICLES = join(ROOT, 'src/content/articles');
const OUT = join(ROOT, 'dist/search-data');
const CHUNK_SIZE = 100;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.md')) yield p;
  }
}

function parseFrontmatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return [{}, raw];
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv;
    if (val.startsWith('[')) {
      try { fm[key] = JSON.parse(val); } catch { fm[key] = []; }
    } else {
      try { fm[key] = JSON.parse(val); } catch { fm[key] = val; }
    }
  }
  return [fm, raw.slice(m[0].length)];
}

function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const docs = [];
for (const file of walk(ARTICLES)) {
  const raw = readFileSync(file, 'utf8');
  const [fm, body] = parseFrontmatter(raw);
  const rel = file.slice(ARTICLES.length + 1).replace(/\.md$/, '');
  const [yyyy, mm, ...slug] = rel.split(/[\\/]/);
  docs.push({
    url: `/${yyyy}/${mm}/${slug.join('/')}/`,
    title: fm.title ?? '',
    description: fm.description ?? '',
    author: fm.author ?? '',
    categories: (fm.categories ?? []).join(', '),
    tags: (fm.tags ?? []).join(', '),
    pubDate: fm.pubDate ?? '',
    hero: fm.heroImage ?? '',
    body: plainText(body),
  });
}
docs.sort((a, b) => (a.url < b.url ? -1 : 1));

mkdirSync(OUT, { recursive: true });
let chunks = 0;
for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
  writeFileSync(join(OUT, `chunk-${String(chunks).padStart(3, '0')}.json`), JSON.stringify(docs.slice(i, i + CHUNK_SIZE)));
  chunks++;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ chunks, documents: docs.length, generatedAt: new Date().toISOString() }));
console.log(`search corpus: ${docs.length} documents in ${chunks} chunks`);
