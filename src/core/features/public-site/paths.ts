/** The public site: the landing at `/` and the documentation under `/docs`. */
export function isPublicSitePath(pathname: string) {
  return pathname === "/" || pathname === "/docs" || pathname.startsWith("/docs/");
}
