import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import type { OperatorRequest } from "../core/features/availability-requests/service";
import { bookingId } from "./booking-schemas";
import { bookingReadClass, stateDigest } from "./booking-native-state";
import { resourceText } from "./resource-definition";
import { external, nativeTool, objectOutput, required, standard } from "./native-tool";

function safeRequest(request: OperatorRequest) {
  return { ...request, eventTitle: resourceText(request.eventTitle), inviteeName: resourceText(request.inviteeName),
    note: request.note ? resourceText(request.note) : null };
}

export function requestTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.requests.list", title: "List alternative-time requests", scope: "dial:read", readOnly: true,
      description: "List native alternative-time requests in submitted, handled or closed state. Output is paged up to 500 records, default 100; totalCount covers the full native result.",
      input: z.object({ state: z.enum(["submitted", "handled", "closed"]).optional(),
        limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).max(1_000_000).default(0) }).strict(),
      outputSchema: objectOutput, classes: ["sensitive"], clauses: ["REQUEST-003"], untrusted: true,
      classify: args => bookingReadClass(args.limit),
      async run({ state, limit, offset }) {
        const requests = await services.availabilityRequests.listForOperator(state);
        return { result: { requests: requests.slice(offset, offset + limit).map(safeRequest), totalCount: requests.length, limit, offset } };
      },
    }),
    nativeTool({
      name: "dial.requests.read", title: "Read alternative-time request", scope: "dial:read", readOnly: true,
      description: "Read native requested windows in invitee and host zones, the state, and the linked booking identity without review nonces or capabilities.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["REQUEST-003"], untrusted: true,
      classify: () => bookingReadClass(),
      async run({ id }) { return { result: safeRequest(required(await services.availabilityRequests.getForOperator(id))) }; },
    }),
    nativeTool({
      name: "dial.requests.transition", title: "Resolve alternative-time request", scope: "dial:write", readOnly: false,
      description: "Mark a submitted request handled or closed and queue exactly the native invitee update. To link a real booking, use dial.bookings.create with requestId; no synthetic booking is recorded here.",
      input: bookingId.extend({ state: z.enum(["handled", "closed"]) }), outputSchema: objectOutput,
      classes: ["standard", "external"], clauses: ["REQUEST-003", "REQUEST-005"], untrusted: true,
      async classify({ id }) {
        const request = required(await services.availabilityRequests.getForOperator(id));
        return request.state === "submitted" ? [...standard(), external(1)] : standard();
      },
      revisionType: "string", async revision({ id }) { return stateDigest(required(await services.availabilityRequests.getForOperator(id))); },
      async summary({ id, state }, ctx) {
        const request = required(await services.availabilityRequests.getForOperator(id));
        return { target: { id, name: request.eventTitle, email: request.inviteeEmail }, recipients: [request.inviteeEmail],
          items: [`Mark the ${request.state} request ${state}.`, "Queue the native invitee status email.", `Prepared by ${ctx.actor.label}.`] };
      },
      async run({ id, state }, ctx) {
        const result = await services.availabilityRequests.transitionForOperator(id, state, ctx.person.id);
        if (typeof result === "string") throw new ToolRefusal(result === "not_found" ? "availability_request_not_found" : "availability_request_resolved");
        return { result: { request: safeRequest(result), preparedBy: ctx.actor } };
      },
    }),
  ];
}
