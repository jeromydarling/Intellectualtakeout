import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { allArticles, articlePath } from '../lib/content';
import { SITE } from '../lib/site';

export async function GET(context: APIContext) {
  const articles = (await allArticles()).slice(0, 20);
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.url,
    trailingSlash: false,
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.description,
      link: articlePath(a),
      pubDate: a.data.pubDate,
      author: a.data.author,
      categories: a.data.categories,
    })),
    customData: '<language>en-us</language>',
  });
}
