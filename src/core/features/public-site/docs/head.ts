import { primaryFontPreload } from '../chrome/font-head';
import type { DocsPageData } from './types';

/** Title and description for a docs page. Without a page (a 404) the root's not-found head applies. */
export function docsHead(page: DocsPageData | undefined) {
  if (!page) return {};
  return {
    links: [primaryFontPreload],
    meta: [
      { title: page.slug ? `${page.title} · Dial docs` : 'Dial docs' },
      { name: 'description', content: page.description },
    ],
  };
}
