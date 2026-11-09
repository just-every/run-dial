import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";

import type { AppServices } from "../core/app/services";
import type { OperatorRequest } from "../core/features/availability-requests/service";
import { bookingId } from "./booking-schemas";
import { bookingReadClass } from "./booking-native-state";
import { resourceText } from "./resource-definition";
import { nativeTool, objectOutput, required } from "./native-tool";

function safeRequest(request: OperatorRequest) {
  return { ...request, eventTitle: resourceText(request.eventTitle), inviteeName: resourceText(request.inviteeName),
    note: request.note ? resourceText(request.note) : null };
}

export function requestTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.requests.exception_proposals", title: "Read advisory exception times", scope: "dial:read", readOnly: true,
      description: "Read up to three fresh advisory times for a submitted native alternative request, outside recurring event hours but inside saved host hours and stored invitee windows. No approval, booking, hold or sending authority is created. Connected calendars and unsupported event combinations refuse.",
      input: bookingId, outputSchema: objectOutput, classes: ["sensitive"], clauses: ["AGENT-002"], untrusted: true,
      classify: () => bookingReadClass(),
      async run({ id }) {
        const result = await services.exceptionProposals.read(id);
        if (result.kind === "proposals") return { result: result.result };
        throw new ToolRefusal(result.kind === "not_found" ? "availability_request_not_found"
          : result.kind === "resolved" ? "availability_request_resolved"
          : result.kind === "unsupported" ? "exception_proposals_unsupported"
          : result.kind === "host_hours_required" ? "host_hours_required" : "availability_unavailable");
      },
    }),
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
  ];
}
