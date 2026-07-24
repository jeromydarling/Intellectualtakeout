#!/usr/bin/env node
/**
 * Convert a Word document (.docx) into a publishable article markdown file.
 *
 * Used by the Google Drive publishing pipeline: authors drop .docx files into
 * the shared "Publish" folder on Drive; the scheduled Claude session downloads
 * each new file and runs this script, then reviews/enriches the frontmatter
 * (description, category, tags) before committing.
 *
 * Usage:
 *   node scripts/publish-from-drive.mjs <input.docx> --author "Jane Doe" [--date 2026-08-01] [--category Culture]
 *
 * Directives may also be given at the top of the document itself, one per line:
 *   Category: Culture
 *   Tags: history, education
 *   Publish: 2026-08-01
 *   Description: A short SEO description.
 * These lines are removed from the article body.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import mammoth from 'mammoth';
import TurndownService from 'turndown';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('Usage: node scripts/publish-from-drive.mjs <input.docx> [--author NAME] [--date YYYY-MM-DD] [--category NAME]');
  process.exit(1);
}
const opt = (name, dflt = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const { value: html, messages } = await mammoth.convertToHtml(
  { buffer: readFileSync(input) },
  {
    convertImage: mammoth.images.imgElement(async (image) => {
      // Embedded images are written next to the article and served from
      // /wp-content/uploads/drive/ (mirrored to R2 by the publish routine).
      const ext = image.contentType.split('/')[1] ?? 'png';
      const name = `img-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const dir = join(process.cwd(), 'drive-media');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), Buffer.from(await image.readAsBase64String(), 'base64'));
      return { src: `/wp-content/uploads/drive/${name}` };
    }),
  }
);
for (const m of messages) console.error('mammoth:', m.message);

const td = new TurndownService({ headingStyle: 'atx', emDelimiter: '_' });
let body = td.turndown(html);

// Pull directives from the top of the document.
const directives = {};
body = body
  .split('\n')
  .filter((line, idx) => {
    if (idx < 12) {
      const m = /^(Category|Tags|Publish|Description|Title|Author)\s*:\s*(.+)$/i.exec(line.trim());
      if (m) {
        directives[m[1].toLowerCase()] = m[2].trim();
        return false;
      }
    }
    return true;
  })
  .join('\n')
  .trim();

// Title: directive > first heading > filename.
let title = directives.title ?? '';
const h1 = /^#\s+(.+)$/m.exec(body);
if (!title && h1) {
  title = h1[1].trim();
  body = body.replace(h1[0], '').trim();
}
if (!title) title = basename(input).replace(/\.docx$/i, '').replace(/[-_]+/g, ' ');

const date = new Date(directives.publish ?? opt('date') ?? Date.now());
const yyyy = String(date.getFullYear());
const mm = String(date.getMonth() + 1).padStart(2, '0');
const slug = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70);

const author = directives.author ?? opt('author', 'Intellectual Takeout');
const authorSlug = author.toLowerCase().replace(/[^a-z0-9]+/g, '');
const categories = (directives.category ?? opt('category', 'Culture')).split(/\s*,\s*/);
const tags = directives.tags ? directives.tags.split(/\s*,\s*/) : [];
const description = directives.description ?? body.replace(/[#>*_\[\]!]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);

const fm = [
  '---',
  `title: ${JSON.stringify(title)}`,
  `description: ${JSON.stringify(description)}`,
  `pubDate: ${JSON.stringify(date.toISOString())}`,
  `author: ${JSON.stringify(author)}`,
  `authorSlug: ${JSON.stringify(authorSlug)}`,
  `categories: [${categories.map((c) => JSON.stringify(c)).join(', ')}]`,
  `categorySlugs: [${categories.map((c) => JSON.stringify(c.toLowerCase().replace(/[^a-z0-9]+/g, '-'))).join(', ')}]`,
  `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
  '---',
].join('\n');

const outDir = join(process.cwd(), 'src/content/articles', yyyy, mm);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${slug}.md`);
if (existsSync(outPath)) {
  console.error(`Refusing to overwrite existing article: ${outPath}`);
  process.exit(2);
}
writeFileSync(outPath, fm + '\n\n' + body + '\n');
console.log(outPath);
