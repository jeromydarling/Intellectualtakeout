# Intellectual Takeout — WordPress → Cloudflare Migration Plan

Goal: replace the WordPress site (intellectualtakeout.org) with a fast, static,
git-based site on Cloudflare, where Claude Code acts as the CMS. Authors write
in Microsoft Word, drop files in a Google Drive folder, and articles appear on
the site — no WordPress login, no admin panel.

## What we're migrating (verified against the live site)

| Item | Count / detail |
|---|---|
| Posts | 10,830 (REST API is open — full JSON export, no admin access needed) |
| Pages | 40 |
| Categories / tags | 23 / 192 |
| Media files | ~11,695 in `wp-content/uploads/` |
| Theme | "Pressroom" (news/magazine) + WPBakery page builder |
| Permalinks | `/YYYY/MM/slug/` |
| RSS feed | `/feed/` (must keep working at the same URL) |
| Authors | Hidden from REST API; recoverable from feed `dc:creator` + page bylines |

## Target architecture

- **Astro** static site deployed to **Cloudflare Workers** (static assets).
  Every article is a Markdown file with frontmatter (title, author, date,
  category, tags, description, hero image) in `src/content/articles/`.
  Git is the database; Claude Code is the CMS.
- **Cloudflare R2** serves all migrated images at the *same paths*
  (`/wp-content/uploads/...`) via a route on the domain — so 10,830 posts'
  image references keep working with zero content rewriting, and old inbound
  image links/Google Image results don't break.
- **Cloudflare D1** stores newsletter subscribers (email, status, token).
- **A small Worker** handles the dynamic bits: newsletter signup/confirm/
  unsubscribe endpoints and scheduled newsletter sends.

## Phase 1 — Content export & conversion

1. Pull all posts/pages/categories/tags via the WP REST API
   (`/wp-json/wp/v2/posts?per_page=100&_embed`, paginated — ~109 requests).
2. Recover author bylines from the RSS feed and per-post HTML (`dc:creator`),
   build an authors map, and store author slug in each article's frontmatter.
3. Convert rendered HTML → Markdown (strip WPBakery shortcode wrappers,
   preserve embeds, pull quotes, images, links). Spot-check a sample of ~50
   posts across years, then batch-convert with a QA pass that flags posts
   containing unconverted markup for manual review.
4. Preserve exact URL structure `/YYYY/MM/slug/` — no redirects needed, no
   SEO ranking loss from URL churn. Anything that must move gets a 301 in
   Cloudflare (`_redirects` / redirect rules).
5. Mirror `wp-content/uploads/` into R2 (enumerate via the media API +
   uploads referenced in content; rclone/wrangler bulk upload).
6. Keep the WordPress site untouched during all of this — the export is
   read-only. It stays up until cutover is verified.

## Phase 2 — Design

Recreate the Pressroom look as clean Astro components (we rebuild the visual
design the site owns — header/nav, homepage featured + section grids, article
template with byline/hero/related posts, category and author archive pages,
footer, newsletter signup blocks). Process:

1. Screenshot the key templates (home, article, category, author, static page).
2. Extract the palette, type scale, and spacing from the live CSS.
3. Rebuild with Astro + Tailwind; compare side-by-side screenshots until it
   matches (or improve where the owners want changes — this is the cheapest
   moment to modernize).

Note: we recreate the rendered design, not the theme's PHP/licensed code.

## Phase 3 — SEO, RSS, social

- Per-page `<title>`, meta description, canonical URL.
- Open Graph + Twitter Card tags on every article (title, description, hero
  image) → clean shares on Facebook/X/LinkedIn/Slack/iMessage.
- JSON-LD structured data: `NewsArticle`/`Article`, `Organization`,
  `BreadcrumbList`, `WebSite` with sitelinks search.
- `sitemap.xml` (index + chunks; 10k+ URLs), `robots.txt`.
- RSS at **`/feed/`** (same URL as WordPress) with full-content items, plus
  per-category feeds if wanted. `<link rel="alternate">` autodiscovery.
- 404 page, trailing-slash normalization matching WP behavior.
- Performance is itself SEO: static HTML from Cloudflare's edge should score
  ~100 on Core Web Vitals, far above a WPBakery WordPress stack.

## Phase 4 — Newsletter (Cloudflare email)

- Signup form → Worker → D1, with double opt-in (confirmation email with
  token link) and one-click unsubscribe (List-Unsubscribe headers).
- Sending: Cloudflare's native outbound email offering (Email Service /
  Email Workers send) is used if enabled on the account; Cloudflare Email
  Routing itself is inbound-only. If native sending isn't available on this
  account or volume exceeds its limits, the Worker calls an ESP API
  (e.g. Resend/Postmark/SES) — same code path, one adapter. Decision needed
  at build time based on subscriber count and what the account has access to.
- SPF/DKIM/DMARC DNS records so newsletters land in inboxes.
- A scheduled Worker (cron) or manual trigger compiles "new since last send"
  articles into a digest template and sends. Claude can draft/curate each
  issue as part of the publishing routine.

## Phase 5 — Google Drive → published article pipeline

Authors' workflow: write in Word → save the .docx into a shared Drive folder
("Publish" folder). Nothing else.

Pipeline (runs on a schedule — GitHub Action or a scheduled Claude Code
session/Routine):

1. Poll the Drive folder for new/updated .docx files.
2. Convert .docx → Markdown (mammoth/pandoc), extract embedded images and
   upload them to R2.
3. Claude fills the gaps a Word doc doesn't carry: SEO meta description,
   category/tag selection, slug, pull-quote formatting, hero image handling —
   and flags anything ambiguous instead of guessing.
4. Commit to the repo → Cloudflare auto-deploys → article is live in ~1 min.
5. Conventions for control without logins:
   - `Drafts/` subfolder = ignored; move to `Publish/` when ready.
   - Optional first-line directives in the doc (e.g. `Category: Culture`,
     `Publish: 2026-08-01`) for scheduling.
   - Pipeline writes a status note back to Drive (or emails the author) with
     the live URL or what needs fixing.

## Phase 6 — Cutover

1. Build and deploy to a `*.workers.dev` preview URL.
2. Parity check: crawl the old sitemap, verify every URL returns 200 with
   matching title/canonical on the new site; diff the RSS feeds.
3. Point the domain (already on Cloudflare DNS) at the Worker. Rollback is a
   one-line DNS change back to the WP origin.
4. Keep WordPress alive (locked, hidden origin) for ~2 weeks as a safety net,
   then decommission it and its hosting bill.

## What's needed from the site owners

1. **Cloudflare account access** — an API token (Workers, R2, D1, DNS) or
   confirmation the domain's DNS is already on Cloudflare (it appears to be).
2. **Google Drive** — create the shared folder and grant the pipeline access
   (this session already has Drive tooling connected for jeromy.darling@gmail.com).
3. **Newsletter decisions** — current subscriber list export (if one exists),
   sending volume, and whether the account has Cloudflare's outbound email
   enabled (else pick an ESP).
4. **Design direction** — pixel-faithful recreation of the current look, or
   take the opportunity to refresh it.
5. (Nice-to-have, not required) A WordPress admin export XML as a belt-and-
   suspenders backup alongside the API export.

## Suggested build order

1. Export + convert content, stand up the Astro skeleton (proves the hard part first).
2. Design recreation.
3. SEO/RSS/social layer.
4. Newsletter Worker + D1.
5. Drive publishing pipeline.
6. Parity check + cutover.

Each step lands on this repo's branch and is reviewable/deployable on its own.
