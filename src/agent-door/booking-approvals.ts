import { z } from "zod";
import type { ToolDefinition } from "../../modules/agent-door/types.ts";
import { ToolRefusal } from "../../modules/agent-door/errors.ts";
import type { AppServices } from "../core/app/services";
import { ApprovalsRepository, type ApprovalRequest } from "../core/features/bookings/approvals";
import { approvalPayment, publicApprovalPayment } from "../core/features/payments/approval-state";
import { bookingId } from "./booking-schemas";
import { bookingReadClass, hostRecipients, moneyClass, stateDigest } from "./booking-native-state";
import { resourceText } from "./resource-definition";
import { external, live, nativeTool, objectOutput, required, standard, type ToolContext } from "./native-tool";

function safeApproval(request: ApprovalRequest) {
  return { id: request.id, bookingId: request.bookingId, eventTypeId: request.eventTypeId, state: request.state,
    inviteeName: resourceText(request.inviteeName), inviteeEmail: request.inviteeEmail, eventTitle: resourceText(request.eventTitle),
    startAt: request.startAt, endAt: request.endAt, expiresAt: request.expiresAt, updatedAt: request.updatedAt,
    reason: request.reason ? resourceText(request.reason) : null, payment: publicApprovalPayment(approvalPayment(request.paymentJson)) };
}

export function bookingApprovalTools(services: AppServices): ToolDefinition[] {
  const read = async (id: string, ctx: ToolContext) => required(await new ApprovalsRepository(ctx.db).get(id));
  const revision = async ({ id }: { id: string }, ctx: ToolContext) => {
    const request = await read(id, ctx);
    return stateDigest({ request, hosts: await hostRecipients(ctx), event: await services.eventTypes.getEventType(request.eventTypeId), profile: await services.hostProfile.getProfile() });
  };
  const decision = z.object({ id: z.string().length(26), decision: z.enum(["approve", "decline"]), reason: z.string().trim().max(500).optional() }).strict();
  const mutation = (cancel: boolean): ToolDefinition => nativeTool({
    name: cancel ? "dial.bookings.approval_cancel" : "dial.bookings.approval_decision",
    title: cancel ? "Cancel booking approval request" : "Decide booking approval request", scope: "dial:write", readOnly: false,
    description: "Apply the native approval decision. Paid approval may capture the frozen authorization; decline/cancel may void, detach or refund. Native capture_pending/void_pending is not completed payment or confirmed booking.",
    input: cancel ? bookingId.extend({ reason: z.string().trim().max(500).optional() }) : decision,
    outputSchema: objectOutput, classes: ["standard", "external", "live", "money"], clauses: ["BOOK-002", "BOOK-010", "PAY-007", "NOTIFY-004", "AGENT-001"], untrusted: true,
    async classify(args, ctx) {
      const request = await read(args.id, ctx), payment = approvalPayment(request.paymentJson);
      if (request.state !== "pending") return standard();
      const effects = [...standard(), external(1 + (await hostRecipients(ctx)).length)];
      if (!cancel && "decision" in args && args.decision === "approve") effects.push(live("calendar"));
      if (payment) {
        effects.push(live("stripe"));
        const cents = (!cancel && "decision" in args && args.decision === "approve") ? payment.amountCents : payment.capturedCents ?? 0;
        if (cents > 0) effects.push(moneyClass(cents));
      }
      return effects;
    },
    revisionType: "string", revision,
    async summary(args, ctx) {
      const request = await read(args.id, ctx), payment = approvalPayment(request.paymentJson);
      const choice = cancel ? "cancel" : "decision" in args ? args.decision : "decline";
      return { target: { id: request.id, name: request.eventTitle, email: request.inviteeEmail },
        recipients: [request.inviteeEmail, ...(await hostRecipients(ctx)).map(host => host.email)],
        ...(payment?.amountCents ? { amount: { value: payment.amountCents / 100, currency: "USD" }, payee: request.inviteeEmail } : {}),
        items: [`${choice} the request for ${request.startAt}; expiry ${request.expiresAt}.`,
          ...(payment ? [choice === "approve" ? "Capture only the frozen authorization; confirmation requires the matching signed processor outcome." : "Void the authorization and detach any saved card; a captured payment may require refund."] : []),
          ...(args.reason ? [`Reason: ${args.reason}`] : []), `Prepared by ${ctx.actor.label}.`] };
    },
    async run(args, ctx) {
      const choice = "decision" in args && args.decision === "approve" ? "approve" : "decline";
      const result = cancel ? await services.bookings.cancelApproval(args.id, ctx.person.id, args.reason)
        : await services.bookings.decideApproval(args.id, ctx.person.id, choice, args.reason);
      if (!["approved", "declined", "capture_pending", "void_pending"].includes(result.kind))
        throw new ToolRefusal(result.kind, result.kind, "state" in result ? { state: result.state } : {});
      return { result: { ...result, approval: safeApproval(await read(args.id, ctx)), preparedBy: ctx.actor } };
    },
  });
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
    }), mutation(false), mutation(true),
  ];
}
