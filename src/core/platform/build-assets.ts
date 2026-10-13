import buildAssets from "virtual:dial-build-assets";

// Called only after public admission. A cache hit avoids a new network request;
// every request that reaches this Worker still spends the normal public budget.
export async function fetchBuildAsset(request: Request, assets: Fetcher) {
  const response = await assets.fetch(request);
  const path = new URL(request.url).pathname;
  if (!buildAssets.has(path) || !["GET", "HEAD"].includes(request.method) || response.status !== 200) return response;
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  const expectedType = contentType === "text/javascript" || contentType === "application/javascript";
  if (!expectedType || response.headers.has("Set-Cookie") || /(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") ?? "")) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
