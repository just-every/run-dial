import { useContext } from "react";
import { SiteVariantContext } from "./context";
import { Link } from "@tanstack/react-router";
import { SiteBrand } from "./SiteBrand";
import { sourceUrl } from "./links";

/** The public site's header: the wordmark home, Docs (marked as the current section on a docs page, whose own link in the docs menu is the current page), Source and the Sign in pill. */
export function SiteHeader({ page }: { page: "landing" | "docs" }) {
  const site = useContext(SiteVariantContext) === "site";
  return <header className="site-header">
    <SiteBrand />
    <nav aria-label="Main navigation">
      {site ? <a href="/docs" aria-current={page === "docs" ? "true" : undefined}>Docs</a> : <Link to="/docs" activeOptions={{ exact: true }} aria-current={page === "docs" ? "true" : undefined}>Docs</Link>}
      <a href={sourceUrl}>Source</a>
      {!site && <Link className="pill" to="/signin" reloadDocument>Sign in</Link>}
    </nav>
  </header>;
}
