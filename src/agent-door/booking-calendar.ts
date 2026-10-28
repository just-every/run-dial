import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { bookingId } from "./booking-schemas";
import { bookingReadClass, bookingResult, bookingRevision, bookingState, cancellationClasses, stateDigest } from "./booking-native-state";
import { external, live, nativeTool, objectOutput, required, standard } from "./native-tool";

export function bookingCalendarTools(services: AppServices): ToolDefinition[] {
  const revision = bookingRevision(services);
  return [
    nativeTool({
      name: "dial.bookings.calendar-conflict-restore", title: "Restore canonical calendar event", scope: "dial:write", readOnly: false,
      description: "Queue restoration of an open conflict for the current occurrence to Dial's canonical time and location. Restored records the queued command, not provider success.",
      input: bookingId.extend({ conflictId: z.string().length(26) }), outputSchema: objectOutput,
      classes: ["standard", "external", "live"], clauses: ["CAL-008", "CAL-004", "CAL-005", "AGENT-004"], untrusted: true,
      async classify({ id }) {
        const booking = required(await services.bookings.getForOperator(id));
        return [...standard(), ...(booking.calendarState !== "not_required" ? [live("calendar"), external(1)] : [])];
      },
      revisionType: "string", revision,
      async summary({ id, conflictId }, ctx) {
        const booking = required(await services.bookings.getForOperator(id));
        const conflict = required(booking.calendarConflicts.find(entry => entry.id === conflictId));
        return { target: { id, name: booking.eventTitle }, items: [
          `Restore conflict ${conflict.id} to ${booking.occurrence.startAt}–${booking.occurrence.endAt}.`,
          "Queue the native calendar repair; check calendarState for provider completion.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, conflictId }, ctx) {
        const result = await services.bookings.restoreCalendarConflictForOperator(id, conflictId);
        if (result !== "restored") throw new ToolRefusal(result);
        return { result: { kind: result, booking: bookingResult(required(await services.bookings.getForOperator(id))), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.bookings.calendar-deletion-status", title: "Read calendar deletion reconciliation", scope: "dial:read", readOnly: true,
      description: "Read recorded native deletion-inspection attempts, pending/failed state and exact resolution. No provider event content is returned.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["CAL-008", "CAL-005", "AGENT-004"],
      classify: () => bookingReadClass(),
      async run({ id }) { return { result: { probes: required(await services.bookings.calendarDeletionStatus(id)) } }; },
    }),
    nativeTool({
      name: "dial.bookings.calendar-deletion-retry", title: "Retry failed calendar deletion inspection", scope: "dial:write", readOnly: false,
      description: "Retry a failed native deletion probe. A fresh affirmative deletion cancels the booking, sends notices and requests its host refund; an unresolved inspection stays pending or failed.",
      input: bookingId.extend({ providerEventId: z.string().min(1).max(1024) }), outputSchema: objectOutput,
      classes: ["standard", "external", "live", "money"], clauses: ["CAL-008", "CAL-005", "PAY-003", "NOTIFY-004", "AGENT-004"], untrusted: true,
      async classify({ id }, ctx) { return [...await cancellationClasses(services, id, ctx), live("calendar")]; },
      revisionType: "string", async revision({ id }, ctx) {
        return stateDigest({ state: await bookingState(services, id, ctx), probes: await services.bookings.calendarDeletionStatus(id) });
      },
      async summary({ id, providerEventId }, ctx) {
        const booking = required(await services.bookings.getForOperator(id));
        return { target: { id, name: booking.eventTitle, email: booking.inviteeEmail }, items: [
          `Retry inspection of calendar event ${providerEventId}.`,
          `A verified deletion cancels this booking and requests its ${booking.money?.ledger.refundableCents ?? 0} USD cents host refund.`,
          "A present event may queue repair; ambiguous provider results retain their native state.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, providerEventId }, ctx) {
        const result = await services.bookings.retryCalendarDeletion(id, providerEventId);
        if (result !== "retried") throw new ToolRefusal(result);
        return { result: { kind: result, probes: required(await services.bookings.calendarDeletionStatus(id)),
          booking: bookingResult(required(await services.bookings.getForOperator(id))), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.bookings.manage-link-rotate", title: "Rotate booking manage capability", scope: "dial:write", readOnly: false,
      description: "Replace the native booking manage capability and invalidate earlier links. Returns status and expiry only; this native command does not send a replacement email.",
      input: bookingId, outputSchema: objectOutput, classes: ["standard", "access"], clauses: ["BOOK-006"],
      classify: () => [...standard(), { class: "access", facts: { measure: 1, direction: "narrows" } }],
      revisionType: "string", revision,
      async summary({ id }, ctx) {
        const booking = required(await services.bookings.getForOperator(id));
        return { target: { id, name: booking.eventTitle, email: booking.inviteeEmail }, items: [
          "Invalidate every earlier manage capability and replace it in the invitee's stored delivery records.",
          "This command does not email a replacement; no private capability is returned to the agent.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id }, ctx) {
        const result = required(await services.bookings.rotateManageTokenForOperator(id));
        if (result.kind !== "rotated") throw new ToolRefusal("manage_token_expired");
        return { result: { kind: result.kind, expiresAt: result.expiresAt, preparedBy: ctx.actor } };
      },
    }),
  ];
}
