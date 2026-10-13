import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { imageTokenPattern } from './hast.ts';
import { buildSite } from './site.ts';
import type { Site, SitePage } from './site.ts';

// The docs pages, rendered from the repository's Markdown when Vite loads them: on every build, and in `vite dev`
// again whenever a Markdown file, docs/site.json or package.json changes. Any broken link or anchor fails the build.
// In `vite dev` the docs routes show the problem instead of a stale page, and every other route keeps working.
//
//   virtual:dial-docs              repository, sections, a lazy import per page, the version, and in dev the problem
//   virtual:dial-docs/page/<slug>  one page (the home page is "index"), each its own chunk

const docsModule = 'virtual:dial-docs';
const pagePrefix = `${docsModule}/page/`;
const resolvedPrefix = `\0${docsModule}`;

const pageModule = (slug: string) => `${pagePrefix}${slug || 'index'}`;

/** The docs as the tree has them: the site, or the one message that lists everything wrong with it, and which reading. */
type Docs = ({ site: Site; problem: null } | { site: Site | null; problem: string }) & { version: number };

function readDocs(root: string, version: number): Docs {
  try {
    const site = buildSite(root);
    if (!site.problems.length) return { site, problem: null, version };
    return { site, problem: `Docs: ${site.problems.length} broken link(s) or page problem(s) in the repository Markdown:\n${site.problems.map(problem => `  ${problem}`).join('\n')}`, version };
  } catch (error) {
    return { site: null, problem: `Docs: ${(error as Error).message}`, version };
  }
}

function indexCode({ site, problem, version }: Docs) {
  const pages = (site?.pages ?? []).map(page => `  ${JSON.stringify(page.slug)}: () => import(${JSON.stringify(pageModule(page.slug))}),`);
  return [
    `export const repository = ${JSON.stringify(site?.repository ?? null)};`,
    `export const sections = ${JSON.stringify(site?.sections ?? [])};`,
    `export const pages = {\n${pages.join('\n')}\n};`,
    `export const problem = ${JSON.stringify(problem)};`,
    `export const version = ${version};`,
  ].join('\n');
}

function pageCode(page: SitePage) {
  // Images are imported as URLs, so Vite serves them in dev and fingerprints them into the build.
  const imports = page.images.map((path, index) => `import image${index} from ${JSON.stringify(`/${path}?url`)};`);
  const html = page.html.split(imageTokenPattern).map((piece, index) => index % 2 ? `image${piece}` : JSON.stringify(piece));
  const { slug, source, title, titleId, description, toc } = page;
  return [...imports, `export default { ...${JSON.stringify({ slug, source, title, titleId, description, toc })}, html: ${html.join(' + ')} };`].join('\n');
}

/** The real path of a file that may be gone along with its folders: the nearest folder that still exists, resolved. */
function realpath(file: string): string {
  try { return realpathSync(file); } catch {
    const parent = dirname(file);
    return parent === file ? file : join(realpath(parent), basename(file));
  }
}

export function docsSite(): Plugin {
  let root = process.cwd();
  let serve = false;
  let docs: Docs | null = null;
  let readings = 0;
  let reload: ReturnType<typeof setTimeout> | undefined;
  const isDocsInput = (file: string) => {
    const path = relative(realpath(root), realpath(file)).split(sep).join('/');
    if (!path || path.startsWith('../') || isAbsolute(path)) return false;
    return path === 'docs/site.json' || path === 'package.json' || path.startsWith('docs/media/')
      || (path.endsWith('.md') && !path.split('/').includes('node_modules'));
  };
  return {
    name: 'dial:docs-site',
    configResolved(config) {
      root = config.root;
      serve = config.command === 'serve';
    },
    resolveId(id) {
      if (id === docsModule || id.startsWith(pagePrefix)) return `\0${id}`;
    },
    load(id) {
      if (!id.startsWith(resolvedPrefix)) return;
      const current = docs ??= readDocs(root, ++readings);
      for (const file of current.site?.files ?? []) this.addWatchFile(file);
      // In dev the index loads anyway and carries the problem: the docs routes throw it with its message
      // (src/core/features/public-site/docs/load.ts), and a page open since before the problem still sees its version move on and reloads.
      if (id === `\0${docsModule}` && serve) return indexCode(current);
      if (current.problem !== null) this.error(current.problem);
      if (id === `\0${docsModule}`) return indexCode(current);
      const slug = id.slice(`\0${pagePrefix}`.length);
      const page = current.site.pages.find(candidate => (candidate.slug || 'index') === slug);
      if (!page) this.error(`Docs: no page "${slug}" in docs/site.json`);
      return pageCode(page);
    },
    // Any Markdown file counts: a new, renamed or deleted file can fix or break a link. Runs in the client and Worker
    // environments, so both drop the docs modules before the browser reloads.
    hotUpdate({ file, server }) {
      if (!isDocsInput(file)) return;
      docs = null;
      const { moduleGraph } = this.environment;
      for (const [id, module] of moduleGraph.idToModuleMap) if (id.startsWith(resolvedPrefix)) moduleGraph.invalidateModule(module);
      // Only the browser reloads, once for a burst of events such as a folder of Markdown removed. The Worker needs no
      // reload: src/core/features/public-site/docs/load.ts imports the docs on every load, which refetches what was just invalidated, while a
      // Worker reload drops every module and fails the requests in flight, leaving an open tab on a bare 500.
      clearTimeout(reload);
      reload = setTimeout(() => server.environments.client.hot.send({ type: 'full-reload' }), 50);
      return [];
    },
  };
}
