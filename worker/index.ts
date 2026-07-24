/**
 * Edge worker in front of the static Astro build.
 *  - /feed/ and /feed        -> RSS XML (asset built at /feed.xml), WordPress-compatible URL
 *  - /wp-content/uploads/*   -> R2 media bucket, falling back to the legacy WordPress origin
 *  - /api/newsletter/*       -> D1-backed newsletter signup with double opt-in
 *  - scheduled()             -> daily digest to confirmed subscribers
 * Everything else            -> static assets.
 */

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  SITE_URL: string;
  // Origin to proxy media from until the R2 mirror is complete. Must be removed
  // (set empty) at DNS cutover to avoid a loop.
  LEGACY_MEDIA_ORIGIN?: string;
  // Email sending: 'resend' uses RESEND_API_KEY; 'log' just logs (dev default).
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/feed' || pathname === '/feed/') {
      const asset = await env.ASSETS.fetch(new URL('/feed.xml', url.origin));
      return new Response(asset.body, {
        status: asset.status,
        headers: {
          'content-type': 'application/rss+xml; charset=utf-8',
          'cache-control': 'public, max-age=900',
        },
      });
    }

    if (pathname.startsWith('/wp-content/uploads/')) {
      return serveMedia(request, env, ctx, pathname);
    }

    if (pathname.startsWith('/api/newsletter/')) {
      return newsletter(request, env, url);
    }

    if (pathname === '/api/search') {
      return search(env, url);
    }

    if (pathname === '/api/search/reindex' && request.method === 'POST') {
      return reindex(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 12 * * *') {
      ctx.waitUntil(sendDailyDigest(env));
    } else {
      ctx.waitUntil(syncSearchIndex(env));
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
      mp4: 'video/mp4', pdf: 'application/pdf',
    }[ext ?? ''] ?? 'application/octet-stream'
  );
}

// ---------------------------------------------------------------- newsletter

async function newsletter(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === '/api/newsletter/subscribe' && request.method === 'POST') {
    let email = '';
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      email = ((await request.json().catch(() => ({}))) as any).email ?? '';
    } else {
      email = String((await request.formData().catch(() => new FormData())).get('email') ?? '');
    }
    email = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ message: 'Please enter a valid email address.' }), { status: 400, headers: JSON_HEADERS });
    }

    const token = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO subscribers (email, status, token) VALUES (?, 'pending', ?)
       ON CONFLICT(email) DO UPDATE SET
         token = excluded.token,
         status = CASE WHEN subscribers.status = 'confirmed' THEN 'confirmed' ELSE 'pending' END`
    ).bind(email, token).run();

    const row = await env.DB.prepare('SELECT status FROM subscribers WHERE email = ?').bind(email).first<{ status: string }>();
    if (row?.status === 'confirmed') {
      return new Response(JSON.stringify({ message: 'You are already subscribed — thank you!' }), { headers: JSON_HEADERS });
    }

    const confirmUrl = `${env.SITE_URL}/api/newsletter/confirm?token=${token}`;
    await sendEmail(env, {
      to: email,
      subject: 'Confirm your Intellectual Takeout subscription',
      html: `<p>Thanks for signing up for the Intellectual Takeout <em>Daily Digest</em>.</p>
             <p><a href="${confirmUrl}">Click here to confirm your subscription.</a></p>
             <p>If you didn't request this, you can ignore this email.</p>`,
    });
    return new Response(JSON.stringify({ message: 'Check your inbox to confirm your subscription.' }), { headers: JSON_HEADERS });
  }

  if (path === '/api/newsletter/confirm') {
    const token = url.searchParams.get('token') ?? '';
    const res = await env.DB.prepare(
      `UPDATE subscribers SET status = 'confirmed', confirmed_at = datetime('now') WHERE token = ? AND status != 'unsubscribed'`
    ).bind(token).run();
    const ok = (res.meta.changes ?? 0) > 0;
    return Response.redirect(`${env.SITE_URL}/newsletter/${ok ? 'confirmed' : 'invalid'}/`, 302);
  }

  if (path === '/api/newsletter/unsubscribe') {
    const token = url.searchParams.get('token') ?? '';
    await env.DB.prepare(
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE token = ?`
    ).bind(token).run();
    return Response.redirect(`${env.SITE_URL}/newsletter/unsubscribed/`, 302);
  }

  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------- search

/**
 * Turn free-form user input into a safe FTS5 MATCH expression.
 * Quoted phrases are preserved; bare terms get prefix matching so partial
 * words still hit ("madis" -> madis*).
 */
function buildFtsQuery(input: string): string {
  const phrases: string[] = [];
  let rest = input.replace(/"([^"]*)"/g, (_, p) => {
    if (p.trim()) phrases.push(`"${p.trim().replace(/"/g, '')}"`);
    return ' ';
  });
  const terms = (rest.match(/[\p{L}\p{N}']+/gu) ?? [])
    .slice(0, 10)
    .map((t) => `"${t}"*`);
  return [...phrases, ...terms].join(' ');
}

async function search(env: Env, url: URL): Promise<Response> {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1));
  const perPage = 10;
  if (!q) {
    return new Response(JSON.stringify({ query: q, total: 0, page: 1, results: [] }), { headers: JSON_HEADERS });
  }
  const match = buildFtsQuery(q);
  if (!match) {
    return new Response(JSON.stringify({ query: q, total: 0, page: 1, results: [] }), { headers: JSON_HEADERS });
  }

  try {
    // bm25 weights: title, description, body, author, categories, tags
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
    return new Response(
      JSON.stringify({ query: q, total: count?.n ?? 0, page, perPage, results: rows.results }),
      { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=300' } }
    );
  } catch (e) {
    console.error('search error', (e as Error).message);
    return new Response(JSON.stringify({ query: q, total: 0, page, results: [], error: 'search_failed' }), { status: 500, headers: JSON_HEADERS });
  }
}

/**
 * Load one chunk of the build-time corpus (dist/search-data/chunk-NNN.json,
 * served as a static asset) into the FTS index. Idempotent per chunk:
 * existing rows for the chunk's URLs are replaced. Guarded by the
 * reindex_token stored in D1 (admin_config), so no secret lives in the repo.
 */
async function reindex(request: Request, env: Env, url: URL): Promise<Response> {
  const token = request.headers.get('x-reindex-token') ?? url.searchParams.get('token') ?? '';
  const stored = await env.DB.prepare(`SELECT value FROM admin_config WHERE key = 'reindex_token'`).first<{ value: string }>();
  if (!stored?.value || token !== stored.value) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  const chunkParam = url.searchParams.get('chunk');
  if (chunkParam === null) {
    const manifest = await env.ASSETS.fetch(new URL('/search-data/manifest.json', url.origin));
    return new Response(manifest.body, { status: manifest.status, headers: JSON_HEADERS });
  }

  const chunkName = `chunk-${String(Number(chunkParam)).padStart(3, '0')}.json`;
  const asset = await env.ASSETS.fetch(new URL(`/search-data/${chunkName}`, url.origin));
  if (!asset.ok) {
    return new Response(JSON.stringify({ error: 'chunk_not_found', chunk: chunkParam }), { status: 404, headers: JSON_HEADERS });
  }
  const docs = (await asset.json()) as Array<Record<string, string>>;

  const statements = [
    env.DB.prepare(`DELETE FROM articles_fts WHERE url IN (${docs.map(() => '?').join(',')})`).bind(...docs.map((d) => d.url)),
    ...docs.map((d) =>
      env.DB.prepare(
        `INSERT INTO articles_fts (title, description, body, author, categories, tags, url, pub_date, hero)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(d.title, d.description, d.body, d.author, d.categories, d.tags, d.url, d.pubDate, d.hero)
    ),
  ];
  await env.DB.batch(statements);
  return new Response(JSON.stringify({ ok: true, chunk: Number(chunkParam), indexed: docs.length }), { headers: JSON_HEADERS });
}

/**
 * Keep the D1 FTS index in sync with the deployed corpus. Runs on a frequent
 * cron: compares the corpus build stamp (search-data/manifest.json) with the
 * version recorded in admin_config and reloads every chunk when they differ.
 * Cheap no-op when nothing changed, so a fresh deploy is picked up within
 * one cron interval with no manual reindexing.
 */
async function syncSearchIndex(env: Env): Promise<void> {
  const res = await env.ASSETS.fetch(new URL('/search-data/manifest.json', env.SITE_URL));
  if (!res.ok) return;
  const manifest = (await res.json()) as { chunks: number; documents: number; generatedAt: string };

  const current = await env.DB.prepare(`SELECT value FROM admin_config WHERE key = 'search_index_version'`).first<{ value: string }>();
  if (current?.value === manifest.generatedAt) return;

  console.log(`search index sync: ${manifest.documents} docs in ${manifest.chunks} chunks (${manifest.generatedAt})`);
  for (let i = 0; i < manifest.chunks; i++) {
    const asset = await env.ASSETS.fetch(new URL(`/search-data/chunk-${String(i).padStart(3, '0')}.json`, env.SITE_URL));
    if (!asset.ok) { console.error(`chunk ${i} missing (HTTP ${asset.status})`); return; }
    const docs = (await asset.json()) as Array<Record<string, string>>;
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM articles_fts WHERE url IN (${docs.map(() => '?').join(',')})`).bind(...docs.map((d) => d.url)),
      ...docs.map((d) =>
        env.DB.prepare(
          `INSERT INTO articles_fts (title, description, body, author, categories, tags, url, pub_date, hero)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(d.title, d.description, d.body, d.author, d.categories, d.tags, d.url, d.pubDate, d.hero)
      ),
    ]);
  }
  await env.DB.prepare(
    `INSERT INTO admin_config (key, value) VALUES ('search_index_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(manifest.generatedAt).run();
  console.log('search index sync complete');
}

// ---------------------------------------------------------------- digest

async function sendDailyDigest(env: Env): Promise<void> {
  const feed = await env.ASSETS.fetch(new URL('/feed.xml', env.SITE_URL));
  const xml = await feed.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const now = Date.now();
  const fresh = items
    .map((item) => ({
      title: decodeEntities(item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? ''),
      link: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '',
      description: decodeEntities(item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] ?? ''),
      pubDate: new Date(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? 0).getTime(),
    }))
    .filter((i) => now - i.pubDate < 24 * 3600 * 1000);
  if (fresh.length === 0) return;

  const subs = await env.DB.prepare(`SELECT email, token FROM subscribers WHERE status = 'confirmed'`).all<{ email: string; token: string }>();
  if (!subs.results?.length) return;

  const list = fresh
    .map((i) => `<h3 style="margin:18px 0 4px;"><a href="${i.link}">${i.title}</a></h3><p style="margin:0;">${i.description}</p>`)
    .join('');

  for (const sub of subs.results) {
    const unsubscribe = `${env.SITE_URL}/api/newsletter/unsubscribe?token=${sub.token}`;
    await sendEmail(env, {
      to: sub.email,
      subject: `Daily Digest: ${fresh[0].title}`,
      html: `<h2>Intellectual Takeout Daily Digest</h2>${list}
             <p style="margin-top:28px;font-size:12px;color:#777;">
               <a href="${unsubscribe}">Unsubscribe</a></p>`,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
    });
  }

  await env.DB.prepare(`INSERT INTO sends (subject, article_count, recipient_count) VALUES (?, ?, ?)`)
    .bind(`Daily Digest: ${fresh[0].title}`, fresh.length, subs.results.length)
    .run();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------- email adapter

async function sendEmail(
  env: Env,
  msg: { to: string; subject: string; html: string; headers?: Record<string, string> }
): Promise<void> {
  const provider = env.EMAIL_PROVIDER ?? 'log';

  if (provider === 'resend' && env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? 'Intellectual Takeout <newsletter@intellectualtakeout.org>',
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        headers: msg.headers,
      }),
    });
    if (!r.ok) console.error('resend error', r.status, await r.text());
    return;
  }

  // 'log' provider: no ESP configured yet — record intent so signups aren't lost.
  console.log(`[email:${provider}] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
}
