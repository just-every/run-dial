import { normaliseEmbedOrigin, type EmbedsService } from "../features/embeds/service";

/** Document loaders also run directly through server functions, outside the HTTP embed gate. */
export async function canReadEmbedDocument(url: URL, embeds: Pick<EmbedsService, "canEmbed" | "isOriginAllowed">) {
  const parents = url.searchParams.getAll("parent");
  if (parents.length !== 1 || parents[0].length > 300) return false;
  const parent = normaliseEmbedOrigin(parents[0]);
  if (!parent) return false;

  const manage = /^\/embed\/manage\/([^/]+)$/.exec(url.pathname);
  if (manage) {
    let token: string;
    try { token = decodeURIComponent(manage[1]); } catch { return false; }
    return token.length > 0 && token.length <= 512 && await embeds.isOriginAllowed(parent);
  }

  // Match only declared event documents. In particular, an embed profile or an
  // extra manage path segment must never select a standalone public projection.
  const event = /^\/embed\/([a-z0-9-]{1,80})\/([a-z0-9-]{1,80})(?:\/(?:details|confirmed|request))?$/.exec(url.pathname);
  return Boolean(event && await embeds.canEmbed(event[1], event[2], parent));
}
