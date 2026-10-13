import { DocsFlourish } from './DocsFlourish';
import { DocsTocCompact } from './DocsToc';
import type { DocsPageData } from './types';

/** The page's title and its body, rendered from Markdown at build time. */
export function DocsArticle({ page, section }: { page: DocsPageData; section: string }) {
  return <>
    <header className="docs-page-head">
      <p className="docs-eyebrow">{section}</p>
      <h1 id={page.titleId} className="docs-title">{page.title}</h1>
      <DocsFlourish />
    </header>
    <DocsTocCompact toc={page.toc} />
    <div className="docs-prose" dangerouslySetInnerHTML={{ __html: page.html }} />
  </>;
}
