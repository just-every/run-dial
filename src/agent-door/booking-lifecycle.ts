import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { bookingId, cancellation, newTimeRequest, reschedule } from "./booking-schemas";
import { bookingRecipients, bookingResult, bookingRevision, cancellationClasses, lifecycleClasses, moneyClass } from "./booking-native-state";
import { external, live, nativeTool, objectOutput, required, standard } from "./native-tool";

export function bookingLifecycleTools(services: AppServices): ToolDefinition[] {
  const revision = bookingRevision(services);
  return [
    nativeTool({
      name: "dial.bookings.cancel", title: "Cancel booking", scope: "dial:write", readOnly: false,
      description: "Irreversibly cancel using native host cancellation. By default refunds all refundable money, charges no fee, voids open balances/invoices, and queues native notices/calendar work. A smaller refund needs a reason. Pending is not refunded.",
      input: cancellation, outputSchema: objectOutput, classes: ["standard", "external", "live", "money"],
      clauses: ["BOOK-008", "BOOK-009", "BOOK-010", "PAY-003", "PAY-005", "NOTIFY-004"], untrusted: true,
      classify: (args, ctx) => cancellationClasses(services, args.id, ctx, args.refund?.amountCents),
      revisionType: "string", revision,
      async summary(args, ctx) {
        const booking = required(await services.bookings.getForOperator(args.id));
        const refund = args.refund?.amountCents ?? booking.money?.ledger.refundableCents ?? 0;
        return { target: { id: booking.id, name: booking.eventTitle, email: booking.inviteeEmail },
          recipients: await bookingRecipients(ctx, booking, Boolean(booking.imported)),
          ...(refund > 0 ? { amount: { value: refund / 100, currency: "USD" }, payee: booking.inviteeEmail } : {}),
          items: [`Cancel ${booking.occurrence.startAt}; the booking cannot be restored.`,
            `Request ${refund} USD cents in refunds; provider completion is reported separately.`,
            "Void any open balance or invoice; send the native cancellation notices.",
            ...(args.refund ? [`Refund choice reason: ${args.refund.reason}`] : []), `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, reason, refund }, ctx) {
        const result = await services.bookings.cancelForOperator(id, ctx.person.id, reason, refund);
        if (result.kind !== "cancelled") throw new ToolRefusal(result.kind, result.kind,
          result.kind === "exceeds_refundable" ? { refundableCents: result.refundableCents } : {});
        return { result: { kind: result.kind, booking: bookingResult(required(await services.bookings.getForOperator(id))), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.bookings.reschedule", title: "Reschedule booking", scope: "dial:write", readOnly: false,
      description: "Move the native booking after fresh slot validation, preserve payment, and queue calendar and change notices. Explicitly choose whether to override published availability.",
      input: reschedule, outputSchema: objectOutput, classes: ["standard", "external", "live"],
      clauses: ["BOOK-001", "BOOK-004", "BOOK-009", "BOOK-010", "NOTIFY-004"], untrusted: true,
      classify: (args, ctx) => lifecycleClasses(services, args.id, ctx), revisionType: "string", revision,
      async summary(args, ctx) {
        const booking = required(await services.bookings.getForOperator(args.id));
        return { target: { id: booking.id, name: booking.eventTitle, email: booking.inviteeEmail }, recipients: await bookingRecipients(ctx, booking),
          items: [`Move ${booking.occurrence.startAt} to ${args.startAt} (${args.inviteeTimezone}).`,
            ...(args.overridePublishedAvailability ? ["Override published availability, notice and horizon; native conflicts still apply."] : []),
            "Preserve the existing payment and queue native change notices.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run(args, ctx) {
        const result = await services.bookings.rescheduleForOperator({ ...args, operatorId: ctx.person.id });
        if (result.kind !== "rescheduled") throw new ToolRefusal(result.kind, result.kind,
          result.kind === "slot_invalid" ? { exclusions: result.exclusions } : {});
        return { result: { kind: result.kind, booking: bookingResult(required(result.booking)), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.bookings.request_new_time", title: "Ask invitee to pick a new time", scope: "dial:write", readOnly: false,
      description: "Send the native new-time request with optional reminder. Releasing the original time may later cancel and refund if the request expires; preserving it expires no later than the original start.",
      input: newTimeRequest, outputSchema: objectOutput, classes: ["standard", "external", "live", "money"],
      clauses: ["BOOK-014", "BOOK-010", "PAY-003", "NOTIFY-009"], untrusted: true,
      async classify(args) {
        const booking = required(await services.bookings.getForOperator(args.id));
        return [...standard(), external(args.reminderHours === null ? 1 : 2),
          ...(args.releaseTime && booking.calendarState !== "not_required" ? [live("calendar")] : []),
          ...(args.releaseTime && booking.money ? [live("stripe"), moneyClass(booking.money.ledger.refundableCents)] : [])];
      },
      revisionType: "string", revision,
      async summary(args, ctx) {
        const booking = required(await services.bookings.getForOperator(args.id));
        return { target: { id: booking.id, name: booking.eventTitle, email: booking.inviteeEmail }, recipients: [booking.inviteeEmail],
          items: [`Email a request expiring in at most ${args.expiresInDays} days.`,
            args.releaseTime ? "Release the original time; expiry cancels and requests the native host refund." : "Keep the original time reserved; expiry leaves the booking in place.",
            args.reminderHours === null ? "No reminder." : `Send one reminder after ${args.reminderHours} hours if still open.`,
            `Message: ${args.message}`, `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, ...input }, ctx) {
        const result = await services.bookings.requestReschedule(id, ctx.person.id, input);
        if (result.kind !== "created") throw new ToolRefusal(result.kind);
        return { result: { kind: result.kind, booking: bookingResult(required(result.booking)), preparedBy: ctx.actor } };
      },
    }),
    nativeTool({
      name: "dial.bookings.attendance", title: "Mark booking attendance", scope: "dial:write", readOnly: false,
      description: "After the meeting ends, record attended or no-show with the native operator identity and note. This command does not charge a no-show fee.",
      input: bookingId.extend({ status: z.enum(["attended", "no_show"]), note: z.string().trim().max(4_000) }),
      outputSchema: objectOutput, classes: ["standard"], clauses: ["BOOK-011", "BOOK-010", "AGENT-001"], untrusted: true,
      classify: () => standard(), revisionType: "string", revision,
      async summary(args, ctx) {
        const booking = required(await services.bookings.getForOperator(args.id));
        return { target: { id: booking.id, name: booking.eventTitle, email: booking.inviteeEmail },
          items: [`Record ${args.status} for the meeting ending ${booking.occurrence.endAt}.`, `Note: ${args.note}`, `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, status, note }, ctx) {
        const result = await services.bookings.markAttendance(id, ctx.person.id, status, note);
        if (result.kind !== "marked") throw new ToolRefusal(result.kind);
        return { result: { kind: result.kind, booking: bookingResult(required(result.booking)), preparedBy: ctx.actor } };
      },
    }),
  ];
}
