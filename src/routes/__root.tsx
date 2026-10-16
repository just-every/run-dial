import { clientMount } from "../core/app/public-mount";
import { SiteDeploymentContext } from "../core/features/public-site/chrome/context";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { loadDocument } from "../core/app/loaders";
import { DocumentData } from "../core/app/document-data";
import { PublicRecoveryPage } from "../core/features/public-booking/ui/recovery-page";
import favicon from "../core/features/public-booking/ui/favicon.svg?url&no-inline";
import { fontStylesheet } from "../core/features/public-site/chrome/font-head";
import "../core/app/styles.css";
import "../core/features/public-booking/ui/public-booking.css";
import "../core/features/public-booking/ui/public-forms.css";
export const Route = createRootRoute({
  // Private shells authenticate and load their own data; there is no public
  // projection to fetch again after their beforeLoad has finished.
  loader: ({ location }) => /^\/(app|setup)(\/|$)/.test(location.pathname)
    ? { status: 200, payloadJson: null, renderInstant: new Date().toISOString() }
    : loadDocument({ data: { path: location.pathname + location.searchStr } }),
  head: () => ({ links: [{ rel: "icon", type: "image/svg+xml", href: favicon }, fontStylesheet], meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "Dial — choose your time" }, { name: "description", content: "Book a focused session with your host." }] }),
  notFoundComponent: withEditorLeaf(() => <PublicRecoveryPage kind="not-found" />),
  component: Root,
});
const DocumentRecovery = withEditorLeaf(() => <PublicRecoveryPage kind="booking" />);
function Root() { const result = Route.useLoaderData(); const data = { renderInstant: result.renderInstant, status: result.status, payload: result.payloadJson ? JSON.parse(result.payloadJson) : null }; return <html lang="en"><head><HeadContent /></head><body><div id="root"><SiteDeploymentContext.Provider value={clientMount.deploymentConfig}><DocumentData.Provider value={data}>{data.status >= 400 ? <DocumentRecovery /> : <Outlet />}</DocumentData.Provider></SiteDeploymentContext.Provider></div><Scripts /></body></html>; }
