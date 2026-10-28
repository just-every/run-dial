/** PUBLIC-004: keep the bootstrap attributes and modal trigger in one place. */
export function embedSnippet(publicOrigin: string, handle: string, slug: string, mode: "inline" | "modal") {
  const script = `<script async src="${new URL("/embed/dial.js", publicOrigin).href}" data-dial-handle="${handle}" data-dial-embed="${slug}" data-dial-mode="${mode}"></script>`;
  return mode === "inline" ? script : `<button type="button" data-dial-embed="${slug}">Book a time</button>\n${script}`;
}

/** ROUTE-001: routing embeds use the shared bootstrap without a host handle. */
export function routingEmbedSnippet(publicOrigin: string, slug: string, mode: "inline" | "modal") {
  const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const source = escapeAttribute(new URL("/embed/dial.js", publicOrigin).href);
  const form = escapeAttribute(slug);
  const script = `<script async src="${source}" data-dial-embed="${form}" data-dial-routing="true" data-dial-mode="${mode}"></script>`;
  return mode === "inline" ? script : `<button type="button" data-dial-embed="${form}" data-dial-routing="true">Find the right appointment</button>\n${script}`;
}
