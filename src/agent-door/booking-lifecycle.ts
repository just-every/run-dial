import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { bookingResult,bookingRevision } from "./booking-native-state";
import { bookingId } from "./booking-schemas";
import { nativeTool,objectOutput,required,standard } from "./native-tool";

export function bookingLifecycleTools(services: AppServices): ToolDefinition[] {
  const revision = bookingRevision(services);
  return [
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
        const result = await services.bookings.markAttendance(id, ctx.person.id, status, `${ctx.actor.label}\n\n${note}`);
        if (result.kind !== "marked") throw new ToolRefusal(result.kind);
        return { result: { kind: result.kind, booking: bookingResult(required(result.booking)), preparedBy: ctx.actor } };
      },
    }),
  ];
}
