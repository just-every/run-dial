import manifest from "../../../seed.json";
import { createId } from "../shared/ids";
import type { RuntimeEnvironment } from "../shared/runtime-env";
import { hashToken } from "./auth/tokens";

export type CallbackProvider = "google_calendar" | "resend" | "sendgrid" | "stripe";
export type Admission = { kind: "admitted" } | { kind: "limited"; retryAfterSeconds: number };
export type AdmitCallback = () => Promise<Admission>;
type Rule = { predicate: string; args: (string | number)[]; windowMs: number; limit: number };

export class PublicAdmissionError extends Error {
  constructor(readonly code: "client_identity_unavailable" | "rate_limit_state_unavailable") { super(code); }
}

export function isAuthenticatedCallbackPath(request: Request) {
  const path = new URL(request.url).pathname;
  return request.method === "POST" && ["/api/webhooks/google-calendar", "/api/webhooks/resend", "/api/webhooks/sendgrid", "/api/webhooks/stripe"].includes(path);
}

export function requiresPublicAdmission(path: string) {
  return manifest.deploy.publicPaths.some((entry) => entry.endsWith("/") && entry !== "/" ? path.startsWith(entry) : path === entry);
}

export class PublicAdmissionGate {
  constructor(private readonly binding: D1Database, private readonly runtime: RuntimeEnvironment) {}

  async admit(request: Request, provider?: CallbackProvider, now = Date.now()): Promise<Admission> {
    const client = clientIdentity(request, this.runtime);
    const clientKey = await hashToken(`public-client:${client}`, this.runtime.SESSION_SECRET);
    const path = new URL(request.url).pathname;
    const mutation = request.method === "POST" && (/^\/api\/public\/routing\/[^/]+$/.test(path) || /^\/api\/public\/polls\/[^/]+\/votes$/.test(path) || /^\/api\/public\/book\/[^/]+\/[^/]+\/(confirm|remember\/(request|redeem))$/.test(path) || /^\/api\/public\/manage\/[^/]+\/(cancel|reschedule)$/.test(path));
    const invitation = request.method === "POST" && /^\/api\/public\/manage\/invite\/[^/]+\/email$/.test(path);
    const alternative = request.method === "POST" && /^\/api\/public\/events\/[^/]+\/[^/]+\/request$/.test(path);
    const minute = 60_000;
    const rules: Rule[] = [{ predicate: "client_key = ?", args: [clientKey], windowMs: minute, limit: manifest.limits.publicRequestsPerIpPerMinute }];
    if (mutation || invitation) rules.push({ predicate: "client_key = ? AND booking_mutation = 1", args: [clientKey], windowMs: minute, limit: manifest.limits.bookingMutationsPerIpPerMinute });
    if (alternative) rules.push({ predicate: "client_key = ? AND alternative_submission = 1", args: [clientKey], windowMs: 60 * minute, limit: manifest.limits.alternativeRequestsPerIpPerHour });
    if (provider) rules.push({ predicate: "provider = ?", args: [provider], windowMs: minute, limit: manifest.limits.webhookRequestsPerProviderPerMinute });
    const timestamp = new Date(now).toISOString();
    const predicates = rules.map((rule) => `(SELECT count(*) FROM public_rate_events WHERE ${rule.predicate} AND admitted_at > ?) < ?`);
    const argumentsForRules = rules.flatMap((rule) => [...rule.args, now - rule.windowMs, rule.limit]);
    try {
      const result = await this.binding.batch([
        this.binding.prepare("DELETE FROM public_rate_events WHERE id IN (SELECT id FROM public_rate_events WHERE expires_at <= ? ORDER BY expires_at LIMIT 1000)").bind(now),
        this.binding.prepare(`INSERT INTO public_rate_events (id, client_key, booking_mutation, alternative_submission, provider, admitted_at, expires_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${predicates.join(" AND ")}`)
          .bind(createId(), clientKey, mutation || invitation ? 1 : 0, alternative ? 1 : 0, provider ?? null, now, now + Math.max(...rules.map((rule) => rule.windowMs)), timestamp, timestamp, ...argumentsForRules),
      ]);
      if (result[1].meta.changes === 1) return { kind: "admitted" };
      const counts = await Promise.all(rules.map((rule) => this.binding.prepare(`SELECT count(*) AS count, min(admitted_at) AS oldest FROM public_rate_events WHERE ${rule.predicate} AND admitted_at > ?`).bind(...rule.args, now - rule.windowMs).first<{ count: number; oldest: number | null }>()));
      const waits = counts.map((count, index) => count && count.count >= rules[index].limit && count.oldest !== null ? Math.ceil((count.oldest + rules[index].windowMs - now) / 1000) : 1);
      return { kind: "limited", retryAfterSeconds: Math.max(1, ...waits) };
    } catch { throw new PublicAdmissionError("rate_limit_state_unavailable"); }
  }

  async expire(now = Date.now()) {
    await this.binding.prepare("DELETE FROM public_rate_events WHERE expires_at <= ?").bind(now).run();
  }
}

function clientIdentity(request: Request, runtime: RuntimeEnvironment) {
  const reported = request.headers.get("CF-Connecting-IP");
  if (reported) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(reported) && reported.split(".").every((part) => Number(part) <= 255)) return reported.split(".").map(Number).join(".");
    if (/^[a-fA-F0-9:.]+$/.test(reported) && reported.includes(":")) {
      try { return new URL(`http://[${reported}]/`).hostname.toLowerCase(); } catch { /* Invalid edge identity is not accepted. */ }
    }
    throw new PublicAdmissionError("client_identity_unavailable");
  }
  const url = new URL(runtime.APP_URL);
  if (runtime.ENVIRONMENT === "development" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && new URL(request.url).host === url.host) return "loopback";
  throw new PublicAdmissionError("client_identity_unavailable");
}

export function admissionResponse(admission: Admission) {
  return admission.kind === "limited" ? Response.json({ error: { code: "rate_limited", message: "Too many requests. Please wait and retry; your entered details are kept." } }, { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds), "Cache-Control": "no-store" } }) : undefined;
}

export function admissionErrorResponse(error: PublicAdmissionError) {
  return Response.json({ error: { code: error.code, message: error.code === "client_identity_unavailable" ? "The deployment cannot identify the connecting client. Contact the host." : "Public admission state is unavailable. Please retry later." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
