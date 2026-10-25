import { lazy, type ComponentType } from "react";
import { boundedWorkspaceRead, clearWorkspaceReads, workspaceReadRevision } from "./core/app/workspace-reads";
import { RouteLoadError, RouteLoadPending } from "./core/app/ui/route-load-error";
import { createRouter, type AnyRoute } from "@tanstack/react-router";
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

const boundedRoutes = new WeakSet<AnyRoute>();
function boundRouteRead<TContext extends { abortController: AbortController }, TResult>(read: (context: TContext) => TResult) {
  return (context: TContext) => boundedWorkspaceRead(() => read(context), context.abortController.signal);
}

function boundRouteReads(route: AnyRoute) {
  if (boundedRoutes.has(route)) return;
  boundedRoutes.add(route);
  const beforeLoad = route.options.beforeLoad;
  if (beforeLoad) route.options.beforeLoad = boundRouteRead(beforeLoad);
  const loader = route.options.loader;
  if (typeof loader === "function") route.options.loader = boundRouteRead(loader);
  else if (loader?.handler) {
    const handler = loader.handler;
    route.options.loader = { ...loader, handler: boundRouteRead(handler) };
  }
  route.children?.forEach(boundRouteReads);
}

// React's lazy boundary reports a missing private chunk before any document reload.
// TanStack's generated lazy component reloads automatically on its first import failure.
const privateChunks = import.meta.glob<{ component: ComponentType }>("./routes/app*.tsx", { query: "?tsr-split=component" });
function recoverPrivateChunks(routes: AnyRoute[]) {
  if (typeof document === "undefined") return;
  for (const route of routes) {
    if (!route.id.startsWith("/app") || !route.options.component?.preload) continue;
    const file = "./routes/" + route.id.slice(1).replaceAll("/", ".") + (route.id.endsWith("/") ? "index" : "") + ".tsx";
    const load = privateChunks[file];
    if (load) route.options.component = lazy(async () => ({ default: (await load()).component }));
  }
}

// Workspace shells, Settings and event editors load with the entry graph: a refused lazy
// import otherwise triggers Router's immediate document reload inside the same rate window.
export function getRouter() {
  if (typeof document !== "undefined") {
    setLiveEditsReady(false);
    installCompiledLiveEdits(visualEdits);
  }
  boundRouteReads(routeTree);
  const router = createRouter({ routeTree, scrollRestoration, defaultErrorComponent: RouteLoadError, defaultPendingComponent: RouteLoadPending, defaultPendingMs: 0, defaultPendingMinMs: 0, defaultRemountDeps: workspaceReadRevision });
  recoverPrivateChunks(Object.values(router.routesById));
  router.subscribe("onBeforeNavigate", clearWorkspaceReads);
  return router;
}
declare module "@tanstack/react-router" { interface Register { router: ReturnType<typeof getRouter>; } }
