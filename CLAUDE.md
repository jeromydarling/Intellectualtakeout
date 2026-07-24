# Intellectual Takeout — site guide for Claude

Static Astro site + Cloudflare Worker, migrated from WordPress. Claude acts as
the CMS: articles are Markdown files in git; pushing to the deploy branch
triggers a Cloudflare Workers build.

## Layout

- `src/content/articles/YYYY/MM/slug.md` — one file per article. The file path
  IS the URL (`/YYYY/MM/slug/`), mirroring the old WordPress permalinks. Do not
  rename files of already-published articles.
- `src/content/pages/*.md` — static pages (about, contact, …); `urlPath`
  frontmatter controls the URL.
- `src/data/{authors,categories,tags}.json` — taxonomy metadata used for
  archive pages. A new author/category/tag must be added here to get an
  archive page.
- `worker/index.ts` — edge worker: `/feed/` RSS, `/wp-content/uploads/*` media
  from R2 (lazy backfill from legacy origin), `/api/newsletter/*` (D1),
  scheduled daily digest.
- `wrangler.jsonc` — bindings: D1 `DB` (intellectualtakeout-newsletter),
  R2 `MEDIA` (intellectualtakeout-media), assets from `dist/`.

## Article frontmatter

```yaml
title: "..."
description: "SEO/social description, <= 300 chars"
pubDate: "2026-07-16T15:00:58Z"   # controls sort order; NOT the URL
author: "Jane Doe"
authorSlug: "janedoe"             # must match src/data/authors.json
categories: ["Culture"]
categorySlugs: ["culture"]
tags: ["history"]
heroImage: "/wp-content/uploads/2026/07/example.webp"
```

## Publishing workflow (Google Drive)

Authors drop `.docx` files in the shared Drive "Publish" folder. The publish
routine downloads new files and runs
`node scripts/publish-from-drive.mjs <file.docx> --author "Name"`, then reviews
the generated markdown (description, category, slug), moves any extracted
images from `drive-media/` into R2 under `wp-content/uploads/drive/`, commits,
and pushes. In-document directives (`Category:`, `Tags:`, `Publish:`,
`Description:` on the first lines) override defaults.

## Search

Full-text search runs on D1 (SQLite FTS5, porter stemming, BM25 ranking).
`npm run build` regenerates the corpus as static chunks in `dist/search-data/`;
the worker's `POST /api/search/reindex?chunk=N` endpoint loads a chunk into
D1, authenticated by the `reindex_token` row in the `admin_config` table (not
stored in the repo). After deploying content changes, refresh the index with
`REINDEX_TOKEN=… ./scripts/reindex-search.sh https://intellectualtakeout.org`
(or reindex only changed chunks). Queries: `GET /api/search?q=…&page=N`.

## Feature APIs (worker)

- `GET /api/ask?q=&answer=1` — semantic search (+ cited answer). Index lives in
  R2 `ask-index/`; rebuild after content changes: `POST /api/ask/embed?chunk=N`
  for new chunks then `POST /api/ask/build` (admin token).
- `GET /api/related?url=` — embedding nearest-neighbors, powers article
  "Read More" via client fetch.
- `GET /api/mostread?window=24h|7d|30d` — real read counts (worker counts
  every article view into D1 `page_views`; no cookies).
- `GET /og/<article-path>card.png`, `/og/quote.png?text=` — edge-generated
  share cards (workers-og), cached in R2 `og-cache/`.
- `/audio/<article-path>.mp3`, `/podcast.xml` — TTS narration (Workers AI
  melotts) from R2 `audio/`; the half-hourly cron narrates one article per
  run, newest first; `POST /api/audio/generate?path=` (admin) for a specific one.
- Newsletter: subscribers carry `frequency` (daily/weekly) and `categories`;
  daily digest cron 12:00 UTC, weekly best-of Sun 13:00 UTC, both with an
  AI editor's intro and a From-the-Archive slot.
- Curated collections: `src/content/collections/*.md` (frontmatter
  `articleUrls`) render at `/collections/<slug>/`.

## Commands

- `npm run build` — full static build (~6 min, ~13k pages). Cloudflare Workers
  Builds runs this then `wrangler deploy`.
- `npm run dev` — local dev (slow to start with 10k files; prefer building a
  subset when iterating on design).

## Cutover checklist (do NOT skip)

1. Finish mirroring `wp-content/uploads` into the R2 bucket (or let the lazy
   backfill run warm), then set `LEGACY_MEDIA_ORIGIN` to `""` in wrangler.jsonc
   BEFORE pointing DNS at the worker — otherwise the media proxy loops.
2. Configure real email sending (`EMAIL_PROVIDER=resend` + `RESEND_API_KEY`
   secret, or Cloudflare's outbound email when available) and SPF/DKIM DNS.
3. Crawl the old sitemap and verify URL parity.
