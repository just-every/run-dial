import type { SiteVariant } from '../chrome/context';
import { SiteFrame } from '../chrome';
import { DocsArticle } from './DocsArticle';
import { DocsMenu } from './DocsMenu';
import { DocsPager } from './DocsPager';
import { DocsSidebar } from './DocsSidebar';
import { DocsToc } from './DocsToc';
import type { DocsView } from './types';
import { useCurrentDocs } from './useCurrentDocs';
import './docs.css';

/** A documentation page in the public site's frame: sidebar | page | contents. The page title is the document's one h1. */
export function DocsPage({ page, sections, repository, version, variant = "installed" }: DocsView & { variant?: SiteVariant }) {
  useCurrentDocs(version);
  const order = sections.flatMap(section => section.pages.map(entry => ({ ...entry, section: section.title })));
  const index = order.findIndex(entry => entry.slug === page.slug);
  const current = order[index];
  return <SiteFrame variant={variant} page="docs" className="dial-docs" skipTo="docs-content">
    <div className="docs-shell">
      <DocsSidebar sections={sections} current={page.slug} />
      <main id="docs-content" tabIndex={-1} className="docs-main">
        <DocsMenu sections={sections} current={page.slug} label={current.label} />
        <DocsArticle page={page} section={current.section} />
        <DocsPager previous={order[index - 1]} next={order[index + 1]} editUrl={`${repository.url}/edit/${repository.branch}/${page.source}`} />
      </main>
      <DocsToc toc={page.toc} />
    </div>
  </SiteFrame>;
}
