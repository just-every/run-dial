import { isWebhookJob } from "../features/webhooks/delivery";
import type { AppBindings } from "./bindings";
import type { AppServices } from "./services";
import { parseRuntimeEnvironment } from "../shared/runtime-env";
import { isPlatformHealthJob } from "../platform/health";
import { PublicAdmissionGate } from "../platform/public-admission";
import { processCoordinatedDelivery, processDueCalendarDeletionProbes, processDueRescheduleRequests, processDueApprovalRequests } from "./booking-coordination";

/** The Worker's Queue handler: every delivery job runs under its booking's coordinator. */
export async function consumeJobs(batch: MessageBatch<unknown>, env: AppBindings, services: AppServices) {
  await Promise.all(batch.messages.map(async (message) => {
    if (isPlatformHealthJob(message.body)) {
      message.ack();
      return;
    }
    if (isWebhookJob(message.body)) { await services.webhooks.delivery.process(message.body.deliveryId); message.ack(); return; }
    await processCoordinatedDelivery(message.body, env, () => services.delivery.processUnknown(message.body));
    message.ack();
  }));
}

/** The Worker's Cron handler: connection health and alerts (its healthy check also times the next connection probe), calendar sync and channel renewal, due deliveries. */
export async function runScheduledWork(env: AppBindings, services: AppServices) {
  await processDueRescheduleRequests(env);
  await processDueApprovalRequests(env);
  // PAY-001: end payment windows by expiring their Checkout Sessions, then free the slots.
  await services.payments.sweepExpiredHolds();
  // PAY-003: re-send, with the same idempotency key, any refund or fee whose Stripe call was cut off.
  await services.payments.money.sweepPending();
  await services.delivery.reconcileConnections();
  await services.calendar.syncManagedEvents();
  await processDueCalendarDeletionProbes(env);
  await services.delivery.renewCalendarChannels();
  await services.delivery.enqueueDue(env.JOBS);
  await services.webhooks.delivery.enqueue(env.JOBS);
  // Admission-state cleanup cannot prevent the independent booking recovery work above.
  await new PublicAdmissionGate(env.DB, parseRuntimeEnvironment(env)).expire();
}
