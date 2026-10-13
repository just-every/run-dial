import { notFound } from '@tanstack/react-router';
import type { DocsView } from './types';

/** A /docs page ("" is the docs home) with the navigation it sits in; an unknown slug is the site's branded 404. */
export async function loadDocsPage(slug: string): Promise<DocsView> {
  // Imported on every load rather than once, so in `vite dev` the Worker reads the Markdown as it is now without reloading.
  const { pages, problem, repository, sections, version } = await import('virtual:dial-docs');
  // Only in `vite dev`: a broken link or page problem fails the docs routes with its message, and no other route.
  if (problem) throw new Error(problem);
  const load = Object.hasOwn(pages, slug) ? pages[slug] : undefined;
  if (!load) throw notFound();
  return { page: (await load()).default, repository, sections, version };
}
