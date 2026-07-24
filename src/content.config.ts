import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Intellectual Takeout'),
    authorSlug: z.string().default('intellectual-takeout'),
    categories: z.array(z.string()).default([]),
    categorySlugs: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    wpId: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date().optional(),
    urlPath: z.string(),
    wpId: z.string().optional(),
  }),
});

const curated = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/collections' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    intro: z.string().optional(),
    heroImage: z.string().optional(),
    articleUrls: z.array(z.string()),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { articles, pages, curated };
