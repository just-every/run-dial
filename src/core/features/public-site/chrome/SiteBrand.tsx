import { useContext } from "react";
import { SiteVariantContext } from "./context";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "../../public-booking";

/** The Dial mark and wordmark, a link home. It is never a heading: each page's own title is its one h1. */
export function SiteBrand() {
  const site = useContext(SiteVariantContext) === "site";
  return site ? <a className="site-brand" href="/"><BrandMark />Dial</a> : <Link className="site-brand" to="/" reloadDocument><BrandMark />Dial</Link>;
}
