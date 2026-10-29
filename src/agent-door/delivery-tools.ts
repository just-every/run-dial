import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { bookingId } from "./booking-schemas";
import { bookingReadClass, stateDigest } from "./booking-native-state";
import { external, live, nativeTool, objectOutput, required, standard } from "./native-tool";

type Delivery = Awaited<ReturnType<AppServices["deliveryRecovery"]["list"]>>[number];
/** Keep recipient and retry metadata, never message subjects, bodies or payloads. */
function safeDelivery(delivery: Delivery) {
  return { id: delivery.id, kind: delivery.kind, state: delivery.state, attempts: delivery.attempts,
    recipient: delivery.recipient, lastErrorCode: delivery.lastErrorCode, nextAttemptAt: delivery.nextAttemptAt,
    retryId: delivery.retryId, retryState: delivery.retryState };
}

export function deliveryTools(services: AppServices): ToolDefinition[] {
  const retryInput = bookingId.extend({ deliveryId: z.string().length(26) });
  return [
    nativeTool({
      name: "dial.delivery.list", title: "List safe delivery status", scope: "dial:read", readOnly: true,
      description: "Read native delivery and retry status for a booking or erasure ID. Excludes raw mail, subjects, payloads and capability links. Returns all native status rows for this one record.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["NOTIFY-005", "CAL-005"],
      classify: () => bookingReadClass(),
      async run({ id }) { return { result: { deliveries: (await services.deliveryRecovery.list(id)).map(safeDelivery) } }; },
    }),
    nativeTool({
      name: "dial.delivery.retry", title: "Retry failed delivery", scope: "dial:write", readOnly: false,
      description: "Use the native safe-retry command for a booking or erasure delivery. Refuses stale or ambiguous sends under native rules; an existing retry returns its exact state. Queued is not provider success.",
      input: retryInput, outputSchema: objectOutput, classes: ["standard", "external", "live"], clauses: ["NOTIFY-005", "CAL-004", "CAL-005"],
      async classify({ id, deliveryId }) {
        const delivery = required((await services.deliveryRecovery.list(id)).find(row => row.id === deliveryId));
        if (delivery.retryId) return standard();
        return [...standard(), ...(delivery.kind === "mail_send" || delivery.kind === "reminder"
          ? [external(1), live("transactional_mail")] : [external(1), live("calendar")])];
      },
      revisionType: "string", async revision({ id, deliveryId }, ctx) {
        const delivery = required((await services.deliveryRecovery.list(id)).find(row => row.id === deliveryId));
        const row = await ctx.db.prepare("SELECT updated_at AS updatedAt FROM delivery_outbox WHERE id=? AND booking_id=?").bind(deliveryId, id).first();
        return stateDigest({ delivery, row, booking: await services.bookings.getForOperator(id) });
      },
      async summary({ id, deliveryId }, ctx) {
        const delivery = required((await services.deliveryRecovery.list(id)).find(row => row.id === deliveryId));
        return { target: { id: deliveryId, name: delivery.kind }, ...(delivery.recipient ? { recipients: [delivery.recipient] } : {}),
          items: [`Retry the native ${delivery.state} delivery for ${id}.`,
            "Preserve native provider identity and current-record eligibility; do not reopen completed or ambiguous work.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, deliveryId }, ctx) {
        const result = await services.deliveryRecovery.retry(id, deliveryId);
        if (!result) throw new ToolRefusal("delivery_not_retryable");
        return { result: { ...result, preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.delivery.preferences-read", title: "Read own booking mail preference", scope: "dial:read", readOnly: true,
      description: "Read the authenticated native owner's booking-mail mute preference. Alternative-request and required system mail are outside this preference.",
      input: z.object({}).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["NOTIFY-008"],
      classify: () => standard(),
      async run(_args, ctx) { return { result: await services.deliveryPreferences.get(ctx.person.id) }; },
    }),
    nativeTool({
      name: "dial.delivery.preferences-update", title: "Update own booking mail preference", scope: "dial:write", readOnly: false,
      description: "Set the authenticated native owner's booking-mail mute preference. Applies to that owner's booking notices and reminders at send time.",
      input: z.object({ bookingMailMuted: z.boolean() }).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["NOTIFY-008"],
      async classify(_args, ctx) { await services.deliveryPreferences.get(ctx.person.id); return standard(); },
      revisionType: "string", async revision(_args, ctx) {
        const row = await ctx.db.prepare("SELECT booking_mail_muted AS muted,updated_at AS updatedAt FROM operator_delivery_preferences WHERE operator_id=?").bind(ctx.person.id).first();
        return stateDigest({ row, current: await services.deliveryPreferences.get(ctx.person.id) });
      },
      async summary({ bookingMailMuted }, ctx) {
        const current = await services.deliveryPreferences.get(ctx.person.id);
        return { target: { id: ctx.person.id, name: ctx.person.name, email: ctx.person.email },
          items: [`Change booking mail muted from ${current.bookingMailMuted} to ${bookingMailMuted}.`,
            "Invitees and other operators retain their own native notification rules.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ bookingMailMuted }, ctx) {
        return { result: { ...await services.deliveryPreferences.set(ctx.person.id, bookingMailMuted), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.delivery.health", title: "Read mail connection health", scope: "dial:read", readOnly: true,
      description: "Read the recorded native transactional-mail connection and event-tracking status. Makes no provider call.",
      input: z.object({}).strict(), outputSchema: objectOutput, classes: ["standard"], clauses: ["NOTIFY-005", "NOTIFY-007"],
      classify: () => standard(), async run() { return { result: await services.delivery.mailHealth() }; },
    }),
    nativeTool({
      name: "dial.delivery.check", title: "Check native mail connection", scope: "dial:write", readOnly: false,
      description: "Run the real native sender-domain/provider health check and persist its exact healthy or unavailable result. Does not send test mail or expose provider credentials.",
      input: z.object({}).strict(), outputSchema: objectOutput, classes: ["standard", "live"], clauses: ["NOTIFY-005", "NOTIFY-007"],
      async classify() { const health = await services.delivery.mailHealth(); return [...standard(), live(health.provider)]; },
      revisionType: "string", async revision() { return stateDigest(await services.delivery.mailHealth()); },
      async summary(_args, ctx) {
        const health = await services.delivery.mailHealth();
        return { target: { name: health.provider }, items: [`Check the recorded ${health.state} mail connection with its native provider.`,
          "Persist the provider result and connection transition.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run(_args, ctx) { return { result: { ...await services.delivery.checkMailConnection(), preparedBy: ctx.actor } }; },
    }),
  ];
}
