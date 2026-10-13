import { parseConfig } from "../../../../modules/editor/config";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { OperatorsService } from "../operators";

function editorConfig(runtime: RuntimeEnvironment) {
  if (!runtime.RER_MANAGEMENT_ORIGIN && !runtime.RER_INSTALLATION_ID) return null;
  return parseConfig({ enabled: true, managementOrigin: runtime.RER_MANAGEMENT_ORIGIN, installationId: runtime.RER_INSTALLATION_ID });
}

export async function editorConfigResponse(runtime: RuntimeEnvironment, operators: OperatorsService, request: Request) {
  const headers = { "cache-control": "no-store, private", vary: "Cookie" };
  try {
    const session = await operators.auth.getSession(request);
    if (!session || session.operator.role !== "owner") return Response.json({ error: "Owner authorization required" }, { status: 403, headers });
    if (request.method !== "GET") return Response.json({ error: "GET required" }, { status: 405, headers: { ...headers, allow: "GET" } });
    const config = editorConfig(runtime);
    if (!config) return Response.json({ error: "Editor is not configured" }, { status: 503, headers });
    return Response.json({ config, expiresAt: Math.min(session.expiresAt, Date.now() + 30_000) }, { headers });
  } catch { return Response.json({ error: "Editor authorization unavailable" }, { status: 503, headers }); }
}

export function editorDocument(response: Response, runtime: RuntimeEnvironment) {
  let origin: string | undefined;
  try { origin = editorConfig(runtime)?.managementOrigin; } catch { /* Invalid configuration grants no framing authority. */ }
  const headers = new Headers(response.headers);
  const directives = (headers.get("content-security-policy") ?? "").split(";").map(value => value.trim()).filter(value => value && !/^(frame-ancestors|frame-src)\b/i.test(value));
  headers.delete("x-frame-options");
  headers.set("content-security-policy", [...directives, `frame-ancestors 'self'${origin ? ` ${origin}` : ""}; frame-src ${origin ?? "'none'"}`, ...(directives.some(value => /^object-src\b/i.test(value)) ? [] : ["object-src 'none'"]), ...(directives.some(value => /^base-uri\b/i.test(value)) ? [] : ["base-uri 'self'"])].join("; "));
  headers.set("cache-control", "no-store, private");
  headers.append("vary", "Cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
