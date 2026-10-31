import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { bookingReadClass } from "./booking-native-state";
import { nativeTool,objectOutput } from "./native-tool";
import { resourceText } from "./resource-definition";

export function bookingApprovalTools(services: AppServices): ToolDefinition[] {
  return [
    nativeTool({
      name: "dial.bookings.approvals_list", title: "List pending booking approvals", scope: "dial:read", readOnly: true,
      description: "List the first 100 native pending approval requests, including public payment state and frozen amounts without authorization secrets.",
      input: z.object({}).strict(), outputSchema: objectOutput, classes: ["sensitive"], clauses: ["BOOK-002", "PAY-007"], untrusted: true,
      classify: () => bookingReadClass(100),
      async run() {
        const approvals = await services.bookings.pendingApprovals();
        return { result: { approvals: approvals.map(request => ({ ...request, inviteeName: resourceText(request.inviteeName), eventTitle: resourceText(request.eventTitle) })), limit: 100 } };
      },
    }),
  ];
}
