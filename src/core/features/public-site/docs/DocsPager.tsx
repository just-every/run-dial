import { DocsLink } from './DocsLink';
import type { DocsNavPage } from './types';

/** Previous and next in manifest order, then the page's source on GitHub. */
export function DocsPager({ previous, next, editUrl }: { previous?: DocsNavPage; next?: DocsNavPage; editUrl: string }) {
  return <>
    <nav className="docs-pager" aria-label="Previous and next pages">
      {previous && <DocsLink slug={previous.slug} className="docs-pager-card docs-pager-card--previous" rel="prev">
        <span className="docs-pager-arrow" aria-hidden="true">←</span><span className="docs-pager-text"><span className="docs-pager-label">Previous</span><span className="docs-pager-title">{previous.label}</span></span>
      </DocsLink>}
      {next && <DocsLink slug={next.slug} className="docs-pager-card docs-pager-card--next" rel="next">
        <span className="docs-pager-text"><span className="docs-pager-label">Next</span><span className="docs-pager-title">{next.label}</span></span><span className="docs-pager-arrow" aria-hidden="true">→</span>
      </DocsLink>}
    </nav>
    <p className="docs-source"><a href={editUrl}>Edit this page on GitHub</a></p>
  </>;
}
