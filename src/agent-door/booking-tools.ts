import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { hostDateFilterBounds } from "../core/features/bookings/operator-date-filters";
import { bookingApprovalTools } from "./booking-approvals";
import { bookingCalendarTools } from "./booking-calendar";
import { bookingLifecycleTools } from "./booking-lifecycle";
import { bookingReadClass,bookingResult } from "./booking-native-state";
import { bookingId,bookingList } from "./booking-schemas";
import { deliveryTools } from "./delivery-tools";
import { nativeTool,objectOutput,required } from "./native-tool";
import { reportingTools } from "./reporting-tools";
import { requestTools } from "./request-tools";

/** Native booking operations and the request, reporting and delivery doors they use. */
export function bookingTools(services: AppServices): ToolDefinition[] {
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
    ...bookingLifecycleTools(services), ...bookingApprovalTools(services), ...bookingCalendarTools(services),
    ...requestTools(services), ...reportingTools(services), ...deliveryTools(services),
  ];
}
