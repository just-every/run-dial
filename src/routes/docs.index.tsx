import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "../core/features/public-site/docs/DocsPage";
import { docsHead } from "../core/features/public-site/docs/head";
import { loadDocsPage } from "../core/features/public-site/docs/load";

/**
 * DOCS-001. The docs home: docs/overview.md, rendered at build time (docs/site.json lists every page). The page content is a
 * build artifact, never a workspace read.
 */
export const Route = createFileRoute("/docs/")({
  loader: () => loadDocsPage(""),
  head: ({ loaderData }) => docsHead(loaderData?.page),
  component: withEditorLeaf(DocsHome),
});

function DocsHome() {
  return <DocsPage {...Route.useLoaderData()} />;
}
