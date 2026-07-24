import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;

let cached: Article[] | null = null;

/** All published articles, newest first. */
export async function allArticles(): Promise<Article[]> {
  if (cached) return cached;
  const items = await getCollection('articles', ({ data }) => !data.draft);
  items.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
  cached = items;
  return items;
}

/** Canonical path for an article: /YYYY/MM/slug/ (mirrors WordPress permalinks). */
export function articlePath(article: Article): string {
  const d = article.id.split('/'); // articles are stored as YYYY/MM/slug
  return `/${d[0]}/${d[1]}/${d.slice(2).join('/').replace(/\.md$/, '')}/`;
}

export function byCategory(items: Article[], slug: string): Article[] {
  return items.filter((a) => a.data.categorySlugs.includes(slug));
}

export function byAuthor(items: Article[], slug: string): Article[] {
  return items.filter((a) => a.data.authorSlug === slug);
}

export function byTag(items: Article[], tagSlugOrName: string): Article[] {
  const needle = tagSlugOrName.toLowerCase();
  return items.filter((a) => a.data.tags.some((t) => slugify(t) === needle));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}
