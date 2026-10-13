import { Link } from "@tanstack/react-router";
import { BrandMark } from "../../public-booking";

/** The Dial mark and wordmark, a link home. It is never a heading: each page's own title is its one h1. */
export function SiteBrand() {
  return <Link className="site-brand" to="/"><BrandMark />Dial</Link>;
}
