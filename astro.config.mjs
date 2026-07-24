import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://intellectualtakeout.org',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/newsletter/'),
    }),
  ],
  build: {
    format: 'directory',
  },
});
