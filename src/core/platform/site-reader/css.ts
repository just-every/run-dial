/** A tolerant reading of one stylesheet's unconditional rules: what applies on every screen.
 * Rules inside @media, @supports and @container, and blocks nested inside a rule (hover and screen variants), are
 * conditional and are skipped; @layer contents count as ordinary rules. Nothing is evaluated or fetched here. */
export interface CssRule { selectors: string[]; declarations: Map<string, { value: string; important: boolean }>; order: number }
export interface CssSheet { url: string; rules: CssRule[]; fontFaces: Map<string, string>[] }

export function parseCss(css: string, url: string): CssSheet {
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, " ");
  const sheet: CssSheet = { url, rules: [], fontFaces: [] };
  readBlock(text, 0, sheet, { order: 0 });
  return sheet;
}

/** Reads statements until the block closes; returns the index after its closing brace. */
function readBlock(text: string, from: number, sheet: CssSheet, counter: { order: number }): number {
  let index = from;
  while (index < text.length) {
    index = skipSpace(text, index);
    if (index >= text.length) return index;
    if (text[index] === "}") return index + 1;
    const end = preludeEnd(text, index);
    const prelude = text.slice(index, end).trim();
    if (end >= text.length) return end;
    if (text[end] === ";") { index = end + 1; continue; }
    const close = matchingBrace(text, end);
    if (/^@font-face\b/i.test(prelude)) {
      sheet.fontFaces.push(new Map([...declarations(text.slice(end + 1, close - 1))].map(([name, entry]) => [name, entry.value])));
    } else if (/^@layer\b/i.test(prelude)) {
      readBlock(text, end + 1, sheet, counter);
    } else if (!prelude.startsWith("@")) {
      const selectors = splitTopLevel(prelude, ",").map((selector) => selector.trim()).filter(Boolean);
      if (selectors.length) sheet.rules.push({ selectors, declarations: declarations(text.slice(end + 1, close - 1)), order: counter.order++ });
    }
    index = close;
  }
  return index;
}

/** The end of a prelude: the first `{` or `;` outside strings and brackets. */
function preludeEnd(text: string, from: number) {
  let depth = 0;
  for (let index = from; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'") index = stringEnd(text, index);
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (character === "{" || character === ";")) return index;
  }
  return text.length;
}

/** The index after the brace that closes the one at `open`. */
function matchingBrace(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'") index = stringEnd(text, index);
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) return index + 1;
  }
  return text.length;
}

function stringEnd(text: string, open: number) {
  for (let index = open + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === text[open] || text[index] === "\n") return index;
  }
  return text.length;
}

function skipSpace(text: string, from: number) {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

/** A block's own declarations; a rule nested inside it is a variant and is left out. */
export function declarations(block: string) {
  const result = new Map<string, { value: string; important: boolean }>();
  let index = 0;
  while (index < block.length) {
    const end = preludeEnd(block, index);
    if (end < block.length && block[end] === "{") { index = matchingBrace(block, end); continue; }
    const statement = block.slice(index, end);
    index = end + 1;
    const colon = statement.indexOf(":");
    if (colon < 0) continue;
    const name = statement.slice(0, colon).trim();
    let value = statement.slice(colon + 1).trim();
    if (!name || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    // Custom properties keep their case; ordinary property names do not.
    const key = name.startsWith("--") ? name : name.toLowerCase();
    const existing = result.get(key);
    if (!existing?.important || important) result.set(key, { value, important });
  }
  return result;
}

/** Split on a separator outside strings and brackets: selector lists, font stacks, src lists. */
export function splitTopLevel(text: string, separator: string) {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' || character === "'") index = stringEnd(text, index);
    else if (character === "(" || character === "[") depth++;
    else if (character === ")" || character === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === separator) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Unquote a CSS string or identifier list entry: `"Inter Tight"` → Inter Tight. */
export function unquote(value: string) {
  const text = value.trim();
  return /^(["']).*\1$/s.test(text) ? text.slice(1, -1).replace(/\\(.)/g, "$1") : text.replace(/\\(.)/g, "$1");
}
