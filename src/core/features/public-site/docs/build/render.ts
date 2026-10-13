import { createElement } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import gfm from 'remark-gfm';
import type { DocsTocEntry } from '../types.ts';
import { docsHast } from './hast.ts';
import type { HastState } from './hast.ts';
import { highlight } from './highlight.ts';
import { inlineCode } from './inline-code.ts';
import type { AnchorCheck, LinkContext } from './links.ts';
import { createSlugger } from './slug.ts';

// One Markdown file to static HTML with the app's own react-markdown 6 and remark-gfm 1. Raw HTML is never rendered as
// markup (the hast pass reports it as a problem), and the output carries classes only: no style or event attributes.

export type RenderedPage = {
  title: string;
  titleId: string;
  description: string;
  html: string;
  toc: DocsTocEntry[];
  /** Every heading id on the page, the title's first. */
  ids: string[];
  anchors: AnchorCheck[];
  /** Repository paths of the page's images, in the order of their tokens in `html`. */
  images: string[];
  problems: string[];
};

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] };
const textOf = (node: HastNode): string => node.value ?? (node.children ?? []).map(textOf).join('');

function code({ inline, className, children }: { inline?: boolean; className?: string; children?: ReactNode }) {
  if (inline) return inlineCode(Array.isArray(children) ? children.join('') : String(children ?? ''));
  const language = /(?:^|\s)language-(\S+)/.exec(className ?? '')?.[1] ?? '';
  const text = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  const highlighted = highlight(text, language);
  const props = { className: language ? `language-${language}` : undefined };
  return highlighted === null ? createElement('code', props, text) : createElement('code', { ...props, dangerouslySetInnerHTML: { __html: highlighted } });
}

const label = (text: string) => text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;

/**
 * A code block keeps its lines whole and scrolls sideways when a line cannot fit; it is focusable and labelled, so keyboard
 * users can scroll it too. A group, not a region: a page has several, and landmarks must be unique. Its name is its first
 * command, with any shell line continuations joined, so a screen reader can tell a page's blocks apart.
 */
function pre({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const block = node?.children?.find(child => child.tagName === 'code');
  const command = (block ? textOf(block) : '').replace(/\\\n\s*/g, '').split('\n').map(line => line.trim()).find(Boolean);
  return createElement('pre', { className: 'docs-code', role: 'group', tabIndex: 0, 'aria-label': label(command ? `Code: ${command}` : 'Code') }, children);
}

/** Tables scroll inside a labelled, focusable region when they cannot fit, so keyboard users can scroll them too. */
function table({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const head = node?.children?.find(child => child.tagName === 'thead');
  const cells = head?.children?.find(child => child.tagName === 'tr')?.children?.filter(child => child.tagName === 'th') ?? [];
  const names = cells.map(cell => textOf(cell).replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');
  return createElement('div', { className: 'docs-table', role: 'region', tabIndex: 0, 'aria-label': label(`Table: ${names}`) },
    createElement('table', null, children));
}

export function renderPage(markdown: string, links: LinkContext): RenderedPage {
  const state: HastState = { slug: createSlugger(), links, title: '', titleId: '', description: '', toc: [], ids: [], anchors: [], images: [], problems: [] };
  const html = renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [gfm],
    rehypePlugins: [[docsHast, state]],
    components: { code, pre, table },
    children: markdown,
  }));
  return {
    title: state.title,
    titleId: state.titleId,
    description: state.description || `${state.title}: Dial documentation.`,
    html,
    toc: state.toc,
    ids: state.titleId ? [state.titleId, ...state.ids] : state.ids,
    anchors: state.anchors,
    images: state.images,
    problems: state.problems,
  };
}
