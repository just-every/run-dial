import { z } from "zod";

type Action = "accounting" | "export" | "mapping" | "acknowledgement";
const connectionCheck = "Check the intended company and connection configuration with your administrator; reconnecting may help.";
const recovery = "Keep the same company and connection; check availability, then repeat the same action so Dial can recover any existing result.";
const review = "Review the current payment and accounting state before trying again.";
const messages: Record<string, readonly [string, string]> = {
  accounting_not_configured: ["QuickBooks is not set up for this installation.", "Connecting becomes available once the installation has a QuickBooks client."],
  accounting_reconnect_required: ["QuickBooks needs to be connected before this action can continue.", "Connect QuickBooks, then choose and save an income account; if Dial still shows connected, disconnect first."],
  accounting_token_refused: ["QuickBooks did not accept this connection, and Dial cannot tell why.", connectionCheck],
  accounting_authorization_refused: ["QuickBooks did not approve the connection request.", "Check the intended company and connection configuration, then try connection consent again."],
  accounting_refresh_in_progress: ["Another request is refreshing the QuickBooks connection.", "Wait, then repeat the intended action."],
  accounting_invalid_token_response: ["Dial could not read a usable connection response from QuickBooks.", "Ask your administrator to check the integration; connection consent can be tried again."],
  accounting_outcome_unknown: ["Dial could not confirm whether QuickBooks completed this request.", recovery],
  accounting_provider_refused: ["QuickBooks declined this request without giving Dial a specific reason it can show.", "Review QuickBooks availability and settings with your administrator, then retry after resolving the issue."],
  income_account_not_found: ["The selected income account is not available in the QuickBooks account list.", "Choose income account again, select an available account, then save it."],
  accounting_item_missing: ["QuickBooks did not return the item needed to save this income account.", "Check QuickBooks, then retry saving the same account so Dial can look for the existing item."],
  income_account_required: ["Choose and save a QuickBooks income account before exporting.", "Use Choose income account, then Save income account."],
  accounting_custom_transaction_numbers_required: ["Dial needs QuickBooks custom transaction numbers to be enabled before exporting.", "Verify that custom transaction numbers are ON in QuickBooks, then export after QuickBooks reports them enabled."],
  accounting_usd_company_required: ["Dial can export only when QuickBooks reports US dollars as the company’s home currency.", "Verify the company settings with your accountant or administrator; use Download payments CSV for an incompatible company."],
  accounting_tax_mapping_required: ["This export includes payments with tax, which Dial cannot yet send to QuickBooks.", "Download payments CSV for separate accounting review."],
  accounting_recovery_mismatch: ["Dial found conflicting QuickBooks receipt details and stopped this export for review.", "Ask your accountant or administrator to review the receipts and references; Download payments CSV can help."],
  accounting_receipt_missing: ["QuickBooks did not return a receipt reference, so Dial cannot confirm this export.", "Keep the same company and connection; check availability, then use Export again so Dial can look for the existing receipt."],
  reauthorization_required: ["This restored connection needs fresh QuickBooks authorization.", "Reconnect QuickBooks, then choose and save an income account."],
  session_required: ["Sign in again to continue managing payments.", ""],
  origin_not_allowed: ["Open Dial at its usual address before trying this action.", ""],
  invalid_request: ["Dial could not accept the details for this action.", ""],
  runtime_unavailable: ["Dial could not complete this request.", review],
  configuration_missing: ["Dial needs an administrator to check its setup before this action can continue.", "Contact your installation administrator."],
  rate_limited: ["Too many requests were made; wait before trying again.", "Sign in again if needed."],
  client_identity_unavailable: ["Dial could not verify this request’s connection details.", "Contact your installation administrator."],
  rate_limit_state_unavailable: ["Dial cannot check request limits right now.", "Wait, then reload Settings; ask your administrator to investigate if this continues."],
};

export type Feedback = { message: string; guidance: string; signIn?: boolean };
export function accountingFeedback(code: string, action: Action = "accounting", stored = false): Feedback {
  const pair = Object.hasOwn(messages, code) ? messages[code] : undefined;
  if (!pair) return stored
    ? { message: "Dial cannot use this QuickBooks connection and does not have a specific explanation.", guidance: "Ask your installation administrator to check the connection." }
    : { message: "Dial could not complete this request, and the cause is unknown.", guidance: action === "export" ? recovery : review };
  const guidance = code === "invalid_request"
    ? action === "acknowledgement" ? "Reload Settings and review the payment before acknowledging it." : "Refresh the account list and select an available income account."
    : pair[1];
  return { message: pair[0], guidance, signIn: code === "session_required" };
}

class RequestFailure extends Error {
  constructor(readonly feedback: Feedback) { super(feedback.message); }
}
const envelope = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.array(z.string()).optional() }) });
const maintenance = z.object({ error: z.literal("archive_maintenance"), message: z.string() });
/** Read the actual error envelope once; never display server/provider messages. */
export async function accountingFailure(response: Response, action: Action = "accounting") {
  const value: unknown = await response.json().catch(() => undefined);
  const parsed = envelope.safeParse(value);
  const feedback = maintenance.safeParse(value).success
    ? { message: "Dial is taking a backup snapshot; try this action again shortly.", guidance: "" }
    : accountingFeedback(parsed.success ? parsed.data.error.code : "", action);
  const retry = response.headers.get("Retry-After");
  if (retry && (maintenance.safeParse(value).success || (parsed.success && parsed.data.error.code === "rate_limited"))) {
    const seconds = /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
    if (Number.isSafeInteger(seconds) && seconds > 0) feedback.guidance = `Wait at least ${seconds} seconds before trying again. ${feedback.guidance}`.trim();
  }
  return new RequestFailure(feedback);
}

export function actionFeedback(cause: unknown, action: Action): Feedback {
  if (cause instanceof RequestFailure) return cause.feedback;
  return {
    message: cause instanceof Error ? "Dial could not confirm the result of this action." : action === "acknowledgement" ? "Dial could not confirm the refund acknowledgement." : "Dial could not confirm the accounting action.",
    guidance: action === "export" ? recovery : review,
  };
}

export const statusSchema = z.object({ state: z.enum(["connected", "disconnected", "unhealthy", "reauthorization_required"]), configured: z.boolean(), incomeAccountId: z.string().nullable(), reason: z.string().nullable() });
export const rowsSchema = z.object({ rows: z.array(z.object({ bookingId: z.string(), eventTitle: z.string(), inviteeName: z.string(), processorRef: z.string().nullable(), amountCents: z.number(), kind: z.string(), currency: z.string(), status: z.string(), disagreement: z.number(), exported: z.boolean() })) });
export const accountsSchema = z.object({ accounts: z.array(z.object({ id: z.string(), name: z.string() })) });
export const exportsSchema = z.object({ exports: z.array(z.object({ state: z.string() })) });
export const acknowledgementSchema = z.object({ resolved: z.boolean() });
