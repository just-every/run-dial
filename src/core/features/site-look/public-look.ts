import { plainPalette } from "./contrast";
import { selectStoredLook, storedLook, type Palette, type StoredLook } from "./stored";

/** A public brand file: the read mark or the read face. */
export interface BrandFile { url: string; contentType: string }

/** What booking pages wear: the site's look as stored, or the plain built-in look. Only public facts are here. */
export interface PublicLook {
  kind: "site" | "plain";
  /** The site the look came from, for "Back to <host>". */
  site: { url: string; host: string } | null;
  name: string | null;
  mark: BrandFile | null;
  colours: Palette;
  face: { family: string; file: BrandFile } | null;
}

export const plainLook: PublicLook = { kind: "plain", site: null, name: null, mark: null, colours: plainPalette, face: null };

const brandTypes: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};
export const brandExtensions: Record<string, string> = Object.fromEntries(Object.entries(brandTypes).map(([extension, type]) => [type, extension]));

/** brand/<sha256>.<ext> → its public file, or null for any other key. */
export function brandFile(key: string | null): BrandFile | null {
  const match = key?.match(/^brand\/([a-f0-9]{64})\.([a-z0-9]+)$/);
  const contentType = match ? brandTypes[match[2]] : undefined;
  return match && contentType ? { url: `/media/brand/${match[1]}.${match[2]}`, contentType } : null;
}

export const siteHost = (url: string) => new URL(url).hostname.replace(/^www\./, "");

/** The site's look with the owner's changes, as it shows when chosen; null before any read succeeded. */
export function siteLook(stored: StoredLook | null): PublicLook | null {
  if (!stored?.readAt || !stored.websiteUrl || !stored.colours) return null;
  const { overrides } = stored;
  const face = overrides.face === "plain" ? null : brandFile(stored.fontAsset);
  return {
    kind: "site",
    site: { url: stored.websiteUrl, host: siteHost(stored.websiteUrl) },
    name: overrides.name ?? stored.name,
    mark: overrides.mark === "none" ? null : brandFile(stored.markAsset),
    colours: stored.colours.used,
    face: face && stored.fontFamily ? { family: stored.fontFamily, file: face } : null,
  };
}

/** What booking pages show now. */
export function publicLook(stored: StoredLook | null): PublicLook {
  return stored?.look === "site" ? siteLook(stored) ?? plainLook : plainLook;
}

/** For the booking pages' loaders (BB10): add this read to the batch that reads the public profile, so a page gets its
 * look in the same request. */
export const publicLookStatement = (binding: D1Database) => binding.prepare(selectStoredLook);
export const publicLookFrom = (result: D1Result) => publicLook(storedLook(result.results[0] as Record<string, unknown> | undefined));
