import { Link } from "@tanstack/react-router";
import { clientMount } from "../../../app/public-mount";
import { SiteBrand } from "./SiteBrand";
import { creditUrl, sourceUrl } from "./links";

/**
 * The quiet footer: the small wordmark with the deployment's description as its tagline, the owner when the deployment names
 * one, then plain links and the credit on one row. The credit is the deployment's to switch off (`showPoweredBy`).
 */
export function SiteFooter() {
  const { owner, description, showPoweredBy } = clientMount.deploymentConfig;
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div className="site-footer-brand">
        <SiteBrand />
        <p className="site-tagline">{description}</p>
        {owner ? <p className="site-owner">Run by {owner.name}</p> : null}
      </div>
      <div className="site-footer-end">
        <nav aria-label="Footer navigation">
          <Link to="/docs" activeOptions={{ exact: true }}>Docs</Link>
          <a href={sourceUrl}>Source</a>
          <Link to="/signin" reloadDocument>Sign in</Link>
        </nav>
        {showPoweredBy ? <a className="site-credit" href={creditUrl}>Powered by Dial · <span>runeditrun.com</span></a> : null}
      </div>
    </div>
  </footer>;
}
