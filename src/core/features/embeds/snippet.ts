/** PUBLIC-004: keep the bootstrap attributes and modal trigger in one place. */
export function embedSnippet(publicOrigin: string, handle: string, slug: string, mode: "inline" | "modal") {
  const script = `<script async src="${new URL("/embed/dial.js", publicOrigin).href}" data-dial-handle="${handle}" data-dial-embed="${slug}" data-dial-mode="${mode}"></script>`;
  return mode === "inline" ? script : `<button type="button" data-dial-embed="${slug}">Book a time</button>\n${script}`;
}
