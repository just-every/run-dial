// Helpers for reading rendered HTML in tests without regex sanitizers that leave
// partial markup behind (nested tags, `</script >`, `&amp;quot;`).

// Removing a span can join its neighbours into a new one (`<!<!-- -->--`), so repeat until nothing is left to remove.
function untilStable(strip, html) {
  for (let next = strip(html); ; html = next, next = strip(html)) if (next === html) return html;
}

function stripCommentsOnce(html) {
  let out = "", at = 0;
  for (;;) {
    const start = html.indexOf("<!--", at);
    if (start < 0) return out + html.slice(at);
    const end = html.indexOf("-->", start + 4);
    if (end < 0) return out + html.slice(at, start);
    out += html.slice(at, start);
    at = end + 3;
  }
}

export const stripComments = (html) => untilStable(stripCommentsOnce, html);

// Removes each <script ...>...</script> element, tolerating `</script >` end tags.
function stripScriptsOnce(html) {
  let out = "", at = 0;
  const lower = html.toLowerCase();
  for (;;) {
    const start = lower.indexOf("<script", at);
    if (start < 0) return out + html.slice(at);
    out += html.slice(at, start);
    const close = /<\/script\b[^>]*>/gi;
    close.lastIndex = start;
    const end = close.exec(html);
    if (!end) return out;
    at = end.index + end[0].length;
  }
}

export const stripScripts = (html) => untilStable(stripScriptsOnce, html);

// Decodes the entities React and the mail layout emit in attribute values; `&amp;` goes last so `&amp;quot;` stays `&quot;`.
export function decodeAttribute(value) {
  return value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

export function hrefsOf(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/giu)].map((match) => decodeAttribute(match[1]));
}

export function hasHref(html, url) {
  return hrefsOf(html).some((href) => href === url);
}
