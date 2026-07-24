/**
 * Audio articles: Workers AI TTS narration stored in R2, tracked in D1,
 * served at /audio/<article-path>.mp3, listed in a podcast feed at
 * /podcast.xml. Generation is incremental: the admin endpoint (or the
 * half-hourly cron) narrates one article per call, newest first.
 */
import { Env, json, checkAdminToken, fetchCorpusManifest, fetchCorpusChunk, escapeXml } from './lib';

const TTS_MODEL = '@cf/myshell-ai/melotts';
const SEGMENT_CHARS = 1400;
const MAX_CHARS = 24000;

function audioKey(path: string): string {
  return `audio${path.replace(/\/$/, '')}.mp3`;
}

async function synthesize(env: Env, text: string): Promise<Uint8Array | null> {
  const segments: string[] = [];
  let rest = text.slice(0, MAX_CHARS);
  while (rest.length) {
    let cut = rest.length <= SEGMENT_CHARS ? rest.length : rest.lastIndexOf('. ', SEGMENT_CHARS);
    if (cut < SEGMENT_CHARS / 2) cut = SEGMENT_CHARS;
    segments.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  const parts: Uint8Array[] = [];
  for (const seg of segments) {
    if (!seg) continue;
    try {
      const res = (await env.AI.run(TTS_MODEL as any, { prompt: seg, lang: 'en' })) as { audio?: string };
      if (!res.audio) return null;
      const bin = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
      parts.push(bin);
    } catch (e) {
      console.error('tts segment failed', (e as Error).message);
      return null;
    }
  }
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { merged.set(p, off); off += p.length; }
  return merged;
}

/** Narrate one article: explicit ?path=, else the newest without audio. */
export async function audioGenerate(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await checkAdminToken(request, env, url))) return json({ error: 'unauthorized' }, 401);
  const result = await generateNextAudio(env, url.searchParams.get('path') ?? undefined);
  return json(result, result.ok ? 200 : 500);
}

export async function generateNextAudio(env: Env, explicitPath?: string): Promise<{ ok: boolean; [k: string]: unknown }> {
  const manifest = await fetchCorpusManifest(env);
  if (!manifest) return { ok: false, error: 'no_manifest' };

  let doc: { url: string; title: string; author: string; pubDate: string; body: string; description: string } | null = null;
  if (explicitPath) {
    for (let n = 0; n < manifest.chunks && !doc; n++) {
      const docs = await fetchCorpusChunk(env, n);
      doc = docs?.find((d) => d.url === explicitPath) ?? null;
    }
    if (!doc) return { ok: false, error: 'article_not_found' };
  } else {
    // newest article that has no audio yet
    const candidates = await env.DB.prepare(
      `SELECT url, title, author, pub_date FROM articles_fts
       WHERE url NOT IN (SELECT path FROM audio_articles)
       ORDER BY pub_date DESC LIMIT 1`
    ).first<{ url: string }>();
    if (!candidates) return { ok: true, done: 'all_articles_have_audio' };
    for (let n = 0; n < manifest.chunks && !doc; n++) {
      const docs = await fetchCorpusChunk(env, n);
      doc = docs?.find((d) => d.url === candidates.url) ?? null;
    }
    if (!doc) return { ok: false, error: 'corpus_miss', url: candidates.url };
  }

  const narration = `${doc.title}. By ${doc.author || 'Intellectual Takeout'}. ${doc.body}`;
  const audio = await synthesize(env, narration);
  if (!audio) return { ok: false, error: 'tts_failed', url: doc.url };

  await env.MEDIA.put(audioKey(doc.url), audio, { httpMetadata: { contentType: 'audio/mpeg' } });
  const durationEstimate = Math.round(Math.min(doc.body.length, MAX_CHARS) / 16.5);
  await env.DB.prepare(
    `INSERT INTO audio_articles (path, title, author, duration_s, bytes) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes, duration_s = excluded.duration_s`
  ).bind(doc.url, doc.title, doc.author, durationEstimate, audio.length).run();
  return { ok: true, url: doc.url, bytes: audio.length };
}

export async function serveAudio(env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/audio/, '').replace(/\.mp3$/, '') + '/';
  const obj = await env.MEDIA.get(audioKey(path));
  if (!obj) return new Response('No narration for this article (yet).', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'public, max-age=31536000, immutable',
      'accept-ranges': 'none',
    },
  });
}

export async function audioStatus(env: Env, url: URL): Promise<Response> {
  const path = url.searchParams.get('path') ?? '';
  const row = await env.DB.prepare(`SELECT path, duration_s FROM audio_articles WHERE path = ?`).bind(path).first();
  return json({ available: !!row, ...((row as object) ?? {}) }, 200, { 'cache-control': 'public, max-age=600' });
}

export async function podcastFeed(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT a.path, a.title, a.author, a.duration_s, a.bytes, a.created_at, f.description
     FROM audio_articles a LEFT JOIN (SELECT url, description FROM articles_fts) f ON f.url = a.path
     ORDER BY a.created_at DESC LIMIT 100`
  ).all<any>();
  const items = (rows.results ?? [])
    .map(
      (r) => `
    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${env.SITE_URL}${r.path}</link>
      <guid isPermaLink="false">${env.SITE_URL}${r.path}#audio</guid>
      <description>${escapeXml(r.description ?? '')}</description>
      <itunes:author>${escapeXml(r.author ?? 'Intellectual Takeout')}</itunes:author>
      <itunes:duration>${r.duration_s ?? 0}</itunes:duration>
      <pubDate>${new Date(r.created_at + 'Z').toUTCString()}</pubDate>
      <enclosure url="${env.SITE_URL}/audio${r.path.replace(/\/$/, '')}.mp3" length="${r.bytes ?? 0}" type="audio/mpeg"/>
    </item>`
    )
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Intellectual Takeout Audio</title>
    <link>${env.SITE_URL}</link>
    <language>en-us</language>
    <description>Narrated articles from Intellectual Takeout — feeding minds, pursuing truth.</description>
    <itunes:author>Intellectual Takeout</itunes:author>
    <itunes:image href="${env.SITE_URL}/assets/ito-logo.png"/>
    <itunes:explicit>false</itunes:explicit>${items}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' },
  });
}
