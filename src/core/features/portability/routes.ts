import schema from "virtual:dial-archive-schema";
import { createPortabilityHandler } from "@runeditrun/rer/modules/portability";
import { exportStatus, abortExport } from "@runeditrun/rer/internal/modules/portability/export.mjs";
import { applicationCatalog, catalogQuery } from "../../../../scripts/archive/catalog.mjs";
import { exportPolicy } from "../../../../scripts/archive/export-policy.mjs";
import { guardedBucket } from "../../../../scripts/archive/guarded-bucket.mjs";
import { acquireExport, renewExport, releaseExport, ArchiveMaintenance, maintenanceResponse } from "./admission";
import type { AppBindings } from "../../app/bindings";
import type { OperatorsService } from "../operators";

const reply = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
/** Export only. Native authority, Origin and job ownership guard every operation. */
export async function hostedExport(request: Request, env: AppBindings, operators: OperatorsService) {
 const url = new URL(request.url), origin = new URL(env.APP_URL).origin;
 if (url.origin !== origin || request.headers.has("host") && request.headers.get("host") !== new URL(origin).host) return reply("not_found", 404);
 if (!/^\/api\/portability\/exports(?:\/[a-zA-Z0-9-]+(?:\/(advance|download|abort))?)?$/.test(url.pathname)) return reply("not_found", 404);
 const session = await operators.auth.getSession(request);
 if (!session || session.kind !== "native" || session.operator.role !== "owner") return reply("native_owner_session_required", 401);
 if (request.headers.get("sec-fetch-site") === "cross-site" || !["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== origin) return reply("origin_refused", 403);
 const segments = url.pathname.split("/"), jobId = segments[4], action = segments[5];
 if (jobId && !await env.DB.prepare("SELECT 1 FROM rer_portability_jobs WHERE id=? AND actor=? AND kind='export'").bind(jobId, session.operator.id).first()) return reply("job_not_found", 404);
 const creating = !jobId && request.method === "POST";
 let lease = jobId ?? crypto.randomUUID(), held = false;
 try {
  // Base's client reads status before aborting. These metadata/cleanup operations
  // must survive expiry and snapshot preflight failure without renewing a lease.
  if (jobId && (request.method === "GET" && !action || request.method === "POST" && action === "abort")) {
   const result = action === "abort" ? await abortExport({ db: env.DB }, jobId) : await exportStatus({ db: env.DB }, jobId);
   if (action === "abort") await releaseExport(env.DB, jobId);
   return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  if (creating) await acquireExport(env.DB, lease);
  else await renewExport(env.DB, lease);
  held = true;
  const catalogue = applicationCatalog((await env.DB.prepare(catalogQuery).all()).results);
  if (JSON.stringify(catalogue) !== JSON.stringify(schema.catalog)) return reply("archive_schema_mismatch", 409);
  // Include the presented native capability if it was pasted into authored
  // content. Only a cookie that independently authenticates this exact session
  // is secret material; unrelated short cookies must not redact ordinary text.
  let nativeCookie = "";
  for (const cookie of (request.headers.get("cookie") ?? "").split(";").map(value => value.trim()).filter(value => /^(?:__Host-operator_session|operator_session_local)=/.test(value))) {
   const headers = new Headers(request.headers); headers.set("cookie", cookie);
   const current = await operators.auth.getSession(new Request(request.url, { headers }));
   if (current?.id === session.id) nativeCookie = cookie.slice(cookie.indexOf("=") + 1);
  }
  const { policy, knownSecrets } = await exportPolicy(env.DB, { ...env, ARCHIVE_NATIVE_COOKIE_SECRET: nativeCookie }, JSON.stringify(schema));
  const handle = await createPortabilityHandler({ db: env.DB, buckets: { FILES: guardedBucket(env.FILES, knownSecrets) }, policy, appOrigin: origin,
   authorize: async (authorizedRequest, operation) => {
    const current = await operators.auth.getSession(authorizedRequest);
    return operation.operation === "export" && current?.kind === "native" && current.operator.id === session.operator.id && current.operator.role === "owner" ? current.operator.id : null;
   } });
  const response = await handle(request);
  if (!response) return reply("not_found", 404);
  if (!response.ok) { if (creating) await releaseExport(env.DB, lease); return response; }
  // If a request outlasted its lease it can never publish/download a snapshot.
  await renewExport(env.DB, lease);
  if (creating) {
   const result = await response.clone().json() as { id: string };
   await env.DB.prepare("UPDATE dial_portability_admission SET id=? WHERE id=? AND kind='export'").bind(result.id, lease).run();
   lease = result.id;
  }
  return response;
 } catch (error) {
  if (creating && held) await releaseExport(env.DB, lease);
  return error instanceof ArchiveMaintenance ? maintenanceResponse() : reply("archive_export_refused", 409);
 } finally {
  // A failed preflight must not retain a lock without a created job.
  if (creating && lease.length && !await env.DB.prepare("SELECT 1 FROM rer_portability_jobs WHERE id=?").bind(lease).first()) await releaseExport(env.DB, lease);
 }
}
