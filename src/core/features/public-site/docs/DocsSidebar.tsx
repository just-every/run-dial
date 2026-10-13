import { DocsNavList } from './DocsNavList';
import type { DocsSection } from './types';

/** The section navigation beside the page, from 861px. */
export function DocsSidebar({ sections, current }: { sections: DocsSection[]; current: string }) {
  return <nav className="docs-sidebar" aria-label="Documentation">
    <DocsNavList sections={sections} current={current} idPrefix="docs-sidebar" />
  </nav>;
}
