import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { hostDateFilterBounds } from "../core/features/bookings/operator-date-filters";
import { bookingCreate, bookingId, bookingList } from "./booking-schemas";
import { bookingReadClass, bookingResult, hostRecipients, stateDigest } from "./booking-native-state";
import { bookingLifecycleTools } from "./booking-lifecycle";
import { bookingApprovalTools } from "./booking-approvals";
import { bookingCalendarTools } from "./booking-calendar";
import { requestTools } from "./request-tools";
import { reportingTools } from "./reporting-tools";
import { deliveryTools } from "./delivery-tools";
import { external, live, nativeTool, objectOutput, required, standard, type ToolContext } from "./native-tool";

/** Native booking operations and the request, reporting and delivery doors they use. */
export function bookingTools(services: AppServices): ToolDefinition[] {
  const creationState = async (args: z.output<typeof bookingCreate>, ctx: ToolContext) => {
    const [event, request, hosts, profile, connection] = await Promise.all([
      services.eventTypes.getEventType(args.eventTypeId),
      args.requestId ? services.availabilityRequests.getForOperator(args.requestId) : undefined,
      hostRecipients(ctx), services.hostProfile.getProfile(), services.calendar.connectionHealth(),
    ]);
    return { event: required(event), request, hosts, profile, connection };
  };
  return [
    nativeTool({
      name: "dial.bookings.list", title: "List bookings", scope: "dial:read", readOnly: true,
      description: "List the native booking workspace using current filters. Host dates use the host profile zone. Returns up to 500 safe records and totalCount; default 100.",
      input: bookingList, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["BOOK-004", "REPORT-002"], untrusted: true,
      classify: args => bookingReadClass(args.limit),
      async run({ fromDate, throughDate, ...filters }) {
        const profile = await services.hostProfile.getProfile();
        if ((fromDate || throughDate) && !profile) throw new ToolRefusal("host_profile_required");
        const bounds = profile ? hostDateFilterBounds(fromDate, throughDate, profile.timezone) : {};
        const result = await services.bookings.listForOperatorWithCount({ ...filters, ...bounds });
        return { result: { bookings: result.bookings.map(bookingResult), totalCount: result.totalCount, limit: filters.limit, offset: filters.offset, hostTimezone: profile?.timezone ?? null } };
      },
    }),
    nativeTool({
      name: "dial.bookings.read", title: "Read booking", scope: "dial:read", readOnly: true,
      description: "Read the current native booking, history, attendance, delivery metadata and money outcomes. Capability links and raw mail are excluded.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["BOOK-004", "BOOK-010", "BOOK-011", "PAY-003"], untrusted: true,
      classify: () => bookingReadClass(),
      async run({ id }) {
        return { result: bookingResult(required(await services.bookings.getForOperator(id))) };
      },
    }),
    nativeTool({
      name: "dial.bookings.create", title: "Create booking", scope: "dial:write", readOnly: false,
      description: "Use the native operator booking command, including final availability validation, optional UUID idempotency and atomic alternative-request linkage. Does not charge for priced event types.",
      input: bookingCreate, outputSchema: objectOutput, classes: ["standard", "external", "live"], clauses: ["BOOK-001", "BOOK-002", "BOOK-003", "BOOK-012", "REQUEST-003", "NOTIFY-001"], untrusted: true,
      async classify(args, ctx) {
        const state = await creationState(args, ctx);
        return [...standard(), external(1 + state.hosts.filter(host => !host.bookingMailMuted).length, "new"),
          ...(!state.event.requestOnly && state.connection.state !== "disconnected" ? [live("calendar")] : [])];
      },
      revisionType: "string", revision: async (args, ctx) => stateDigest(await creationState(args, ctx)),
      async summary(args, ctx) {
        const { event, hosts } = await creationState(args, ctx);
        return { target: { id: event.id, name: event.title, email: args.email },
          recipients: [args.email, ...hosts.filter(host => !host.bookingMailMuted).map(host => host.email)],
          items: [`Book ${args.startAt} in ${args.inviteeTimezone}.`, `Prepared by ${ctx.actor.label}.`,
            ...(args.requestId ? [`Link alternative request ${args.requestId} only if it is submitted and matches this event and email.`] : []),
            ...(args.overrideNoticeAndHorizon ? ["Override the published notice and horizon; native conflict checks still apply."] : [])] };
      },
      async run(args, ctx) {
        const input = { ...args, operatorId: ctx.person.id };
        // Recover first, matching the native route even after its linked request becomes handled.
        const recovered = await services.bookings.recoverOperatorCreation(input);
        if (recovered) {
          if (recovered.kind !== "replayed") throw new ToolRefusal(recovered.kind);
          return { result: { kind: recovered.kind, booking: bookingResult(recovered.booking), preparedBy: ctx.actor } };
        }
        if (args.requestId) {
          const request = await services.availabilityRequests.getForOperator(args.requestId);
          if (!request) throw new ToolRefusal("availability_request_not_found");
          if (request.state !== "submitted" || request.eventTypeId !== args.eventTypeId || request.inviteeEmail.toLowerCase() !== args.email.toLowerCase())
            throw new ToolRefusal("availability_request_not_eligible");
        }
        const result = await services.bookings.createForOperator(input);
        if (result.kind !== "created" && result.kind !== "replayed")
          throw new ToolRefusal(result.kind, result.kind, result.kind === "slot_invalid" ? { exclusions: result.exclusions } : {});
        return { result: { kind: result.kind, booking: bookingResult(result.booking), preparedBy: ctx.actor } };
      },
    }),
    ...bookingLifecycleTools(services), ...bookingApprovalTools(services), ...bookingCalendarTools(services),
    ...requestTools(services), ...reportingTools(services), ...deliveryTools(services),
  ];
}
