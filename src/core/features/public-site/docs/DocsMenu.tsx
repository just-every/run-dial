import { DocsNavList } from './DocsNavList';
import type { DocsSection } from './types';

/** The section navigation on phones and narrow windows: one pill that opens the full list. */
export function DocsMenu({ sections, current, label }: { sections: DocsSection[]; current: string; label: string }) {
  return <nav className="docs-menu" aria-label="Documentation">
    <details>
      <summary><span className="docs-menu-label">Docs menu</span> <span className="docs-menu-current">· {label}</span></summary>
      <div className="docs-menu-list"><DocsNavList sections={sections} current={current} idPrefix="docs-menu" /></div>
    </details>
  </nav>;
}
