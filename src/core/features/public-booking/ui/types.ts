import type { ChangePolicyDecision } from "../../../shared/change-policy";
import type { PublicEventTypeRecord } from "../../event-types";
import type { PublicProfileRecord } from "../../host-profile";

export type PublicProfile = PublicProfileRecord;
export type PublicBookingPolicy = { lockedTimezone: string | null; rescheduleCutoffMinutes: number | null; cancellationCutoffMinutes: number | null; maxInviteeReschedules: number | null };
export type PublicEvent = PublicEventTypeRecord & { bookingPolicy?: PublicBookingPolicy; price?: import("../../../shared/event-price").EventPrice };
export type PublicEventPayload = { profile: PublicProfile; eventType: PublicEvent };

/** PAY-001 and PAY-003: what the booking step shows before anything is held. */
export type SelectionPayment = { amountCents: number; currency: "usd"; mode: "payment" | "setup"; priceCents: number; depositCents: number; balanceCents: number; balanceDueAt: string | null; freeWindowEndsAt: string | null; policy: string[]; consent?: { version: string; text: string; lateCancelFeeCents: number; noShowFeeCents: number } };
/** PAY-003: the booking's money on its receipt and manage page. */
export type PaymentSummaryView = { amountCents: number; currency: "usd"; reference: string; kind: "payment" | "deposit" | "setup"; priceCents: number; paidCents: number; refundedCents: number; feesCents: number; netCents: number; balanceDueCents: number; balanceDueAt: string | null; balanceUrl?: string; freeWindowEndsAt: string | null; policy: string[]; cardSaved: boolean; cancellation?: { outcome: "refund" | "late_fee" | "none"; amountCents: number } };
export type Confirmation = { rescheduleRequest?: import("../../bookings/reschedule-requests").RescheduleRequest; event: { eventTitle: string; durationMinutes: number; durationOptionsMinutes?: number[] }; host: { name: string; timezone: string; avatarKey?: string | null }; occurrence: { startAt: string; endAt: string }; inviteeTimezone: string; lockedTimezone?: string; changePolicy?: ChangePolicyDecision; browserTimezone?: string | null; location: { label: string; value?: string; state: string }; calendarState: string; meetingState: string; manageUrl: string; icsUrl: string; state: string; payment?: PaymentSummaryView };
