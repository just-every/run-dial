import { RouteLoadError } from "./core/app/ui/route-load-error";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { installCompiledLiveEdits, setLiveEditsReady } from "../modules/editor/index";
import visualEdits from "./core/features/editor/visual-edits.json";
import { isPublicSitePath } from "./core/features/public-site/paths";

/**
 * Scroll restoration keeps each page's scroll position in session storage. A document opened on the public site keeps none
 * (HOME-001): the client decides once per document, because the router persists positions whenever it is enabled, and the
 * server renders no restoring script for a public-site page. Links between the public site and other surfaces load a new
 * document, so the public site is never shown inside a document that persists scroll positions.
 */
const scrollRestoration = typeof document === "undefined"
  ? ({ location }: { location: { pathname: string } }) => !isPublicSitePath(location.pathname)
  : !isPublicSitePath(window.location.pathname);

export function getRouter() {
  if (typeof document !== "undefined") {
    setLiveEditsReady(false);
    installCompiledLiveEdits(visualEdits);
  }
  return createRouter({ routeTree, scrollRestoration, defaultErrorComponent: RouteLoadError });
}
declare module "@tanstack/react-router" { interface Register { router: ReturnType<typeof getRouter>; } }
