/**
 * Edge-generated share cards.
 *   /og/:year/:month/:slug.png — branded Open Graph card for an article
 *   /og/quote.png?text=...&title=...&author=... — shareable quote card
 * Rendered with workers-og (satori), cached in R2.
 */
import { ImageResponse } from 'workers-og';
import type { Env } from './lib';
import { escapeHtml } from './lib';

let fontCache: { crimson: ArrayBuffer; montserrat: ArrayBuffer } | null = null;

async function loadFonts(env: Env) {
  if (fontCache) return fontCache;
  const [crimson, montserrat] = await Promise.all([
    env.ASSETS.fetch(new URL('/assets/fonts/crimson-pro-700.woff', env.SITE_URL)).then((r) => r.arrayBuffer()),
    env.ASSETS.fetch(new URL('/assets/fonts/montserrat-400.woff', env.SITE_URL)).then((r) => r.arrayBuffer()),
  ]);
  fontCache = { crimson, montserrat };
  return fontCache;
}

async function cachedPng(env: Env, key: string, render: () => Promise<Response>): Promise<Response> {
  const hit = await env.MEDIA.get(`og-cache/${key}`);
  if (hit) {
    return new Response(hit.body, {
      headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  }
  const res = await render();
  if (!res.ok) return res;
  const buf = await res.arrayBuffer();
  await env.MEDIA.put(`og-cache/${key}`, buf, { httpMetadata: { contentType: 'image/png' } });
  return new Response(buf, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}

async function heroDataUri(env: Env, hero: string): Promise<string | null> {
  try {
    let buf: ArrayBuffer | null = null;
    let type = 'image/jpeg';
    const obj = await env.MEDIA.get(hero.replace(/^\//, ''));
    if (obj) {
      buf = await obj.arrayBuffer();
      type = obj.httpMetadata?.contentType ?? type;
    } else if (env.LEGACY_MEDIA_ORIGIN) {
      const res = await fetch(`${env.LEGACY_MEDIA_ORIGIN}${hero}`);
      if (res.ok) {
        buf = await res.arrayBuffer();
        type = res.headers.get('content-type') ?? type;
      }
    }
    // satori/resvg rasterize only jpeg/png — skip webp/avif heroes (gradient fallback)
    if (!buf || buf.byteLength > 3_000_000 || !/jpe?g|png/.test(type)) return null;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

function articleFromFts(env: Env, path: string) {
  return env.DB.prepare(`SELECT title, author, pub_date AS pubDate, hero FROM articles_fts WHERE url = ?`)
    .bind(path)
    .first<{ title: string; author: string; pubDate: string; hero: string }>();
}

export async function ogArticle(env: Env, url: URL): Promise<Response> {
  const m = /^\/og(\/\d{4}\/\d{2}\/[^/]+\/)card\.png$/.exec(url.pathname);
  if (!m) return new Response('bad og path', { status: 400 });
  const path = m[1];
  return cachedPng(env, `article${path.replace(/\//g, '_')}.png`, async () => {
    const art = await articleFromFts(env, path);
    if (!art) return new Response('unknown article', { status: 404 });
    const fonts = await loadFonts(env);
    const hero = art.hero ? await heroDataUri(env, art.hero) : null;
    const bg = hero
      ? `background-image: url('${hero}'); background-size: cover; background-position: center;`
      : 'background: linear-gradient(135deg, #2e5c62 0%, #10353a 100%);';
    const html = `
      <div style="display:flex; width:1200px; height:630px; ${bg}">
        <div style="display:flex; flex-direction:column; justify-content:flex-end; width:1200px; height:630px; background: linear-gradient(180deg, rgba(10,30,33,0.15) 30%, rgba(10,30,33,0.92) 100%); padding:56px;">
          <div style="display:flex; font-family:Montserrat; font-size:26px; color:#9dd3d3; letter-spacing:4px; text-transform:uppercase; margin-bottom:18px;">Intellectual Takeout</div>
          <div style="display:flex; font-family:CrimsonPro; font-size:${art.title.length > 70 ? 54 : 66}px; color:#ffffff; line-height:1.08; max-width:1050px;">${escapeHtml(art.title)}</div>
          <div style="display:flex; font-family:Montserrat; font-size:26px; color:#d7dce0; margin-top:26px;">By ${escapeHtml(art.author || 'Intellectual Takeout')} · ${escapeHtml((art.pubDate || '').slice(0, 10))}</div>
        </div>
      </div>`;
    return new ImageResponse(html, {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'CrimsonPro', data: fonts.crimson, weight: 700, style: 'normal' },
        { name: 'Montserrat', data: fonts.montserrat, weight: 400, style: 'normal' },
      ],
    });
  });
}

export async function ogQuote(env: Env, url: URL): Promise<Response> {
  const text = (url.searchParams.get('text') ?? '').slice(0, 420);
  const title = (url.searchParams.get('title') ?? '').slice(0, 140);
  const author = (url.searchParams.get('author') ?? 'Intellectual Takeout').slice(0, 80);
  if (!text) return new Response('missing text', { status: 400 });

  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${text}|${title}|${author}`));
  const key = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return cachedPng(env, `quote-${key}.png`, async () => {
    const fonts = await loadFonts(env);
    const size = text.length > 260 ? 40 : text.length > 150 ? 48 : 58;
    const html = `
      <div style="display:flex; flex-direction:column; justify-content:space-between; width:1200px; height:630px; background: linear-gradient(135deg, #f6f4ef 0%, #e8efee 100%); padding:64px; border-left: 18px solid #3c757c;">
        <div style="display:flex; font-family:CrimsonPro; font-size:110px; color:#3c757c; height:70px;">“</div>
        <div style="display:flex; font-family:CrimsonPro; font-size:${size}px; color:#1c2a2c; line-height:1.25; max-width:1040px;">${escapeHtml(text)}</div>
        <div style="display:flex; flex-direction:column;">
          <div style="display:flex; font-family:Montserrat; font-size:24px; color:#3c757c;">${escapeHtml(author)}${title ? ' — ' + escapeHtml(title) : ''}</div>
          <div style="display:flex; font-family:Montserrat; font-size:20px; color:#7c8a8c; letter-spacing:3px; text-transform:uppercase; margin-top:10px;">intellectualtakeout.org</div>
        </div>
      </div>`;
    return new ImageResponse(html, {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'CrimsonPro', data: fonts.crimson, weight: 700, style: 'normal' },
        { name: 'Montserrat', data: fonts.montserrat, weight: 400, style: 'normal' },
      ],
    });
  });
}
