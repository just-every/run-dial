/** Local runtime internals and checkout files have no application document route. */
export function isPrivateLocalPath(pathname: string): boolean {
  let path = pathname;
  for (let round = 0; round < 4; round++) {
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { return true; }
    if (decoded === path) break;
    path = decoded;
  }
  const segments = path.replace(/\\/g, "/").split("/").map(segment => segment.trim()).filter(Boolean);
  if (segments.some(segment => /^(?:cdn-cgi|\.seed|\.wrangler|\.git|\.dev\.vars.*|\.env.*|.*\.rer(?:\.[\w-]+\.partial)?)$/i.test(segment))) return true;
  const served: string[] = [];
  for (const segment of segments) {
    if (segment === "..") served.pop();
    else if (segment !== ".") served.push(segment);
  }
  const isArchiveDirectory = (segment: string) => /^(?:\.exports|exports)$/i.test(segment);
  return Boolean(served[0] && (isArchiveDirectory(served[0]) || (served[0].startsWith("@") && served.some(isArchiveDirectory))));
}
