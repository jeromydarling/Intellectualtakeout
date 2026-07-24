/**
 * First-party page-view counting (no cookies, no PII) and the Most Read API.
 * The worker fronts every request, so article HTML responses bump a
 * (path, day) counter in D1 via waitUntil — zero latency cost to readers.
 */
import { Env, json } from './lib';

const ARTICLE_RE = /^\/\d{4}\/\d{2}\/[^/]+\/$/;

export function isArticlePath(pathname: string): boolean {
  return ARTICLE_RE.test(pathname);
}

export async function countView(env: Env, pathname: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO page_views (path, day, views) VALUES (?, ?, 1)
       ON CONFLICT(path, day) DO UPDATE SET views = views + 1`
    ).bind(pathname, day).run();
  } catch (e) {
    console.error('countView', (e as Error).message);
  }
}

const WINDOWS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, all: 36500 };

export async function mostRead(env: Env, url: URL): Promise<Response> {
  const windowKey = url.searchParams.get('window') ?? '7d';
  const days = WINDOWS[windowKey] ?? 7;
  const limit = Math.min(10, Number(url.searchParams.get('limit')) || 5);
  const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT v.path, SUM(v.views) AS views, f.title, f.author, f.pub_date AS pubDate, f.hero, f.categories
     FROM page_views v LEFT JOIN articles_fts f ON f.url = v.path
     WHERE v.day >= ? GROUP BY v.path ORDER BY views DESC LIMIT ?`
  ).bind(since, limit).all();
  const results = (rows.results ?? []).filter((r: any) => r.title);
  return json({ window: windowKey, results }, 200, { 'cache-control': 'public, max-age=300' });
}
