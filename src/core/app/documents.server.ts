import { privateRequestServices, nativeRequestSession, deferPrivateRead } from "./private-request.server";
import { readWorkspaceReads } from "./workspace-reads.server";
import { installPublicOrigin } from "../shared/public-origin";
import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import { createApp } from "./hono";
import { createServices } from "./services";
import type { AppBindings } from "./bindings";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { canReadEmbedDocument } from "./embed-document-policy";

const bindings = () => env as unknown as AppBindings;

export async function readPrivateShell(setup = false, path = "/app") {
  const bound = bindings();
  const runtime = parseRuntimeEnvironment(bound);
  const services = privateRequestServices(bound) ?? createServices(bound.DB, runtime, bound.ASSETS, { files: bound.FILES });
  const request = getRequest();
  const nativeSession = await nativeRequestSession(request, services.operators.auth);
  if (!nativeSession) throw redirect({ to: "/signin" });
  const session = { id: nativeSession.operator.id, email: nativeSession.operator.email, sessionId: nativeSession.id, expiresAt: new Date(nativeSession.expiresAt).toISOString() };
  const completed = await services.hostSetup.completion();
  if (setup && completed) throw redirect({ to: "/app" });
  if (!setup && !completed) throw redirect({ to: "/setup" });
  const canInspectArchive = nativeSession.kind === "native" && nativeSession.operator.role === "owner";
  const profile = await services.hostProfile.getProfile();
  const pending = setup ? Promise.resolve({}) : readWorkspaceReads(path, request, bound, runtime, services, session, canInspectArchive);
  // Initial documents can send their head while fresh native reads finish.
  // Client navigation still waits for the populated destination before replacing it.
  const document = /^\/(app|setup)(\/|$)/.test(new URL(request.url).pathname);
  const reads = document ? deferPrivateRead(pending) : await pending;
  return {
    reads,
    profile,
    operator: session,
    canInspectArchive,
    publicOrigin: installPublicOrigin(runtime.APP_URL),
    editorConfigured: Boolean(runtime.RER_MANAGEMENT_ORIGIN || runtime.RER_INSTALLATION_ID),
  };
}

export async function readPublicDocument(path: string): Promise<{ status: number; payloadJson: string | null }> {
  const url = new URL(path, "http://dial.invalid");
  if (url.origin !== "http://dial.invalid") throw new Error("Invalid document path");
  if ((url.pathname === "/embed" || url.pathname.startsWith("/embed/")) && !await canReadEmbedDocument(url, publicServices().embeds)) {
    return { status: 404, payloadJson: null };
  }
  const pieces = url.pathname.split("/").filter(Boolean);
  let endpoint: string | undefined;
  if (url.pathname === "/") endpoint = "/api/public/home/profile";
  else if (["book", "embed"].includes(pieces[0]) && pieces.length >= 2 && pieces.length <= 4) {
    const [, handle, slug, step] = pieces;
    if (pieces[0] === "embed" && handle === "manage" && !step) endpoint = `/api/public/manage/${encodeURIComponent(slug)}`;
    else if (!slug) endpoint = `/api/public/profiles/${encodeURIComponent(handle)}`;
    else if (step === "details") endpoint = `/api/public/book/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/selection?${url.searchParams}`;
    else if (step === "confirmed") {
      const result = await publicServices().bookings.getPublicConfirmation({ handle, slug, token: url.searchParams.get("token") ?? "" });
      return result.kind === "found" ? { status: 200, payloadJson: JSON.stringify(result.booking) } : { status: result.kind === "expired" ? 410 : 404, payloadJson: null };
    } else if (!step || step === "request") endpoint = `/api/public/events/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
  } else if (pieces[0] === "manage" && pieces.length === 2) endpoint = `/api/public/manage/${encodeURIComponent(pieces[1])}`;
  if (!endpoint) return { status: 200, payloadJson: null };
  const bound = bindings();
  const origin = parseRuntimeEnvironment(bound).APP_URL;
  const response = await createApp().fetch(new Request(new URL(endpoint, origin)), bound);
  // HOME-001: the landing renders without a host profile; a 404 there only means no booking-profile link.
  if (url.pathname === "/" && response.status === 404) return { status: 200, payloadJson: null };
  return { status: response.status, payloadJson: response.ok ? await response.text() : null };
}

function publicServices() { const bound = bindings(); return createServices(bound.DB, parseRuntimeEnvironment(bound), bound.ASSETS, { files: bound.FILES }); }
