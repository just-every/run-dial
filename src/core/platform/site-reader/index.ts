// Copied from just-every/run-lamp 195e73ac src/core/platform/site-reader/index.ts (gr G1), reading Dial's palette and face from the site's stylesheets instead of components and a status page, and keeping only the icon types the caller takes; the round that adopts Base's shared reader deletes this copy.
import { svgColours } from "./colour.ts";
import { iconCandidates, siteColours, siteDescription, siteName, type Manifest } from "./extract.ts";
import { siteFace } from "./face.ts";
import { checkedUrl, dohResolver, FileTooLarge, guardedFetch, SiteReadError, type GuardedFetchContext } from "./fetch.ts";
import { scanHtml } from "./html.ts";
import { pageStyle } from "./page-style.ts";
import { sitePalette } from "./palette.ts";
import { siteStyles } from "./styles.ts";
import type { SiteIcon, SiteRead, SiteReadOptions, SiteReadResult } from "./types.ts";

export type { FaceUnread, IconRefusal, SiteFace, SiteIcon, SitePalette, SiteRead, SiteReadFailure, SiteReadOptions, SiteReadResult } from "./types.ts";
export type { FaceKind } from "./font-names.ts";
export type { OpenLicence } from "./licence.ts";
export { isPublicAddress } from "./address.ts";

/** "example.com", "www.example.com/about" or a full http(s) URL. */
export function normaliseWebsite(input: string): URL {
  const text = input.trim();
  return checkedUrl(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
}

/** Read one public website: its page, its web manifest if it declares one, one icon, its stylesheets and the file of
 * the face its text is set in (read for what it says about itself; none of it is kept). */
export async function readSite(input: string, options: SiteReadOptions = {}): Promise<SiteReadResult> {
  // Called unbound: Workers refuse a global fetch invoked as a method of another object.
  const transport = options.fetch ?? fetch;
  const resolve = options.resolve ?? dohResolver();
  // One answer per host for the whole read: a site's page, sheets, icon and fonts mostly share one host.
  const answers = new Map<string, Promise<string[]>>();
  const context: GuardedFetchContext = {
    fetch: (input, init) => transport(input, init),
    resolve: (hostname) => {
      if (!answers.has(hostname)) answers.set(hostname, resolve(hostname));
      return answers.get(hostname)!;
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    maxRedirects: options.maxRedirects ?? 5,
  };
  try {
    const start = normaliseWebsite(input);
    const page = await guardedFetch(start, "text/html,application/xhtml+xml", options.maxHtmlBytes ?? 1_500_000, true, context);
    if (!/html|xml/i.test(page.contentType)) throw new SiteReadError("not-html", "That address isn't a web page.");
    const scan = scanHtml(new TextDecoder().decode(page.bytes));
    const [manifestRead, sheets] = await Promise.all([
      readManifest(scan.tags.find((tag) => tag.name === "link" && (tag.attributes.rel ?? "").toLowerCase().split(/\s+/).includes("manifest"))?.attributes.href, page.url, context),
      siteStyles(scan, page.url, context, { maxSheets: options.maxStylesheets ?? 8, maxSheetBytes: options.maxStylesheetBytes ?? 512_000 }),
    ]);
    const { manifest, manifestUrl } = manifestRead;
    let icon: SiteIcon | null = null, iconRefused: SiteRead["iconRefused"] = null;
    for (const candidate of iconCandidates(scan, page.url, manifest, manifestUrl).slice(0, 3)) {
      try {
        const fetched = await guardedFetch(new URL(candidate.url), "image/svg+xml,image/png,image/*;q=0.8", options.maxIconBytes ?? 300_000, false, context);
        const found = iconFrom(fetched.url.href, fetched.bytes);
        if (found && (!options.iconTypes || options.iconTypes.includes(found.contentType))) { icon = found; break; }
        iconRefused ??= { url: fetched.url.href, reason: found ? "type" : "not-an-image" };
      } catch (cause) {
        if (context.signal.aborted) throw cause;
        const reason = cause instanceof FileTooLarge ? "too-large" : "unreachable";
        if (reason === "too-large" || !candidate.guessed) iconRefused ??= { url: candidate.url, reason };
      }
    }
    const { colours, accent } = siteColours(scan, icon?.contentType === "image/svg+xml" ? svgColours(new TextDecoder().decode(icon.bytes)) : [], manifest);
    const style = pageStyle(scan, sheets);
    return {
      ok: true,
      site: {
        url: page.url.href,
        host: page.url.hostname,
        name: siteName(scan, page.url.hostname, manifest),
        title: scan.title,
        description: siteDescription(scan, manifest),
        icon,
        iconRefused: icon ? null : iconRefused,
        colours,
        accent,
        palette: sitePalette(scan, style, accent),
        face: await siteFace(sheets, style, context, options.maxFontBytes ?? 1_000_000),
      },
    };
  } catch (cause) {
    if (cause instanceof SiteReadError) return { ok: false, reason: cause.reason, message: cause.message };
    if (context.signal.aborted) return { ok: false, reason: "timeout", message: "That website took too long to answer." };
    return { ok: false, reason: "unreachable", message: "We couldn't reach that website." };
  }
}

async function readManifest(href: string | undefined, base: URL, context: GuardedFetchContext): Promise<{ manifest: Manifest | null; manifestUrl: URL | null }> {
  if (!href) return { manifest: null, manifestUrl: null };
  let manifestUrl: URL | null = null;
  try {
    manifestUrl = new URL(href, base);
    const parsed: unknown = JSON.parse(new TextDecoder().decode((await guardedFetch(manifestUrl, "application/manifest+json,application/json", 100_000, false, context)).bytes));
    return { manifest: parsed && typeof parsed === "object" ? parsed as Manifest : null, manifestUrl };
  } catch (cause) {
    if (context.signal.aborted) throw cause;
    return { manifest: null, manifestUrl }; // A broken manifest only means less to read.
  }
}

function sniff(bytes: Uint8Array): string | null {
  const head = (length: number) => [...bytes.subarray(0, length)];
  if (head(8).join() === "137,80,78,71,13,10,26,10") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (String.fromCharCode(...head(4)) === "GIF8") return "image/gif";
  if (String.fromCharCode(...head(4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  if (head(4).join() === "0,0,1,0") return "image/x-icon";
  if (String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && /avi[fs]/.test(String.fromCharCode(...bytes.subarray(8, 32)))) return "image/avif";
  const text = new TextDecoder().decode(bytes.subarray(0, 2048)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return "image/svg+xml";
  return null;
}

function iconFrom(url: string, bytes: Uint8Array): SiteIcon | null {
  const contentType = sniff(bytes);
  if (!contentType || !bytes.byteLength) return null;
  let width: number | null = null, height: number | null = null;
  if (contentType === "image/png" && bytes.byteLength >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16); height = view.getUint32(20);
  }
  return { url, contentType, bytes, width, height };
}
