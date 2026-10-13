import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import "./site.css";

/**
 * The page frame shared by the public site's pages: the fixed light palette, a skip link, the header and the footer around
 * `children`. `className` scopes the page's own styles (`dial-landing`, `dial-docs`); `skipTo` is the id of its main content.
 */
export function SiteFrame({ page, className, skipTo, children }: { page: "landing" | "docs"; className: string; skipTo: string; children: ReactNode }) {
  return <div className={`dial-site ${className}`}>
    <a className="skip-link" href={`#${skipTo}`}>Skip to the content</a>
    <SiteHeader page={page} />
    {children}
    <SiteFooter />
  </div>;
}
