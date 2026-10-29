import { z } from "zod";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import type { AppServices } from "../core/app/services";
import { eventBookingPolicySchema } from "../core/shared/booking-policy";
import { correspondenceConfigSchema, requestRoutingSchema } from "../core/shared/correspondence";
import { nowIso } from "../core/shared/ids";
import { eventIdInput, eventWrite } from "./event-tool-support";
import { nativeTool, objectOutput, required, standard } from "./native-tool";

// Native templates need current question metadata. The repository parses that after this route-shaped envelope.
const correspondenceInput = z.object({
  inviteeConfirmationEnabled: z.boolean().default(true),
  invitationManageLinkEnabled: z.boolean().default(true),
  requestRouting: requestRoutingSchema.optional(),
  templates: correspondenceConfigSchema().shape.templates,
}).strict();

export function eventConfigurationTools(services: AppServices): ToolDefinition[] {
  const read = { scope: "dial:read", readOnly: true, input: eventIdInput, outputSchema: objectOutput, classes: ["standard"] as ["standard"], classify: () => standard() };
  const policyClauses = ["AVAIL-012", "BOOK-015"];
  return [
    nativeTool({
      ...read, name: "dial.event.get_policy", title: "Read event booking policy", description: "Read native locked timezone, invitee change cutoffs and reschedule cap.",
      clauses: policyClauses, run: async args => ({ result: required(await services.bookingPolicies.read(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.save_policy", title: "Save event booking policy", description: "Save native booking policy, preserving the paid-event rule that the cancellation cutoff cannot start inside the free cancellation window.",
      input: eventIdInput.extend({ policy: eventBookingPolicySchema }).strict(), clauses: [...policyClauses, "PAY-003"],
      items: args => [`Booking policy: ${JSON.stringify(args.policy)}`],
      run: async args => {
        if (await services.payments.cutoffConflicts(args.id, args.policy.cancellationCutoffMinutes)) throw new ToolRefusal("window_inside_cutoff", "The cancellation cutoff must not start inside the free cancellation window.");
        return { result: required(await services.bookingPolicies.save(args.id, args.policy, nowIso())) };
      },
    }),
    nativeTool({
      ...read, name: "dial.event.get_correspondence", title: "Read event correspondence", description: "Read native invitee confirmation, invitation management link, request routing and editable message templates.",
      clauses: ["NOTIFY-009", "REQUEST-004"], run: async args => ({ result: required(await services.correspondence.read(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.save_correspondence", title: "Save event correspondence", description: "Save native correspondence after current-question and privacy validation. Request routing accepts only existing operators with access.",
      input: eventIdInput.extend({ correspondence: correspondenceInput }).strict(), clauses: ["NOTIFY-009", "NOTIFY-008", "REQUEST-004", "CAL-003"],
      items: args => [`Correspondence: ${JSON.stringify(args.correspondence)}`],
      run: async args => {
        required(await services.correspondence.read(args.id));
        const parsed = await services.correspondence.parse(args.id, args.correspondence);
        if (!parsed.success) throw new ToolRefusal("invalid_template", parsed.error.issues.map(issue => issue.message).join(" "), { fields: parsed.error.issues.map(issue => issue.path.join(".")) });
        if (parsed.data.requestRouting && (await services.correspondence.unknownOperators(parsed.data.requestRouting.operatorIds)).length) throw new ToolRefusal("request_recipient_unknown", "Request email can go only to people who currently have access.");
        if (!await services.correspondence.save(args.id, parsed.data, nowIso())) throw new ToolRefusal("not_found");
        return { result: parsed.data };
      },
    }),
    nativeTool({
      ...read, name: "dial.event.get_approval", title: "Read event approval settings", description: "Read whether native bookings need host approval and the approval window.",
      clauses: ["EVENT-008"], run: async args => ({ result: required(await services.bookings.approvalSettings(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.save_approval", title: "Save event approval settings", description: "Save native host-approval settings. The native service rejects an approval window longer than seven days.",
      input: eventIdInput.extend({ approval: z.object({ required: z.boolean(), windowHours: z.number().int().min(1).default(24) }).strict() }).strict(), clauses: ["EVENT-008"],
      items: args => [`Host approval: ${args.approval.required ? "required" : "not required"}`, `Approval window: ${args.approval.windowHours} hours`],
      run: async args => {
        const result = await services.bookings.saveApprovalSettings(args.id, args.approval);
        if (result.kind !== "saved") throw new ToolRefusal(result.kind);
        return { result: result.settings };
      },
    }),
    nativeTool({
      ...read, name: "dial.event.get_guests", title: "Read event guest settings", description: "Read the native invitee guest limit.",
      clauses: ["EVENT-009"], run: async args => ({ result: required(await services.bookings.guestSettings(args.id)) }),
    }),
    eventWrite(services, {
      name: "dial.event.save_guests", title: "Save event guest settings", description: "Set the native limit of zero to twenty invitee guests for new bookings.",
      input: eventIdInput.extend({ guestLimit: z.number().int().min(0).max(20) }).strict(), clauses: ["EVENT-009"],
      items: args => [`Guest limit for new bookings: ${args.guestLimit}`],
      run: async args => {
        if (!await services.bookings.saveGuestSettings(args.id, args.guestLimit)) throw new ToolRefusal("not_found");
        return { result: { guestLimit: args.guestLimit } };
      },
    }),
  ];
}
