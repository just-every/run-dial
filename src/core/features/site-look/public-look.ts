import manifest from "../../../../seed.json";
import { plainPalette } from "./contrast";
import { nearestFace, type ShownFace } from "./faces";
import { selectStoredLook, storedLook, type Palette, type StoredLook } from "./stored";

/** A public brand file under /media/brand/. */
export interface BrandFile { url: string; contentType: string }

/** What booking pages wear: the site's look as stored, or the plain built-in look. Only public facts are here. */
export interface PublicLook {
  kind: "site" | "plain";
  /** The site the look came from, for "Back to <host>". */
  site: { url: string; host: string } | null;
  name: string | null;
  mark: BrandFile | null;
  colours: Palette;
  /** The face booking pages set their text in: the open face Dial bundles nearest the site's own; null is the plain stack. */
  face: ShownFace | null;
}

export const plainLook: PublicLook = { kind: "plain", site: null, name: null, mark: null, colours: plainPalette, face: null };

const extension = (type: string) => ({ "image/jpeg": "jpg", "image/svg+xml": "svg" } as Record<string, string>)[type] ?? type.slice(type.indexOf("/") + 1);

/** BRAND-002: what /media/brand/ stores and serves: a mark in a raster image type seed.json allows for uploads or an SVG
 * (always served sandboxed), and a woff2 face. A WOFF 1.0, TrueType or OpenType file is never one of them. */
export const markTypes: readonly string[] = [...manifest.limits.allowedUploadTypes, "image/svg+xml"];
export const faceTypes: readonly string[] = ["font/woff2"];
const brandTypes: Record<string, string> = Object.fromEntries([...markTypes, ...faceTypes].map((type) => [extension(type), type]));
export const brandExtensions: Record<string, string> = Object.fromEntries(Object.entries(brandTypes).map(([ext, type]) => [type, ext]));

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
  return {
    kind: "site",
    site: { url: stored.websiteUrl, host: siteHost(stored.websiteUrl) },
    name: overrides.name ?? stored.name,
    mark: overrides.mark === "none" ? null : brandFile(stored.markAsset),
    colours: stored.colours.used,
    face: overrides.face === "plain" || !stored.fontFamily ? null : nearestFace(stored.fontFamily, stored.fontKind),
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
