import { nativeRequestSession } from "../../app/private-request.server";
import { signedOwnerClaimConfigured } from "./owner-claim.server";
import { operatorRateCorrelation } from "./rate-correlation";
import { createAuthHandler, createOperatorAuth, AuthError, type OperatorAuth, type PolicyInput } from "../../../../modules/operator-auth/index.mjs";
import type { MailSender as AuthMailSender } from "../../../../modules/operator-auth/index.mjs";
import { createAuthenticationMail } from "../../platform/mail/base-mail";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { operatorAuthConfig } from "./auth-config";
import type { SessionRecord } from "./repository";
import { anonymousMagicLinkRequest } from "./anonymous-signin";

/** Product projection only: all authentication and token custody belong to Base. */
export class OperatorsService {
  private service?: OperatorAuth;
  private mailConfigured = false;
  constructor(private readonly binding: D1Database, private readonly runtime: RuntimeEnvironment, private readonly mail?: AuthMailSender) {}

  get signInMailConfigured() { return this.mailConfigured; }

  get auth(): OperatorAuth {
    if (this.service) return this.service;
    const config = operatorAuthConfig(this.runtime);
    const { local } = config;
    const { MAIL_FROM, RESEND_FROM_EMAIL } = this.runtime;
    const mailSender = this.mail ?? createAuthenticationMail(this.runtime);
    this.service = createOperatorAuth({
      db: this.binding, config,
      mailSender,
      clientIp: (request) => local ? "loopback" : request.headers.get("cf-connecting-ip") ?? "",
      rolePolicy: (input) => this.equalOperatorPolicy(input),
      hooks: { rateCorrelation: operatorRateCorrelation(this.binding) },
    });
    this.mailConfigured = Boolean(mailSender && (MAIL_FROM ?? RESEND_FROM_EMAIL));
    return this.service;
  }

  private async equalOperatorPolicy({ actor, action, target, role }: PolicyInput) {
    if (actor.status !== "active" || action === "operators:role" || (role && role !== "owner")) return false;
    if (action === "operators:deactivate" && target) {
      const setup = await this.binding.prepare("SELECT operator_id FROM operator_setup_identity WHERE singleton_key='default'").first<{ operator_id: string }>();
      if (!setup) return false;
      return target.id !== setup.operator_id || actor.id === target.id;
    }
    return true;
  }

  async handle(request: Request) {
    // Operator mutations pass through Dial's notification coordination boundary.
    const path = new URL(request.url).pathname;
    if (["/auth/invite", "/auth/invite/cancel", "/auth/operator/status", "/auth/operator/role"].includes(path)) return new Response("Not found", { status: 404 });
    // A hosted claim deployment must never expose its hidden bootstrap token path.
    // Partial configuration also closes this door; local installs without these bindings keep native setup.
    if (path === "/auth/bootstrap" && signedOwnerClaimConfigured(this.runtime)) return Response.json({ error: "claim_required" }, { status: 403, headers: { "cache-control": "no-store" } });
    const auth = this.auth;
    const response = await createAuthHandler(path === "/auth/magic-link" ? {
      ...auth,
      requestMagicLink: async (request, input) => {
        await anonymousMagicLinkRequest(() => auth.requestMagicLink(request, input), () => this.signInMailConfigured);
        return { status: "accepted" };
      },
    } : auth)(request);
    return response;
  }

  async requestMagicLink(request: Request, email: string) {
    await this.auth.requestMagicLink(request, { email, returnTo: "/setup" });
    return { kind: "queued" as const };
  }

  async authenticate(request: Request): Promise<SessionRecord | undefined> {
    const value = await nativeRequestSession(request, this.auth);
    return value ? { id: value.operator.id, email: value.operator.email, sessionId: value.id, expiresAt: new Date(value.expiresAt).toISOString() } : undefined;
  }

  async requireMutation(request: Request) {
    const origin = new URL(this.runtime.APP_URL).origin;
    if (request.method !== "POST" || request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("invalid_origin", 403);
    const session = await this.auth.getSession(request);
    if (!session) throw new AuthError("unauthenticated", 401);
    return session;
  }

  async signOut(request: Request) { return (await this.auth.signOut(request)).cookie; }

}
export { AuthError };
