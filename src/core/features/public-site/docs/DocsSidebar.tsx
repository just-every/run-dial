import { useContext } from 'react';
import { contractPath } from '../chrome/links';
import { SiteVariantContext } from '../chrome/context';
import { DocsNavList } from './DocsNavList';
import type { DocsSection } from './types';

/** The section navigation beside the page, from 861px. The run site adds its contract page after the sections. */
export function DocsSidebar({ sections, current }: { sections: DocsSection[]; current: string }) {
  const site = useContext(SiteVariantContext) === 'site';
  return <nav className="docs-sidebar" aria-label="Documentation">
    <DocsNavList sections={sections} current={current} idPrefix="docs-sidebar" />
    {site ? <div className="docs-nav-group"><ul><li><a href={contractPath}>Contract</a></li></ul></div> : null}
  </nav>;
}
