import { splitTopLevel, unquote, type CssSheet } from "./css.ts";
import { FileTooLarge, guardedFetch, type GuardedFetchContext } from "./fetch.ts";
import { fontFacts, fontFormat, type FaceKind } from "./font-names.ts";
import { openLicence } from "./licence.ts";
import type { PageStyle } from "./page-style.ts";
import { isGoogleFontsHost } from "./styles.ts";
import type { FaceUnread, SiteFace } from "./types.ts";

// CSS generic families and keywords: never a face the site serves. A generic names the kind of face its stack falls back to.
const GENERIC = new Map<string, FaceKind | null>([
  ["serif", "serif"], ["ui-serif", "serif"],
  ["sans-serif", "sans"], ["ui-sans-serif", "sans"], ["system-ui", "sans"], ["-apple-system", "sans"], ["blinkmacsystemfont", "sans"], ["ui-rounded", "sans"],
  ["monospace", "mono"], ["ui-monospace", "mono"],
  ["cursive", "script"], ["fantasy", "display"],
  ["emoji", null], ["math", null], ["fangsong", null], ["inherit", null], ["initial", null], ["unset", null], ["revert", null], ["revert-layer", null],
]);

interface Declared { family: string; descriptors: Map<string, string>; sheet: CssSheet }

/** The site's text face: the first family in the body's font stack (then html's, then the first heading's) that the
 * site serves itself with @font-face. Its regular, upright, Latin file is read for what it says about itself (its
 * family, kind and licence), and none of it is kept. A family the page only names, such as a system font, is not a
 * face the site serves, so the result is null. */
export async function siteFace(sheets: CssSheet[], page: PageStyle, context: GuardedFetchContext, maxFontBytes: number): Promise<SiteFace | null> {
  const declared: Declared[] = sheets.flatMap((sheet) => sheet.fontFaces.map((descriptors) => ({ family: unquote(descriptors.get("font-family") ?? ""), descriptors, sheet })));
  for (const stack of page.fontStacks) {
    for (const [index, family] of stack.entries()) {
      if (GENERIC.has(family.toLowerCase())) continue;
      const faces = declared.filter((face) => face.family.toLowerCase() === family.toLowerCase());
      if (faces.length) return readFace(family, fallbackKind(stack.slice(index + 1)), faces, context, maxFontBytes);
    }
  }
  return null;
}

/** The kind the stack falls back to after the face: its first generic family that names one. */
const fallbackKind = (rest: string[]) => rest.map((family) => GENERIC.get(family.toLowerCase())).find((kind) => kind) ?? null;

/** The kind a family's own name spells, for a file that does not classify itself and a stack with no generic. */
function nameKind(family: string): FaceKind | null {
  if (/\bmono(space(d)?)?\b|\bcode\b/i.test(family)) return "mono";
  if (/\bsans\b|grotesk|grotesque/i.test(family)) return "sans";
  if (/\bserif\b|\bslab\b/i.test(family)) return "serif";
  return null;
}

async function readFace(family: string, stackKind: FaceKind | null, faces: Declared[], context: GuardedFetchContext, maxFontBytes: number): Promise<SiteFace> {
  const face = faces.toSorted((a, b) => score(a.descriptors) - score(b.descriptors))[0];
  const source = sourceUrl(face);
  const google = isGoogleFontsHost(new URL(face.sheet.url)) || (source !== null && isGoogleFontsHost(source));
  let bytes: Uint8Array | null = null, url: string | null = null, unread: FaceUnread | null = null;
  if (!source) unread = "no-file";
  else if (source.protocol === "data:") {
    const inline = dataBytes(source.href, maxFontBytes);
    if (inline === "too-large") unread = "too-large";
    else bytes = inline;
  } else {
    url = source.href;
    try {
      const fetched = await guardedFetch(source, "font/woff2,font/woff,font/ttf,font/otf,*/*;q=0.1", maxFontBytes, false, context);
      bytes = fetched.bytes;
      url = fetched.url.href;
    } catch (cause) {
      if (context.signal.aborted) throw cause;
      unread = cause instanceof FileTooLarge ? "too-large" : "unreachable";
    }
  }
  const facts = bytes && fontFormat(bytes) ? fontFacts(bytes) : null;
  if (!unread && !facts) unread = "not-a-font";
  return {
    family: facts?.family ?? family,
    source: google ? "google-fonts" : "site",
    kind: facts?.kind ?? stackKind ?? nameKind(facts?.family ?? family),
    url,
    unread,
    licence: facts ? { open: openLicence(facts.licence, facts.licenceUrl), text: facts.licence ?? facts.licenceUrl } : null,
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

/** A face inlined in the CSS: its bytes, "too-large" over the limit, or null when it is not base64 data. */
function dataBytes(href: string, maxBytes: number): Uint8Array | "too-large" | null {
  const comma = href.indexOf(",");
  if (comma < 0 || !/;base64$/i.test(href.slice(0, comma))) return null;
  if ((href.length - comma) * 0.75 > maxBytes) return "too-large";
  try { return Uint8Array.from(atob(href.slice(comma + 1)), (character) => character.charCodeAt(0)); } catch { return null; }
}
