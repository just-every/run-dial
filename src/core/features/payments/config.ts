import type { RuntimeEnvironment } from "../../shared/runtime-env";

/** The operator-held Stripe platform secret key, Connect client ID and webhook signing secret (deploy secrets). */
export function stripeConfiguration(runtime: RuntimeEnvironment) {
  const { STRIPE_SECRET_KEY: secretKey, STRIPE_CONNECT_CLIENT_ID: clientId, STRIPE_WEBHOOK_SECRET: webhookSecret } = runtime;
  return secretKey && clientId && webhookSecret ? { secretKey, clientId, webhookSecret } : undefined;
}

export const stripeCallbackPath = "/api/payments/stripe/oauth/callback";
export const stripeWebhookPath = "/api/webhooks/stripe";
/** The Connect events Dial's webhook endpoint must subscribe to. */
export const stripeWebhookEvents = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.succeeded", "payment_intent.payment_failed", "invoice.paid", "account.application.deauthorized"] as const;
