import { posix } from 'node:path';

// Link rules for Markdown rendered on the site. A link to a published file becomes its /docs page; a link to any other
// file or directory in the repository goes to GitHub; external links stay. Anything else is a problem the build reports.

export type PathKind = 'file' | 'directory' | null;

export type LinkContext = {
  /** The repository path of the Markdown file being rendered. */
  source: string;
  repository: { url: string; branch: string };
  /** Published Markdown sources and their site hrefs. */
  published: ReadonlyMap<string, string>;
  /** Whether a repository path is a file, a directory or missing. */
  kind: (path: string) => PathKind;
};

/** An anchor the build must find among the headings of `source` once every page is rendered. */
export type AnchorCheck = { source: string; id: string };

type HrefResult = { href: string; anchor?: AnchorCheck } | { problem: string };
type ImageResult = { path: string } | { problem: string };

const mediaDirectory = 'docs/media/';

const decode = (value: string) => {
  try { return decodeURIComponent(value); } catch { return null; }
};

/** Resolves a relative link against the Markdown file's directory; null when it leaves the repository. */
function resolvePath(source: string, path: string) {
  const resolved = posix.normalize(posix.join(posix.dirname(source), path)).replace(/\/$/, '');
  return resolved === '..' || resolved.startsWith('../') || resolved === '.' ? null : resolved;
}

export function rewriteHref(href: string, context: LinkContext): HrefResult {
  if (/^(https?:|mailto:)/i.test(href)) return { href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { problem: `${href} (unsupported link scheme)` };
  const hashAt = href.indexOf('#');
  const rawPath = hashAt === -1 ? href : href.slice(0, hashAt);
  const rawHash = hashAt === -1 ? '' : href.slice(hashAt + 1);
  const hash = decode(rawHash);
  if (hash === null || (hashAt !== -1 && !hash)) return { problem: `${href} (malformed anchor)` };
  if (!rawPath) return { href, anchor: { source: context.source, id: hash } };
  if (rawPath.startsWith('/') || rawPath.includes('?')) return { problem: `${href} (use a path relative to ${context.source})` };
  const decoded = decode(rawPath);
  const path = decoded === null ? null : resolvePath(context.source, decoded);
  if (path === null) return { problem: `${href} (outside the repository)` };
  const kind = context.kind(path);
  if (!kind) return { problem: `${href} (${path} does not exist)` };
  const suffix = hash ? `#${rawHash}` : '';
  const anchor = hash ? { source: path, id: hash } : undefined;
  if (hash && !path.endsWith('.md')) return { problem: `${href} (an anchor can only point into a Markdown file)` };
  const site = context.published.get(path);
  if (site !== undefined) return { href: site + suffix, anchor };
  const { url, branch } = context.repository;
  return { href: `${url}/${kind === 'directory' ? 'tree' : 'blob'}/${branch}/${path}${suffix}`, anchor };
}

/** Images may come only from docs/media, by a path relative to the Markdown file, with alt text. */
export function rewriteImageSrc(src: string, alt: string, context: LinkContext): ImageResult {
  if (!alt.trim()) return { problem: `${src} (image has no alt text)` };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('//')) return { problem: `${src} (images must be files in ${mediaDirectory})` };
  const decoded = decode(src.split(/[?#]/)[0]);
  const path = decoded === null ? null : resolvePath(context.source, decoded);
  if (path === null || !path.startsWith(mediaDirectory)) return { problem: `${src} (images must be files in ${mediaDirectory})` };
  if (context.kind(path) !== 'file') return { problem: `${src} (${path} does not exist)` };
  return { path };
}
