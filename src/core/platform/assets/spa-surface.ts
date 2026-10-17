export type SpaSurface = {
  serve(request: Request, status: 200 | 404 | 410, options?: { blockFraming?: boolean; frameAncestors?: string[] }): Promise<Response>;
};

export function createSpaSurface(assets: Fetcher): SpaSurface {
  return {
    async serve(request, status, options = {}) {
      const asset = await assets.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("Cache-Control", "no-store");
      if (/^\/(?:book|embed|manage)(?:\/|$)/u.test(new URL(request.url).pathname)) headers.set("Referrer-Policy", "no-referrer");
      if (options.blockFraming) {
        headers.set("Content-Security-Policy", "frame-ancestors 'none'");
        headers.set("X-Frame-Options", "DENY");
      } else if (options.frameAncestors?.length) {
        headers.set("Content-Security-Policy", `frame-ancestors ${options.frameAncestors.join(" ")}`);
        headers.delete("X-Frame-Options");
      }
      return new Response(asset.body, { status, headers });
    },
  };
}
