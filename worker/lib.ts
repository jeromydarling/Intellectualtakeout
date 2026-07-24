export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  SITE_URL: string;
  LEGACY_MEDIA_ORIGIN?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });

/** Admin endpoints authenticate against the token stored in D1, never the repo. */
export async function checkAdminToken(request: Request, env: Env, url: URL): Promise<boolean> {
  const token = request.headers.get('x-reindex-token') ?? url.searchParams.get('token') ?? '';
  if (!token) return false;
  const stored = await env.DB.prepare(`SELECT value FROM admin_config WHERE key = 'reindex_token'`).first<{ value: string }>();
  return !!stored?.value && token === stored.value;
}

export async function getConfig(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT value FROM admin_config WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setConfig(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

export interface CorpusDoc {
  url: string;
  title: string;
  description: string;
  author: string;
  categories: string;
  tags: string;
  pubDate: string;
  hero: string;
  body: string;
}

export async function fetchCorpusChunk(env: Env, n: number): Promise<CorpusDoc[] | null> {
  const res = await env.ASSETS.fetch(new URL(`/search-data/chunk-${String(n).padStart(3, '0')}.json`, env.SITE_URL));
  if (!res.ok) return null;
  return res.json();
}

export async function fetchCorpusManifest(env: Env): Promise<{ chunks: number; documents: number; generatedAt: string } | null> {
  const res = await env.ASSETS.fetch(new URL('/search-data/manifest.json', env.SITE_URL));
  if (!res.ok) return null;
  return res.json();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeXml(s: string): string {
  return escapeHtml(s).replace(/'/g, '&apos;');
}
