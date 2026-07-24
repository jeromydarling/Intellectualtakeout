/**
 * Full-text search over D1 FTS5 (porter stemming, BM25) plus the index
 * loaders: a manual chunk endpoint and the cron self-sync that keeps the
 * index matching the deployed corpus.
 */
import type { Env } from './lib';
import { json, checkAdminToken, fetchCorpusChunk, fetchCorpusManifest, getConfig, setConfig } from './lib';

function buildFtsQuery(input: string): string {
  const phrases: string[] = [];
  const rest = input.replace(/"([^"]*)"/g, (_, p) => {
    if (p.trim()) phrases.push(`"${p.trim().replace(/"/g, '')}"`);
    return ' ';
  });
  const terms = (rest.match(/[\p{L}\p{N}']+/gu) ?? []).slice(0, 10).map((t) => `"${t}"*`);
  return [...phrases, ...terms].join(' ');
}

export async function search(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1));
  const perPage = 10;
  if (!q) return json({ query: q, total: 0, page: 1, results: [] });
  const match = buildFtsQuery(q);
  if (!match) return json({ query: q, total: 0, page: 1, results: [] });

  try {
    const [rows, count] = await Promise.all([
      env.DB.prepare(
        `SELECT url, title, author, pub_date AS pubDate, hero, categories,
                snippet(articles_fts, 2, '<mark>', '</mark>', '…', 32) AS snippet,
                bm25(articles_fts, 12.0, 5.0, 1.0, 8.0, 3.0, 3.0) AS rank
         FROM articles_fts WHERE articles_fts MATCH ?
         ORDER BY rank LIMIT ? OFFSET ?`
      ).bind(match, perPage, (page - 1) * perPage).all(),
      env.DB.prepare(`SELECT count(*) AS n FROM articles_fts WHERE articles_fts MATCH ?`).bind(match).first<{ n: number }>(),
    ]);
    return json(
      { query: q, total: count?.n ?? 0, page, perPage, results: rows.results },
      200,
      { 'cache-control': 'public, max-age=300' }
    );
  } catch (e) {
    console.error('search error', (e as Error).message);
    return json({ query: q, total: 0, page, results: [], error: 'search_failed' }, 500);
  }
}

async function loadChunkIntoFts(env: Env, n: number): Promise<number | null> {
  const docs = await fetchCorpusChunk(env, n);
  if (!docs) return null;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM articles_fts WHERE url IN (${docs.map(() => '?').join(',')})`).bind(...docs.map((d) => d.url)),
    ...docs.map((d) =>
      env.DB.prepare(
        `INSERT INTO articles_fts (title, description, body, author, categories, tags, url, pub_date, hero)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(d.title, d.description, d.body, d.author, d.categories, d.tags, d.url, d.pubDate, d.hero)
    ),
  ]);
  return docs.length;
}

export async function reindex(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await checkAdminToken(request, env, url))) return json({ error: 'unauthorized' }, 401);
  const chunkParam = url.searchParams.get('chunk');
  if (chunkParam === null) {
    const manifest = await fetchCorpusManifest(env);
    return json(manifest ?? { error: 'no_manifest' }, manifest ? 200 : 500);
  }
  const n = Number(chunkParam);
  const count = await loadChunkIntoFts(env, n);
  if (count === null) return json({ error: 'chunk_not_found', chunk: chunkParam }, 404);
  return json({ ok: true, chunk: n, indexed: count });
}

/** Cron: reload the FTS index whenever a deploy changed the corpus. */
export async function syncSearchIndex(env: Env): Promise<void> {
  const manifest = await fetchCorpusManifest(env);
  if (!manifest) return;
  const current = await getConfig(env, 'search_index_version');
  if (current === manifest.generatedAt) return;

  console.log(`search index sync: ${manifest.documents} docs in ${manifest.chunks} chunks (${manifest.generatedAt})`);
  for (let n = 0; n < manifest.chunks; n++) {
    const count = await loadChunkIntoFts(env, n);
    if (count === null) { console.error(`chunk ${n} missing`); return; }
  }
  await setConfig(env, 'search_index_version', manifest.generatedAt);
  console.log('search index sync complete');
}
