import { splitTopLevel, unquote, type CssSheet } from "./css.ts";
import { guardedFetch, type GuardedFetchContext } from "./fetch.ts";
import { fontContentType, fontFormat, fontNames } from "./font-names.ts";
import { openLicence } from "./licence.ts";
import type { PageStyle } from "./page-style.ts";
import { isGoogleFontsHost } from "./styles.ts";
import type { SiteFace } from "./types.ts";

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "revert", "revert-layer"]);

interface Declared { family: string; descriptors: Map<string, string>; sheet: CssSheet }

/** The site's text face: the first family in the body's font stack (then html's, then the first heading's) that the
 * site serves itself with @font-face. Its regular, upright, Latin file is read, with the licence the file names.
 * A family the page only names, such as a system font, is not a face the site serves, so the result is null. */
export async function siteFace(sheets: CssSheet[], page: PageStyle, context: GuardedFetchContext, maxFontBytes: number): Promise<SiteFace | null> {
  const declared: Declared[] = sheets.flatMap((sheet) => sheet.fontFaces.map((descriptors) => ({ family: unquote(descriptors.get("font-family") ?? ""), descriptors, sheet })));
  for (const stack of page.fontStacks) {
    for (const family of stack) {
      if (GENERIC.has(family.toLowerCase())) continue;
      const faces = declared.filter((face) => face.family.toLowerCase() === family.toLowerCase());
      if (faces.length) return readFace(family, faces, context, maxFontBytes);
    }
  }
  return null;
}

async function readFace(family: string, faces: Declared[], context: GuardedFetchContext, maxFontBytes: number): Promise<SiteFace> {
  const face = faces.toSorted((a, b) => score(a.descriptors) - score(b.descriptors))[0];
  const source = sourceUrl(face);
  const google = isGoogleFontsHost(new URL(face.sheet.url)) || (source !== null && isGoogleFontsHost(source));
  let bytes: Uint8Array | null = null, url: string | null = null;
  try {
    if (source?.protocol === "data:") bytes = dataBytes(source.href, maxFontBytes);
    else if (source) {
      const fetched = await guardedFetch(source, "font/woff2,font/woff,font/ttf,font/otf,*/*;q=0.1", maxFontBytes, false, context);
      bytes = fetched.bytes;
      url = fetched.url.href;
    }
  } catch (cause) {
    if (context.signal.aborted) throw cause;
  }
  const format = bytes ? fontFormat(bytes) : null;
  const names = bytes && format ? fontNames(bytes) : null;
  return {
    family: names?.family ?? family,
    source: google ? "google-fonts" : "site",
    file: bytes && format ? { url, contentType: fontContentType[format], bytes } : null,
    licence: { open: openLicence(names?.licence ?? null, names?.licenceUrl ?? null), text: names?.licence ?? names?.licenceUrl ?? null },
  };
}

/** Lower is better: upright, weight 400 (or a range holding it), and Latin letters covered. */
function score(descriptors: Map<string, string>) {
  const style = (descriptors.get("font-style") ?? "normal").toLowerCase();
  const weights = (descriptors.get("font-weight") ?? "400").toLowerCase().replace("normal", "400").replace("bold", "700").split(/\s+/).map(Number).filter(Number.isFinite);
  const distance = weights.length === 2 && weights[0] <= 400 && weights[1] >= 400 ? 0 : Math.min(...weights.map((weight) => Math.abs(weight - 400)), 1_000);
  return (style === "normal" ? 0 : 10_000) + (coversLatin(descriptors.get("unicode-range")) ? 0 : 5_000) + distance;
}

function coversLatin(range: string | undefined) {
  if (!range) return true;
  return splitTopLevel(range, ",").some((part) => {
    const [from, to] = part.trim().replace(/^u\+/i, "").split("-");
    const low = parseInt(from.replace(/\?/g, "0"), 16), high = parseInt((to ?? from).replace(/\?/g, "f"), 16);
    return low <= 0x41 && high >= 0x7a;
  });
}

/** The face's best source: woff2, then woff, then TrueType or OpenType, resolved against its stylesheet. */
function sourceUrl(face: Declared): URL | null {
  const sources = splitTopLevel(face.descriptors.get("src") ?? "", ",").flatMap((entry) => {
    const address = entry.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i)?.[2];
    if (!address) return [];
    const hint = (entry.match(/format\(\s*['"]?([\w-]+)/i)?.[1] ?? address.match(/\.(woff2|woff|ttf|otf)(?:[?#]|$)/i)?.[1] ?? "").toLowerCase();
    const rank = { woff2: 0, woff: 1, truetype: 2, ttf: 2, opentype: 2, otf: 2 }[hint] ?? 3;
    try { return [{ url: new URL(address, face.sheet.url), rank }]; } catch { return []; }
  });
  return sources.sort((a, b) => a.rank - b.rank)[0]?.url ?? null;
}

function dataBytes(href: string, maxBytes: number): Uint8Array | null {
  const comma = href.indexOf(",");
  if (comma < 0 || !/;base64$/i.test(href.slice(0, comma)) || (href.length - comma) * 0.75 > maxBytes) return null;
  return Uint8Array.from(atob(href.slice(comma + 1)), (character) => character.charCodeAt(0));
}
