// Copied from just-every/run-lamp 195e73ac src/core/platform/site-reader/extract.ts (gr G1), without the components, status page and font list Dial does not read; the round that adopts Base's shared reader deletes this copy.
import { siteDomain } from "./domain.ts";
import { cleanText, type HtmlScan, type HtmlTag } from "./html.ts";
import { cssBrandColours, isBrandColour, toHex } from "./colour.ts";

export interface Manifest { name?: string; short_name?: string; description?: string; theme_color?: string; icons?: { src?: string; sizes?: string; type?: string }[] }

const meta = (scan: HtmlScan, key: string) => scan.tags.find((tag) => tag.name === "meta" && [tag.attributes.name, tag.attributes.property].some((value) => value?.toLowerCase() === key))?.attributes.content?.trim() || null;
const rels = (tag: HtmlTag) => (tag.attributes.rel ?? "").toLowerCase().split(/\s+/);
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function siteName(scan: HtmlScan, host: string, manifest: Manifest | null): string | null {
  const label = squash(siteDomain(host).split(".")[0]);
  const titleParts = (scan.title ?? "").split(/\s+[|\-–—:·•»]\s+/).map(cleanText).filter(Boolean);
  const candidates = [meta(scan, "og:site_name"), meta(scan, "application-name"), manifest?.short_name, manifest?.name, ...titleParts]
    .map((value) => cleanText(value ?? "")).filter((value) => value.length > 0 && value.length <= 40);
  // The name the domain itself spells wins: "Harvest" for getharvest.com.
  const matching = candidates.filter((value) => squash(value).length >= 3 && (label.includes(squash(value)) || squash(value).includes(label)));
  if (matching.length) return matching.sort((a, b) => a.length - b.length)[0];
  const named = [meta(scan, "og:site_name"), meta(scan, "application-name"), manifest?.short_name, manifest?.name].map((value) => cleanText(value ?? "")).find((value) => value && value.length <= 40);
  if (named) return named;
  if (titleParts.length > 1) return titleParts.at(-1)!.length <= 40 ? titleParts.at(-1)! : null;
  return titleParts[0] && titleParts[0].split(" ").length <= 3 ? titleParts[0] : null;
}

export function siteDescription(scan: HtmlScan, manifest: Manifest | null) {
  const text = cleanText(meta(scan, "description") ?? meta(scan, "og:description") ?? manifest?.description ?? "");
  if (!text) return null;
  return text.length <= 280 ? text : `${text.slice(0, 277).replace(/\s+\S*$/, "")}…`;
}

export interface IconCandidate { url: string; rank: number }

/** Declared icons, best first: SVG, then the largest raster, then /favicon.ico when nothing is declared. */
export function iconCandidates(scan: HtmlScan, base: URL, manifest: Manifest | null, manifestUrl: URL | null): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  const size = (sizes: string | undefined) => Math.max(0, ...(sizes ?? "").split(/\s+/).map((value) => Number(value.split("x")[0]) || 0));
  const add = (href: string | undefined, against: URL, rank: number) => {
    if (!href || href.startsWith("data:")) return;
    try { candidates.push({ url: new URL(href, against).href, rank }); } catch { /* An unusable href is not a candidate. */ }
  };
  for (const tag of scan.tags.filter((tag) => tag.name === "link")) {
    const kinds = rels(tag);
    const svg = tag.attributes.type === "image/svg+xml" || /\.svg(\?|$)/i.test(tag.attributes.href ?? "");
    if (kinds.includes("icon")) add(tag.attributes.href, base, svg ? 10_000 : size(tag.attributes.sizes) || 16);
    else if (kinds.includes("apple-touch-icon") || kinds.includes("apple-touch-icon-precomposed")) add(tag.attributes.href, base, size(tag.attributes.sizes) || 180);
  }
  for (const icon of manifest?.icons ?? []) add(icon.src, manifestUrl ?? base, icon.type === "image/svg+xml" ? 9_000 : size(icon.sizes));
  if (!candidates.length) add("/favicon.ico", base, 1);
  const seen = new Set<string>();
  return candidates.sort((a, b) => b.rank - a.rank).filter((candidate) => !seen.has(candidate.url) && seen.add(candidate.url));
}

/** Colours the site declares, most confident first: theme colour, the mark's own colours, CSS brand variables, Safari pinned-tab colour, manifest. */
export function siteColours(scan: HtmlScan, iconColours: string[], manifest: Manifest | null) {
  const themes = scan.tags.filter((tag) => tag.name === "meta" && tag.attributes.name?.toLowerCase() === "theme-color" && !/dark/.test(tag.attributes.media ?? "")).map((tag) => tag.attributes.content);
  const pinned = scan.tags.filter((tag) => tag.name === "link" && rels(tag).includes("mask-icon")).map((tag) => tag.attributes.color);
  const ordered = [...themes, ...iconColours, ...cssBrandColours(scan.styles), ...pinned, manifest?.theme_color].map(toHex).filter((hex): hex is string => Boolean(hex));
  const colours = [...new Set(ordered)];
  return { colours, accent: colours.find(isBrandColour) ?? null };
}
