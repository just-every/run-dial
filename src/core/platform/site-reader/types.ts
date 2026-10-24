// Copied from just-every/run-lamp 195e73ac src/core/platform/site-reader/types.ts (gr G1), with Dial's palette and face in place of components, the status page and the font list; the round that adopts Base's shared reader deletes this copy.
import type { FaceKind } from "./font-names.ts";
import type { OpenLicence } from "./licence.ts";

/** What a public website says about itself. Every field is read from the site; absent means the site did not say. */
export interface SiteRead {
  /** The page that answered, after redirects. */
  url: string;
  host: string;
  /** The business or product name, e.g. "Harvest". */
  name: string | null;
  title: string | null;
  description: string | null;
  icon: SiteIcon | null;
  /** The best icon the site offers when none could be kept, and why. */
  iconRefused: { url: string; reason: IconRefusal } | null;
  /** Brand colours as #rrggbb, most confident first. */
  colours: string[];
  /** The first colour in `colours` saturated enough to brand buttons and links. */
  accent: string | null;
  /** The page's own colour roles, from its stylesheets. */
  palette: SitePalette;
  /** The face the page's text is set in, when the site serves it. */
  face: SiteFace | null;
}

export interface SiteIcon {
  /** Where the icon was read, after redirects. */
  url: string;
  /** Sniffed from the bytes: image/svg+xml, image/png, image/jpeg, image/gif, image/webp, image/avif or image/x-icon. */
  contentType: string;
  /** Show an SVG only in an <img> (no scripts run there), or serve it sandboxed. */
  bytes: Uint8Array;
  width: number | null;
  height: number | null;
}

/** Why an icon was not kept: over the size limit, not fetched, not an image at all, or an image type the caller does not take. */
export type IconRefusal = "too-large" | "unreachable" | "not-an-image" | "type";

/** #rrggbb per role; null where the site's CSS does not set the role. */
export interface SitePalette {
  /** The page background (body, else html). */
  background: string | null;
  /** The page's text colour. */
  ink: string | null;
  /** The site's filled button, else its declared brand colour. */
  accent: string | null;
  /** The text on that button. */
  buttonInk: string | null;
}

/** The site's face as its own font file and stylesheet describe it. The reader keeps none of the file. */
export interface SiteFace {
  /** As the font file names itself, else as the site's CSS names it. */
  family: string;
  /** "google-fonts" when Google Fonts serves it, else "site". */
  source: "site" | "google-fonts";
  /** From the file's own classification, else the generic family the site's CSS falls back to, else the family's name. */
  kind: FaceKind | null;
  /** Where the site serves the regular face's file, after redirects; null for a face inlined in the CSS or with no file. */
  url: string | null;
  /** Why the file was not read, or null when it was. */
  unread: FaceUnread | null;
  /** The file's own licence field: the open licence it names, and its text (description, else URL). Null when the
   * file was not read: an unread file makes no licence claim. */
  licence: { open: OpenLicence | null; text: string | null } | null;
}

/** Why a face's file was not read: over the size limit, not fetched, not a font this reader understands, or none named. */
export type FaceUnread = "too-large" | "unreachable" | "not-a-font" | "no-file";

export type SiteReadFailure = "invalid-url" | "refused-address" | "unreachable" | "timeout" | "http-error" | "not-html";

export type SiteReadResult =
  | { ok: true; site: SiteRead }
  | { ok: false; reason: SiteReadFailure; message: string };

export interface SiteReadOptions {
  /** Network transport; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Hostname to IP addresses; defaults to DNS over HTTPS at cloudflare-dns.com. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Whole read, every request included. Default 10 s. */
  timeoutMs?: number;
  /** HTML beyond this is not read. Default 1.5 MB. */
  maxHtmlBytes?: number;
  /** A larger icon is skipped. Default 300 KB. */
  maxIconBytes?: number;
  /** Icon types the caller keeps (sniffed from the bytes); an icon of another type is skipped. Default: every type above. */
  iconTypes?: readonly string[];
  /** Default 5. Every hop is checked again. */
  maxRedirects?: number;
  /** Linked stylesheets read, in page order. Default 8. */
  maxStylesheets?: number;
  /** A stylesheet is read up to this size. Default 512 KB. */
  maxStylesheetBytes?: number;
  /** A larger font file is not read. Default 1 MB. */
  maxFontBytes?: number;
}
