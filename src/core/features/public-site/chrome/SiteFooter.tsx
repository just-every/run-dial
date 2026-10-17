import { useContext } from "react";
import { SiteVariantContext, SiteDeploymentContext } from "./context";
import { Link } from "@tanstack/react-router";
import { SiteBrand } from "./SiteBrand";
import { contractPath, creditUrl, sourceUrl } from "./links";

/**
 * The quiet footer: the small wordmark with the deployment's description as its tagline, the owner when the deployment names
 * one, then plain links and the credit on one row. The credit is the deployment's to switch off (`showPoweredBy`).
 */
export function SiteFooter() {
  const site = useContext(SiteVariantContext) === "site";
  const { owner, description, showPoweredBy } = useContext(SiteDeploymentContext);
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-brand">
        <SiteBrand />
        <p className="site-tagline">{description}</p>
        {owner ? <p className="site-owner">Run by {owner.name}</p> : null}
      </div>
      <div className="site-footer-end">
        <nav aria-label="Footer navigation">
          {site ? <a href="/docs">Docs</a> : <Link to="/docs" activeOptions={{ exact: true }}>Docs</Link>}
          {site && <a href={contractPath}>Contract</a>}
          <a href={sourceUrl}>Source</a>
          {!site && <Link to="/signin" reloadDocument>Sign in</Link>}
        </nav>
        {showPoweredBy ? <a className="site-credit" href={creditUrl}>Powered by Dial · <span>runeditrun.com</span></a> : null}
      </div>
    </div>
  </footer>;
}
