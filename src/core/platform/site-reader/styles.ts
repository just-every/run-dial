import { parseCss, type CssSheet } from "./css.ts";
import { guardedFetch, type GuardedFetchContext } from "./fetch.ts";
import type { HtmlScan } from "./html.ts";

/** Google's own font host: a family it serves is a Google Fonts family. */
export const isGoogleFontsHost = (url: URL) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

/** The page's stylesheets in the order they apply: linked sheets in page order (at most `maxSheets`), then the
 * page's own <style> blocks. A sheet that cannot be read only means less to read. */
export async function siteStyles(scan: HtmlScan, page: URL, context: GuardedFetchContext, limits: { maxSheets: number; maxSheetBytes: number }): Promise<CssSheet[]> {
  const links: URL[] = [];
  for (const tag of scan.tags) {
    if (tag.name !== "link" || !(tag.attributes.rel ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) continue;
    if ((tag.attributes.rel ?? "").toLowerCase().includes("alternate") || /^\s*print\s*$/i.test(tag.attributes.media ?? "")) continue;
    try { links.push(new URL(tag.attributes.href ?? "", page)); } catch { /* Not a usable stylesheet address. */ }
  }
  const linked = await Promise.all([...new Map(links.map((url) => [url.href, url])).values()].slice(0, limits.maxSheets).map(async (url) => {
    try {
      const sheet = await guardedFetch(url, "text/css,*/*;q=0.1", limits.maxSheetBytes, true, context);
      return /html/i.test(sheet.contentType) ? null : parseCss(new TextDecoder().decode(sheet.bytes), sheet.url.href);
    } catch (cause) {
      if (context.signal.aborted) throw cause;
      return null;
    }
  }));
  return [...linked.filter((sheet): sheet is CssSheet => sheet !== null), ...scan.styles.map((css) => parseCss(css, page.href))];
}
