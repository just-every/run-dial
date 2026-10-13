import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "../core/features/public-site/docs/DocsPage";
import { docsHead } from "../core/features/public-site/docs/head";
import { loadDocsPage } from "../core/features/public-site/docs/load";

/** DOCS-001. One documentation page, rendered at build time from the Markdown file docs/site.json lists for its slug. */
export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => loadDocsPage(params.slug),
  head: ({ loaderData }) => docsHead(loaderData?.page),
  component: withEditorLeaf(DocsArticlePage),
});

function DocsArticlePage() {
  return <DocsPage {...Route.useLoaderData()} />;
}
