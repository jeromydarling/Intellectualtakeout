# Intellectual Takeout — Feature Roadmap

What would set this site apart, given its unusual advantages: a 20-year,
10,830-article archive; Claude in the publishing loop; and a full edge stack
(Workers, D1, R2, Workers AI) with no CMS overhead. Ordered by leverage.

## Tier 1 — Compounding wins (do soon)

### 1. "Ask the Archive" — semantic search & cited answers
Embed all 10,830 articles with Workers AI + Vectorize. Two payoffs:
- **Semantic search**: "articles about why kids should read old books" works
  even when no keyword matches. Falls back alongside the existing FTS5 search.
- **Ask Intellectual Takeout**: a reader asks a question, gets a short answer
  synthesized *only* from the archive, with citations linking to the articles.
  No mainstream outlet offers this; for a publication whose brand is "feeding
  minds," letting readers interrogate 20 years of thought is a signature
  feature. Runs entirely on Cloudflare (Vectorize + Workers AI or Claude API).

### 2. Automatic internal linking & topic hubs
The archive is the SEO moat, but 10k articles are invisible without paths in.
- On each publish, Claude finds the 5 most related archive pieces and links
  them in-body and in "Read More" — compounding internal link equity.
- Curated **Collections**: evergreen landing pages ("The Homeschooling
  Library", "Tocqueville in America", "Read This Before College") assembled by
  Claude from the archive, each a rankable, shareable hub. A weekly routine
  can mint one collection at a time.

### 3. Real "Most Read" + zero-cookie analytics
Enable Cloudflare Web Analytics (free, no cookie banner needed) and feed the
homepage "Most Read" tabs from the real numbers via a small worker cron —
restoring the WordPress feature with live data instead of recency stand-ins.

### 4. Auto-generated share cards ("Shareable Snacks", industrialized)
Generate branded Open Graph images per article at the edge (satori/resvg in a
worker): headline, author, hero image, logo. Every link share on X/Facebook/
iMessage becomes a designed card. Add a "share this quote" button that turns
any selected passage into a quote-card image — the site's old "Shareable
Snacks" concept, but on every paragraph of every article.

## Tier 2 — Audience builders

### 5. Audio articles + podcast feed
The old site experimented with Play.ht. Do it natively: TTS narration per
article (Workers AI or ElevenLabs), an audio player on the page, and an
auto-generated podcast RSS feed ("Intellectual Takeout Audio") so the entire
site doubles as a podcast in Apple/Spotify. Costs pennies per article and
converts commuters into subscribers.

### 6. Newsletter 2.0
The plumbing (D1 + double opt-in + daily cron) is live. Differentiators:
- Category preferences at signup (daily digest vs weekly best-of; Culture vs
  Politics only, etc.) — one extra column in D1.
- Claude writes a short editor's intro for each issue (it already reads every
  article it publishes).
- Sunday "Best of the Week" edition selected by actual read data (see #3).
- "From the Archive" slot in every issue — resurfacing one timeless piece
  daily is free content from the 10k backlog.

### 7. Web push for breaking posts
One-click browser notifications (no email required) via the standard Push
API — a worker + D1 table for subscriptions. Good fit for the Breaking News
category; very few small publications do this well.

### 8. Reader accounts-lite: favorites & reading lists
The WP site had a favorites plugin. Rebuild without logins: localStorage
lists, shareable via URL. Optional email-linked sync later using the
newsletter identity — no passwords, magic links only.

## Tier 3 — Revenue & community (post-cutover)

### 9. Membership
Stripe + D1: ad-free reading, members-only newsletter, early access, annual
"best of" ebook (Claude can assemble it from the archive automatically).
The Stripe MCP connector is already available for the build.

### 10. Claude-moderated comments
Lightweight D1-backed comments where Claude pre-screens every submission
against a civility policy before it appears — "rational discourse" enforced
by the platform itself. On-brand, and nobody else's comment section works
this way.

### 11. Archive maintenance routine
A weekly Claude routine that walks old articles: fixes dead external links
(pointing to archive.org where needed), flags factual staleness, and
refreshes descriptions. Keeps 20 years of content credible and crawlable.

## Already done (baseline)

Static Astro site on Workers · full content migration with preserved URLs ·
faithful design recreation · FTS5 search with BM25 + self-syncing index ·
RSS at /feed/ · sitemap/OG/JSON-LD SEO layer · R2 media mirror with legacy
backfill · D1 newsletter with double opt-in + daily digest cron · Google
Drive .docx → published article pipeline (hourly routine).
