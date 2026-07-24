/**
 * Edge worker in front of the static Astro build.
 *
 * Routes handled here (everything else falls through to static assets):
 *   /feed/                    WordPress-compatible RSS
 *   /podcast.xml              narrated-articles podcast feed
 *   /wp-content/uploads/*     R2 media (lazy backfill from legacy origin)
 *   /audio/**.mp3             article narration from R2
 *   /og/**                    edge-generated share cards
 *   /api/search               FTS5 search        /api/search/reindex (admin)
 *   /api/ask                  semantic search + cited answers
 *   /api/ask/embed|build      (admin) build the semantic index
 *   /api/related              semantic related-articles
 *   /api/mostread             real read counts   /api/audio/* (status/admin)
 *   /api/newsletter/*         signup/confirm/unsubscribe
 *
 * Crons: daily digest (12:00 UTC), weekly best-of (Sun 13:00 UTC),
 * half-hourly search-index self-sync + one-article audio backfill.
 */
import { Env } from './lib';
import { search, reindex, syncSearchIndex } from './search';
import { ask, askEmbedChunk, askBuildIndex, related } from './ask';
import { newsletter, sendDailyDigest, sendWeeklyBestOf } from './newsletter';
import { countView, isArticlePath, mostRead } from './views';
import { ogArticle, ogQuote } from './og';
import { audioGenerate, audioStatus, serveAudio, podcastFeed, generateNextAudio } from './audio';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/feed' || pathname === '/feed/') {
      const asset = await env.ASSETS.fetch(new URL('/feed.xml', url.origin));
      return new Response(asset.body, {
        status: asset.status,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' },
      });
    }

    if (pathname === '/podcast.xml') return podcastFeed(env);
    if (pathname.startsWith('/wp-content/uploads/')) return serveMedia(request, env, ctx, pathname);
    if (pathname.startsWith('/audio/') && pathname.endsWith('.mp3')) return serveAudio(env, url);

    if (pathname === '/og/quote.png') return ogQuote(env, url);
    if (pathname.startsWith('/og/')) return ogArticle(env, url);

    if (pathname === '/api/search') return search(env, url);
    if (pathname === '/api/search/reindex' && request.method === 'POST') return reindex(request, env, url);
    if (pathname === '/api/ask') return ask(env, url);
    if (pathname === '/api/ask/embed' && request.method === 'POST') return askEmbedChunk(request, env, url);
    if (pathname === '/api/ask/build' && request.method === 'POST') return askBuildIndex(request, env, url);
    if (pathname === '/api/related') return related(env, url);
    if (pathname === '/api/mostread') return mostRead(env, url);
    if (pathname === '/api/audio/status') return audioStatus(env, url);
    if (pathname === '/api/audio/generate' && request.method === 'POST') return audioGenerate(request, env, url);
    if (pathname.startsWith('/api/newsletter/')) return newsletter(request, env, url);

    const res = await env.ASSETS.fetch(request);
    if (res.ok && isArticlePath(pathname) && request.method === 'GET') {
      ctx.waitUntil(countView(env, pathname));
    }
    return res;
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 12 * * *') {
      ctx.waitUntil(sendDailyDigest(env));
    } else if (event.cron === '0 13 * * 0') {
      ctx.waitUntil(sendWeeklyBestOf(env));
    } else {
      ctx.waitUntil(syncSearchIndex(env));
      ctx.waitUntil(
        generateNextAudio(env).then((r) => {
          if (!r.ok) console.error('audio backfill', JSON.stringify(r));
        })
      );
    }
  },
} satisfies ExportedHandler<Env>;

// ---------------------------------------------------------------- media

async function serveMedia(request: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response> {
  const key = decodeURIComponent(pathname.replace(/^\//, ''));

  const object = await env.MEDIA.get(key);
  if (object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (!headers.has('content-type')) headers.set('content-type', guessType(key));
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
  }

  // Not yet mirrored: proxy from the legacy origin and backfill R2 lazily.
  if (env.LEGACY_MEDIA_ORIGIN) {
    const upstream = await fetch(`${env.LEGACY_MEDIA_ORIGIN}${pathname}`, {
      headers: { 'user-agent': 'it-media-proxy/1.0' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
    if (upstream.ok && upstream.body) {
      const [toClient, toR2] = upstream.body.tee();
      ctx.waitUntil(
        env.MEDIA.put(key, toR2, {
          httpMetadata: { contentType: upstream.headers.get('content-type') ?? guessType(key) },
        })
      );
      return new Response(toClient, {
        headers: {
          'content-type': upstream.headers.get('content-type') ?? guessType(key),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }
  }
  return new Response('Not found', { status: 404 });
}

function guessType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase();
  return (
    {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
      mp4: 'video/mp4', mp3: 'audio/mpeg', pdf: 'application/pdf',
    }[ext ?? ''] ?? 'application/octet-stream'
  );
}
