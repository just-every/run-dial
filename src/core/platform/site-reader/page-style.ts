import { backgroundColour, cssColour } from "./css-colour.ts";
import { declarations, splitTopLevel, unquote, type CssSheet } from "./css.ts";
import type { HtmlScan } from "./html.ts";

/** An element as the page writes it: enough to match simple selectors. */
export interface StyledElement { tag: string; classes: string[]; id: string | null; style: string | null }

/** What the page's own rules give its html and body: the page colours, its font stacks and its custom properties. */
export interface PageStyle {
  background: string | null;
  ink: string | null;
  /** Font stacks to try in order: body, html, then the first-level heading. */
  fontStacks: string[][];
  /** Custom properties as the body sees them. */
  vars: Map<string, string>;
  cascade: Cascade;
}

type Winner = { value: string; important: boolean; specificity: number; order: number };

/** The declarations that reach one element, property by property. */
export type Cascade = (element: StyledElement) => Map<string, string>;

/** Matches through simple selectors only: a tag, classes, an id or :root, optionally under html or body. A rule that
 * needs any other ancestor, an attribute or a state cannot be matched without the page itself, so it is left out. */
export function cascadeOf(sheets: CssSheet[]): Cascade {
  return (element) => {
    const winners = new Map<string, Winner>();
    sheets.forEach((sheet, sheetIndex) => {
      for (const rule of sheet.rules) {
        const specificity = Math.max(...rule.selectors.map((selector) => matchSpecificity(selector, element)));
        if (specificity < 0) continue;
        for (const [name, { value, important }] of rule.declarations) keep(winners, name, { value, important, specificity, order: sheetIndex * 1_000_000 + rule.order });
      }
    });
    if (element.style) for (const [name, { value, important }] of declarations(element.style)) keep(winners, name, { value, important, specificity: 1_000, order: Number.MAX_SAFE_INTEGER });
    return new Map([...winners].map(([name, winner]) => [name, winner.value]));
  };
}

function keep(winners: Map<string, Winner>, name: string, candidate: Winner) {
  const current = winners.get(name);
  const wins = !current || (candidate.important !== current.important ? candidate.important
    : candidate.specificity !== current.specificity ? candidate.specificity > current.specificity : candidate.order >= current.order);
  if (wins) winners.set(name, candidate);
}

/** The selector's specificity when it matches the element, else -1. */
function matchSpecificity(selector: string, element: StyledElement): number {
  const compounds = selector.trim().split(/\s+/);
  if (compounds.some((compound) => /^[>+~]/.test(compound) || /[>+~]$/.test(compound))) return -1;
  let total = 0;
  for (const ancestor of compounds.slice(0, -1)) {
    if (!["html", "body", ":root"].includes(ancestor)) return -1;
    total += ancestor === ":root" ? 10 : 1;
  }
  const own = compoundSpecificity(compounds[compounds.length - 1], element);
  return own < 0 ? -1 : total + own;
}

function compoundSpecificity(compound: string, element: StyledElement): number {
  const parts = compound.match(/\*|:root|:where\([^)]*\)|[.#](?:\\.|[\w-])+|[a-zA-Z][\w-]*|[\s\S]/g) ?? [];
  let specificity = 0;
  for (const part of parts) {
    if (part === "*" || part.startsWith(":where(")) continue;
    if (part === ":root") { if (element.tag !== "html") return -1; specificity += 10; continue; }
    if (part.startsWith(".")) { if (!element.classes.includes(unescape(part.slice(1)))) return -1; specificity += 10; continue; }
    if (part.startsWith("#")) { if (element.id !== unescape(part.slice(1))) return -1; specificity += 100; continue; }
    if (/^[a-zA-Z]/.test(part)) { if (part.toLowerCase() !== element.tag) return -1; specificity += 1; continue; }
    return -1;
  }
  return specificity;
}

const unescape = (name: string) => name.replace(/\\(.)/g, "$1");

export function styledElement(tag: string, attributes: Record<string, string>): StyledElement {
  return { tag, classes: (attributes.class ?? "").split(/\s+/).filter(Boolean), id: attributes.id ?? null, style: attributes.style ?? null };
}

/** The custom properties among an element's declarations. */
export function customProperties(declared: Map<string, string>) {
  return new Map([...declared].filter(([name]) => name.startsWith("--")));
}

/** Substitute var() references; an unknown property without a fallback leaves the value unusable (null). */
export function resolveVars(value: string | undefined, vars: Map<string, string>, depth = 0): string | null {
  if (value === undefined) return null;
  if (depth > 8) return null;
  let result = "", index = 0;
  for (;;) {
    const start = value.indexOf("var(", index);
    if (start < 0) return result + value.slice(index);
    let depthCount = 0, end = start + 3;
    for (; end < value.length; end++) {
      if (value[end] === "(") depthCount++;
      else if (value[end] === ")" && --depthCount === 0) break;
    }
    const [name, ...fallback] = splitTopLevel(value.slice(start + 4, end), ",");
    const known = vars.get(name.trim());
    const replacement = known !== undefined ? resolveVars(known, vars, depth + 1) : fallback.length ? resolveVars(fallback.join(",").trim(), vars, depth + 1) : null;
    if (replacement === null) return null;
    result += value.slice(index, start) + replacement;
    index = end + 1;
  }
}

/** The family list of `font-family`, or of the `font` shorthand after its size. */
function fontStack(declared: Map<string, string>, vars: Map<string, string>): string[] {
  const family = resolveVars(declared.get("font-family"), vars);
  const shorthand = resolveVars(declared.get("font"), vars)?.match(/(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|[\d.]+(?:px|em|rem|%|pt|vw|vh|vmin|vmax|ex|ch|cap|lh|q|mm|cm|in|pc)?)(?:\s*\/\s*\S+)?\s+(.+)$/i)?.[1];
  const list = family ?? shorthand;
  return list ? splitTopLevel(list, ",").map(unquote).map((name) => name.trim()).filter(Boolean) : [];
}

export function pageStyle(scan: HtmlScan, sheets: CssSheet[]): PageStyle {
  const cascade = cascadeOf(sheets);
  const html = cascade(styledElement("html", scan.tags.find((tag) => tag.name === "html")?.attributes ?? {}));
  const body = cascade(styledElement("body", scan.tags.find((tag) => tag.name === "body")?.attributes ?? {}));
  const htmlVars = customProperties(html);
  const vars = new Map([...htmlVars, ...customProperties(body)]);
  const colour = (declared: Map<string, string>, scope: Map<string, string>) =>
    backgroundColour(resolveVars(declared.get("background-color"), scope) ?? resolveVars(declared.get("background"), scope));
  const heading = cascade({ tag: "h1", classes: [], id: null, style: null });
  return {
    background: colour(body, vars) ?? colour(html, htmlVars),
    ink: cssColour(resolveVars(body.get("color"), vars)) ?? cssColour(resolveVars(html.get("color"), htmlVars)),
    fontStacks: [fontStack(body, vars), fontStack(html, htmlVars), fontStack(heading, vars)].filter((stack) => stack.length),
    vars,
    cascade,
  };
}
