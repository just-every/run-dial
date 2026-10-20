/** Stripe's REST API and Connect OAuth endpoints, form-encoded as Stripe requires. The platform secret key
 * authenticates every call; a connected account is addressed with the Stripe-Account header. */
export class StripeApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(`stripe_${code}`); }
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  expires_at: number;
  metadata?: Record<string, string>;
};

const apiOrigin = "https://api.stripe.com";
const connectOrigin = "https://connect.stripe.com";

export class StripeApi {
  constructor(private readonly secretKey: string, private readonly transport: typeof fetch = fetch) {}

  static authorizeUrl(clientId: string, redirectUri: string, state: string) {
    const url = new URL("/oauth/authorize", connectOrigin);
    for (const [key, value] of Object.entries({ response_type: "code", client_id: clientId, scope: "read_write", redirect_uri: redirectUri, state })) url.searchParams.set(key, value);
    return url.toString();
  }

  async exchangeCode(code: string) {
    const body = await this.request<{ stripe_user_id?: unknown; livemode?: unknown }>(`${connectOrigin}/oauth/token`, { grant_type: "authorization_code", code });
    if (typeof body.stripe_user_id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(body.stripe_user_id)) throw new StripeApiError(502, "invalid_oauth_response");
    return { accountId: body.stripe_user_id, livemode: body.livemode === true };
  }

  async deauthorize(clientId: string, accountId: string) {
    await this.request(`${connectOrigin}/oauth/deauthorize`, { client_id: clientId, stripe_user_id: accountId });
  }

  createCheckoutSession(accountId: string, params: Record<string, string>, idempotencyKey: string) {
    return this.request<CheckoutSession>(`${apiOrigin}/v1/checkout/sessions`, params, { account: accountId, idempotencyKey });
  }

  expireCheckoutSession(accountId: string, sessionId: string) {
    return this.request<CheckoutSession>(`${apiOrigin}/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, { account: accountId });
  }

  getCheckoutSession(accountId: string, sessionId: string) {
    return this.request<CheckoutSession>(`${apiOrigin}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, undefined, { account: accountId });
  }

  private async request<T>(url: string, form?: Record<string, string>, options: { account?: string; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.secretKey}` };
    if (form) headers["content-type"] = "application/x-www-form-urlencoded";
    if (options.account) headers["stripe-account"] = options.account;
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    const response = await this.transport(url, { method: form ? "POST" : "GET", headers, ...(form ? { body: new URLSearchParams(form).toString() } : {}) });
    const body = await response.json().catch(() => undefined) as (T & { error?: { code?: unknown; type?: unknown } | string }) | undefined;
    if (!response.ok || !body) {
      // Only Stripe's machine code leaves this boundary; messages can echo request values.
      const error = body?.error;
      const code = typeof error === "string" ? error : typeof error?.code === "string" ? error.code : typeof error?.type === "string" ? error.type : "unavailable";
      throw new StripeApiError(response.status, code.replace(/[^a-z0-9_]/gi, "").slice(0, 80) || "unavailable");
    }
    return body;
  }
}
