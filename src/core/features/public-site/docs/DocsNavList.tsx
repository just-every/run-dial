import { DocsLink } from './DocsLink';
import type { DocsSection } from './types';

/** The sections and their pages, the current page marked. `idPrefix` keeps the sidebar's and the menu's ids apart. */
export function DocsNavList({ sections, current, idPrefix }: { sections: DocsSection[]; current: string; idPrefix: string }) {
  return <>
    {sections.map((section, index) => <div className="docs-nav-group" key={section.title}>
      <p className="docs-nav-section" id={`${idPrefix}-${index}`}>{section.title}</p>
      <ul aria-labelledby={`${idPrefix}-${index}`}>
        {section.pages.map(page => <li key={page.href}>
          <DocsLink slug={page.slug} aria-current={page.slug === current ? 'page' : undefined}>{page.label}</DocsLink>
        </li>)}
      </ul>
    </div>)}
  </>;
}
