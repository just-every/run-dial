import { env } from "cloudflare:workers";
import { ProviderFailure, type ProviderFailureCode } from "./calendar/types";

// The namespace already coordinates bookings. This distinct singleton orders
// operator access changes against invocation of operator notification providers.
export const operatorNotificationBoundary = "operator-notifications";

export async function operatorNotificationCommand<T>(operation: "send", input: unknown): Promise<T> {
  const namespace = (env as { BOOKING_COORDINATOR?: DurableObjectNamespace }).BOOKING_COORDINATOR;
  if (!namespace) throw new Error("Missing Worker binding: BOOKING_COORDINATOR");
  const response = await namespace.get(namespace.idFromName(operatorNotificationBoundary)).fetch(new Request(
    `http://coordinator.internal/__operator-notifications/${operation}`,
    { method: "POST", body: JSON.stringify(input) },
  ));
  const result = await response.json<{ value?: T; error?: { code: ProviderFailureCode; retryable: boolean; retryAfterSeconds?: number } }>();
  if (!response.ok || result.error) throw new ProviderFailure(result.error?.code ?? "operator_notification_coordination_failed", result.error?.retryable ?? false, result.error?.retryAfterSeconds);
  return result.value as T;
}
