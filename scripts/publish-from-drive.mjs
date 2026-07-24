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
import { execFileSync } from 'node:child_process';
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

const extractedImages = [];
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
      const src = `/wp-content/uploads/drive/${name}`;
      extractedImages.push(src);
      return { src };
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

// The first embedded image becomes the featured image; drop its inline
// occurrence so it doesn't render twice (hero + body).
if (extractedImages.length) {
  body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${extractedImages[0].replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\)\\n?`), '').trim();
}

// Title: directive > first heading > filename.
let title = directives.title ?? '';
const h1 = /^#\s+(.+)$/m.exec(body);
if (!title && h1) {
  title = h1[1].trim();
  body = body.replace(h1[0], '').trim();
}
if (!title) title = basename(input).replace(/\.docx$/i, '').replace(/[-_]+/g, ' ');

const dateSrc = directives.publish || opt('date') || '';
const date = dateSrc ? new Date(dateSrc) : new Date();
if (isNaN(date.getTime())) {
  console.error(`Unparseable publish date: ${JSON.stringify(dateSrc)}`);
  process.exit(1);
}
const yyyy = String(date.getFullYear());
const mm = String(date.getMonth() + 1).padStart(2, '0');
const slug = title
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 70);

/**
 * Byline detection, most-trusted first:
 *   1. `Author:` directive in the document
 *   2. filename prefix "Jane Doe - Title.docx" IF it matches a known author
 *   3. the .docx creator metadata Word stamps automatically (dc:creator),
 *      preferred when it matches a known author, else used if it looks like
 *      a real full name
 *   4. --author flag (the Drive uploader/owner — last resort)
 * Names are matched against src/data/authors.json; known authors keep their
 * existing slug and canonical casing, new authors are registered.
 */
const authorsPath = join(process.cwd(), 'src/data/authors.json');
const knownAuthors = existsSync(authorsPath) ? JSON.parse(readFileSync(authorsPath, 'utf8')) : [];
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
const findKnown = (name) => (name ? knownAuthors.find((a) => norm(a.name) === norm(name)) : undefined);

function docxCreator(path) {
  try {
    const xml = execFileSync('unzip', ['-p', path, 'docProps/core.xml'], { encoding: 'utf8', maxBuffer: 1e6 });
    const m = /<dc:creator>([^<]{2,80})<\/dc:creator>/.exec(xml);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

let author = '';
let authorSource = '';
if (directives.author) {
  author = directives.author; authorSource = 'directive';
}
if (!author) {
  const fm = /^(.{3,50}?)\s+-\s+/.exec(basename(input));
  if (fm && findKnown(fm[1])) { author = fm[1]; authorSource = 'filename'; }
}
if (!author) {
  const creator = docxCreator(input);
  if (creator && findKnown(creator)) { author = creator; authorSource = 'docx-metadata'; }
  else if (creator && /^[\p{L}'.-]+\s+[\p{L}'. -]+$/u.test(creator) && !/microsoft|user|admin|owner/i.test(creator)) {
    author = creator; authorSource = 'docx-metadata-unverified';
  }
}
if (!author) { author = opt('author', 'Intellectual Takeout'); authorSource = 'uploader'; }

const match = findKnown(author);
if (match) author = match.name; // canonical casing
const authorSlug = match?.slug ?? author.toLowerCase().replace(/[^a-z0-9]+/g, '');
if (!match && author !== 'Intellectual Takeout') {
  knownAuthors.push({ slug: authorSlug, name: author, count: 1 });
  writeFileSync(authorsPath, JSON.stringify(knownAuthors, null, 1));
  console.error(`new author registered: ${author} (${authorSlug})`);
}
console.error(`byline: ${author} [via ${authorSource}]`);
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
  ...(extractedImages.length ? [`heroImage: ${JSON.stringify(extractedImages[0])}`] : []),
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
