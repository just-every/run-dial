import { backgroundColour, cssColour } from "./css-colour.ts";
import type { HtmlControl, HtmlScan } from "./html.ts";
import { customProperties, resolveVars, styledElement, type PageStyle } from "./page-style.ts";
import type { SitePalette } from "./types.ts";

/** The page's colour roles as its own CSS sets them. The accent and button ink come from the first visible link or
 * button the site fills with a solid colour other than the page's; without one, the accent is the declared brand
 * colour (`fallbackAccent`) and the button ink is unknown. Nothing is guessed: a role the site does not set is null. */
export function sitePalette(scan: HtmlScan, page: PageStyle, fallbackAccent: string | null): SitePalette {
  const button = primaryButton(scan, page);
  return { background: page.background, ink: page.ink, accent: button?.accent ?? fallbackAccent, buttonInk: button?.ink ?? null };
}

function primaryButton(scan: HtmlScan, page: PageStyle) {
  for (const control of scan.controls.slice(0, 80)) {
    if (hidden(control)) continue;
    const declared = page.cascade(styledElement(control.name, control.attributes));
    const vars = new Map([...page.vars, ...customProperties(declared)]);
    const fill = backgroundColour(resolveVars(declared.get("background-color"), vars) ?? resolveVars(declared.get("background"), vars));
    if (!fill || fill === page.background) continue;
    return { accent: fill, ink: cssColour(resolveVars(declared.get("color"), vars)) ?? page.ink };
  }
  return null;
}

/** Skip links, screen-reader text and hidden or disabled controls are not the site's buttons. */
function hidden({ attributes }: HtmlControl) {
  const names = `${attributes.class ?? ""} ${attributes.id ?? ""}`.toLowerCase();
  return "hidden" in attributes || "disabled" in attributes || attributes["aria-hidden"] === "true"
    || /(^|[\s_-])(skip|sr-only|visually-hidden|screen-reader)/.test(names)
    || /^#(main|content|main-content|maincontent)$/i.test(attributes.href ?? "");
}
