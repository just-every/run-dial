import { escapeHtml as escape } from "../core/features/delivery/branded-layout";
import { pageStyle } from "../../modules/agent-door/page-style.ts";
import type { RegistryMetadata } from "./registry-metadata";

/** Public registration metadata only; no session, policy or native record reads. */
export function agentDocumentation(request: Request, metadata: RegistryMetadata): Response {
  const headers = {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
  const tools = metadata.tools.map(tool => `<li data-agent-tool="${escape(tool.name)}"><h3><code>${escape(tool.name)}</code></h3><p><strong>${escape(tool.title)}</strong> — ${escape(tool.description)}</p><dl><dt>Possible classes</dt><dd>${escape(tool.classes.join(", "))}</dd><dt>Scope</dt><dd><code>${escape(tool.scope)}</code></dd></dl></li>`).join("");
  const resources = metadata.resourceTemplates.map(resource => `<li data-agent-resource="${escape(resource.uriTemplate)}"><h3>${escape(resource.name)}</h3><p><code>${escape(resource.uriTemplate)}</code></p><p>${escape(resource.description)}</p></li>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent reference · ${escape(metadata.name)}</title><style>${pageStyle}</style></head><body><a class="skip" href="#main">Skip to content</a><header><a href="/docs">${escape(metadata.name)} documentation</a><nav aria-label="On this page"><a href="#tools">Tools</a><a href="#resources">Resource templates</a></nav></header><main id="main"><h1>Agent reference</h1><p>Specialist: <strong>${escape(metadata.specialist)}</strong>.</p><p>This inventory describes the current declared Core registry. Using a tool requires the sponsoring person's authority and an answered company policy.</p><section id="tools"><h2>Tools</h2><ul class="stack">${tools}</ul></section><section id="resources"><h2>Resource templates</h2>${resources ? `<ul class="stack">${resources}</ul>` : "<p>No resource templates are mounted.</p>"}</section></main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers });
}
