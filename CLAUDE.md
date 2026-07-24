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
