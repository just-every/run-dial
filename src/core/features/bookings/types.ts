import type { BookingAttribution } from "./link-context";
import type { EventQuestionInput, EventTypeRecord } from "../event-types";
import type { MailAttachment } from "../../platform/mail";
import type { BookingCancellationTemplate } from "../delivery";
import { normalizePhoneNumber } from "../../shared/phone";

export type InviteeAnswers = Record<string, string | string[]>;
export type ValidatedInvitee = { name: string; email: string; answers: InviteeAnswers };
export type BookingState = "confirmed" | "cancelled" | "rescheduled";
export type DeliveryState = "pending" | "succeeded" | "failed";
export type BookingOccurrence = {
  id: string;
  sequence: number;
  startAt: string;
  endAt: string;
  occupiedStartAt: string;
  occupiedEndAt: string;
  hostDate: string;
  state: "current" | "rescheduled" | "cancelled";
  isCurrent: boolean;
};
export type BookingHistoryEntry = {
  id: string;
  occurrenceId: string | null;
  action: "manage_link_rotated" | "created" | "rescheduled" | "cancelled" | "attendance_marked" | "calendar_cancelled" | "reschedule_requested" | "reschedule_request_reminded" | "reschedule_request_picked" | "reschedule_request_expired"
    | "payment_received" | "payment_balance" | "payment_refund" | "payment_late_cancel_fee" | "payment_no_show_fee" | "payment_invoice";
  actorType: "invitee" | "operator" | "calendar_provider" | "system";
  actorId: string | null;
  previousStartAt: string | null;
  newStartAt: string | null;
  reason: string | null;
  createdAt: string;
};
export type BookingDelivery = {
  id: string;
  kind: "calendar_upsert" | "calendar_cancel" | "mail_send" | "reminder";
  occurrenceId: string | null;
  state: "pending" | "processing" | "succeeded" | "failed";
  attempts: number;
  lastErrorCode: string | null;
  createdAt: string;
  succeededAt: string | null;
  email?: { to: string; subject: string; text: string };
};
export type BookingAttendance = { status: "attended" | "no_show"; note: string; operatorId: string; markedAt: string };
export type BookingCalendarConflict = {
  id: string;
  occurrenceId: string;
  providerEventId: string;
  providerUpdatedAt: string;
  canonicalStartAt: string;
  canonicalEndAt: string;
  canonicalLocation: string;
  externalStartAt: string | null;
  externalEndAt: string | null;
  externalLocation: string | null;
  state: "open" | "restored" | "cancelled";
  createdAt: string;
};
export type BookingRecord = {
  rescheduleRequest?: import("./reschedule-requests").RescheduleRequest;
  changePolicy?: import("../../shared/change-policy").ChangePolicyDecision;
  lockedTimezone?: string;
  browserTimezone?: string | null;
  imported?: number;
  attribution: BookingAttribution;
  postBookingRedirectUrl: string | null;
  id: string;
  eventTypeId: string | null;
  eventSlug: string;
  eventTitle: string;
  durationMinutes: number;
  locationType: string;
  locationLabel: string;
  locationValue: string;
  inviteeName: string;
  inviteeEmail: string;
  hostTimezone: string;
  inviteeTimezone: string;
  state: BookingState;
  icalUid: string;
  calendarState: DeliveryState | "not_required";
  meetingState: DeliveryState | "not_required";
  meetingUrl: string | null;
  calendarProviderEventId: string | null;
  calendarProviderUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancelledReason: string | null;
  occurrence: BookingOccurrence;
  answers: Array<{ key: string; label: string; kind: string; value: string | string[] }>;
  history: BookingHistoryEntry[];
  deliveries: BookingDelivery[];
  attendance: BookingAttendance | null;
  calendarConflicts: BookingCalendarConflict[];
  /** PAY-001: present when the booking was paid through Stripe; cancel and reschedule keep it. */
  payment?: import("../payments").BookingPayment;
  /** PAY-003: the terms shown, the saved-card consent and every later money movement (operator record only). */
  money?: import("../payments").BookingMoney;
};

/** PAY-003: a booking's money as the invitee's receipt and manage page show it. */
export type PaymentSummary = {
  /** The first payment (PAY-001): the full price or a deposit; zero when only a card was saved. */
  amountCents: number;
  currency: "usd";
  reference: string;
  kind: "payment" | "deposit" | "setup" | "invoice";
  priceCents: number;
  paidCents: number;
  refundedCents: number;
  feesCents: number;
  netCents: number;
  balanceDueCents: number;
  balanceDueAt: string | null;
  balanceUrl?: string;
  freeWindowEndsAt: string | null;
  policy: string[];
  cardSaved: boolean;
  /** PAY-005: sales tax net of refunds, the business receipts name, each payment with its tax, and an issued invoice. */
  taxCents: number;
  taxSummary: string | null;
  businessName: string;
  payments: Array<{ kind: string; amountCents: number; taxCents: number; reference: string; paidAt: string }>;
  invoice?: { url: string; number: string | null; amountCents: number; taxCents: number; paid: boolean };
  movements: Array<{ kind: string; amountCents: number; status: string; createdAt: string; reference: string | null }>;
  /** What cancelling now would do, while the booking is still open. */
  cancellation?: { outcome: "refund" | "late_fee" | "none"; amountCents: number };
};

export type BookingSelection = { startAt: string; endAt: string; inviteeTimezone: string };
export type BookingNonce = { nonce: string; expiresAt: string; selection: BookingSelection };
export type BookingActor = { type: "invitee" } | { type: "operator"; operatorId: string } | { type: "calendar_provider" };
export type BookingConfirmation = {
  rescheduleRequest?: import("./reschedule-requests").RescheduleRequest;
  lockedTimezone?: string;
  browserTimezone?: string | null;
  changePolicy?: import("../../shared/change-policy").ChangePolicyDecision;
  postBookingRedirectUrl?: string;
  bookingReference?: string;
  event: Pick<BookingRecord, "eventTitle" | "durationMinutes">;
  host: { name: string; timezone: string; avatarKey?: string | null };
  occurrence: Pick<BookingOccurrence, "startAt" | "endAt">;
  inviteeTimezone: string;
  location: { label: string; value?: string; state: "ready" | "pending" };
  calendarState: DeliveryState | "not_required";
  meetingState: DeliveryState | "not_required";
  manageUrl: string;
  icsUrl: string;
  state: BookingState;
  payment?: PaymentSummary;
};

export type BookingEmail = {
  changeReason?: string;
  messageKind?: "confirmation" | "reschedule" | "cancellation";
  operatorAccess?: { id: string; generation: number };
  manageUrl?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  mailTemplate?: BookingCancellationTemplate;
  replyTo?: string;
  attachments?: MailAttachment[];
  recipientRole: "invitee" | "operator";
};

export type BookingClaim = {
  /** PAY-003: the terms snapshot, card consent and balance-link salt a payment hold carries until confirmation. */
  money?: import("../payments").PendingMoney;
  attribution?: BookingAttribution;
  postBookingRedirectUrl?: string | null;
  bookingId: string;
  occurrenceId: string;
  nonceId: string;
  nonceHash: string;
  payloadHash: string;
  manageTokenId: string;
  manageTokenHash: string;
  manageTokenExpiresAt: string;
  event: EventTypeRecord;
  invitee: ValidatedInvitee;
  selection: BookingSelection;
  hostTimezone: string;
  hostDate: string;
  occupiedStartAt: string;
  occupiedEndAt: string;
  now: string;
  calendarPayload: Record<string, unknown> | undefined;
  emails: BookingEmail[];
};

export function validateInvitee(event: EventTypeRecord, candidate: { name: string; email: string; answers: unknown }): ValidatedInvitee | undefined {
  const name = candidate.name.trim();
  const email = candidate.email.trim().toLowerCase();
  if (name.length === 0 || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320) return undefined;
  if (!isRecord(candidate.answers)) return undefined;
  const answers: InviteeAnswers = {};
  const questionKeys = new Set<string>();
  for (const question of event.questions) {
    if (!question.key) return undefined;
    questionKeys.add(question.key);
    const value = candidate.answers[question.key];
    if (value === undefined) {
      if (question.required) return undefined;
      continue;
    }
    const parsed = validateAnswer(question, value);
    if (parsed === undefined || (question.required && emptyAnswer(parsed))) return undefined;
    answers[question.key] = parsed;
  }
  if (Object.keys(candidate.answers).some((key) => !questionKeys.has(key))) return undefined;
  return { name, email, answers };
}

function validateAnswer(question: EventQuestionInput, value: unknown): string | string[] | undefined {
  if (question.kind === "phone") {
    if (typeof value !== "string") return undefined;
    return value.trim() === "" ? "" : normalizePhoneNumber(value);
  }
  if (question.kind === "text" || question.kind === "textarea") {
    if (typeof value !== "string") return undefined;
    const max = question.kind === "text" ? 500 : 4_000;
    return value.trim().length <= max ? value.trim() : undefined;
  }
  const choices = new Set(question.options.map((option) => option.value));
  if (question.kind === "single_choice" || question.kind === "dropdown") return typeof value === "string" && (choices.has(value) || (!question.required && value === "")) ? value : undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length || value.some((item) => !choices.has(item))) return undefined;
  return value as string[];
}

function emptyAnswer(value: string | string[]) {
  return Array.isArray(value) ? value.length === 0 : value.length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
