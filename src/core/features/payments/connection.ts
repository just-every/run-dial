import { signOAuthState, verifyOAuthState } from "../calendar-connection";
import { createOpaqueToken } from "../../platform/auth/tokens";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { SessionRecord } from "../operators";
import { stripeCallbackPath, stripeConfiguration, stripeWebhookEvents, stripeWebhookPath } from "./config";
import type { PaymentsRepository } from "./repository";
import { StripeApi } from "./stripe-api";

const stateLifetimeMs = 10 * 60 * 1000;

/** Stripe Connect Standard OAuth under AUTH-004's rules: signed state bound to the operator session that began
 * it, single use, and issued less than ten minutes earlier. Only the connected account ID is kept. */
export class StripeConnection {
  constructor(private readonly repository: PaymentsRepository, private readonly runtime: RuntimeEnvironment, private readonly transport: typeof fetch) {}

  // A distinct HMAC key keeps calendar and payment states from verifying on each other's callback.
  private get stateSecret() { return `${this.runtime.SESSION_SECRET}:stripe-connect.v1`; }

  setupGuide() {
    return {
      redirectUri: new URL(stripeCallbackPath, this.runtime.APP_URL).toString(),
      webhookUrl: new URL(stripeWebhookPath, this.runtime.APP_URL).toString(),
      webhookEvents: [...stripeWebhookEvents],
      configured: Boolean(stripeConfiguration(this.runtime)),
    };
  }

  async status() {
    const connection = await this.repository.connection();
    return { ...this.setupGuide(), state: connection?.status ?? "disconnected", accountId: connection?.status === "connected" ? connection.accountId : null, livemode: connection?.livemode ?? false, achEnabled: connection?.achEnabled ?? false, statusChangedAt: connection?.statusChangedAt ?? null };
  }

  async begin(session: SessionRecord) {
    const config = stripeConfiguration(this.runtime);
    if (!config) return undefined;
    const id = createOpaqueToken(), issuedAt = new Date().toISOString();
    const state = await signOAuthState({ id, sessionId: session.sessionId, operatorId: session.id, issuedAt }, this.stateSecret);
    await this.repository.createOAuthState({ id, sessionId: session.sessionId, operatorId: session.id, expiresAt: new Date(Date.now() + stateLifetimeMs).toISOString() });
    return StripeApi.authorizeUrl(config.clientId, this.setupGuide().redirectUri, state);
  }

  async complete(input: { state?: string; code?: string; session?: SessionRecord }) {
    const config = stripeConfiguration(this.runtime);
    const state = input.state ? await verifyOAuthState(input.state, this.stateSecret) : undefined;
    if (!config || !state || !input.session || state.sessionId !== input.session.sessionId || state.operatorId !== input.session.id) return { kind: "invalid_state" as const };
    const issuedAt = Date.parse(state.issuedAt);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > stateLifetimeMs || issuedAt > Date.now() + 60_000) return { kind: "invalid_state" as const };
    if (!await this.repository.consumeOAuthState({ ...state, now: new Date().toISOString() }) || !input.code) return { kind: "invalid_state" as const };
    try {
      const granted = await new StripeApi(config.secretKey, this.transport).exchangeCode(input.code);
      await this.repository.saveConnection(granted.accountId, granted.livemode, input.session.id);
      return { kind: "connected" as const };
    } catch { return { kind: "provider_failure" as const }; }
  }

  /** Disconnect stops new paid bookings at once; Stripe is then asked to revoke Dial's access. */
  async disconnect() {
    const config = stripeConfiguration(this.runtime), connection = await this.repository.connection();
    await this.repository.markDisconnected();
    if (!config || !connection?.accountId || connection.status !== "connected") return { revoked: false };
    try { await new StripeApi(config.secretKey, this.transport).deauthorize(config.clientId, connection.accountId); return { revoked: true }; }
    catch { return { revoked: false }; }
  }
}
