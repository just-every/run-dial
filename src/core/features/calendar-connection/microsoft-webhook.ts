import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { AdmitCallback } from "../../platform/public-admission";
import { sameSecret } from "./oauth-state";
import type { CalendarConnectionRepository } from "./repository";

/** Graph callbacks are wake-ups only. Delta and fresh inspection own every change. */
export async function receiveMicrosoftWebhook(repository: CalendarConnectionRepository, runtime: RuntimeEnvironment, body: unknown, admit: AdmitCallback) {
  const secret = runtime.CALENDAR_WEBHOOK_SECRET;
  if (!secret || (await repository.get())?.provider !== "microsoft" || !body || typeof body !== "object" || !("value" in body) || !Array.isArray(body.value) || !body.value.length || body.value.length > 100) return { kind: "unauthorized" as const };
  for (const item of body.value) {
    if (!item || typeof item !== "object" || typeof item.subscriptionId !== "string" || !sameSecret(secret, typeof item.clientState === "string" ? item.clientState : null) || !await repository.findPushChannel(item.subscriptionId, "me/events")) return { kind: "unauthorized" as const };
  }
  const admission = await admit();
  if (admission.kind === "limited") return { kind: "rate_limited" as const, retryAfterSeconds: admission.retryAfterSeconds };
  // Invalidate even a repeated callback: Graph omits a monotonic notification ID.
  // Neither callback ordering nor callback event contents can mutate a booking.
  await repository.invalidateBusyCache();
  return { kind: "accepted" as const };
}
