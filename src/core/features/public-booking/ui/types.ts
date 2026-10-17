import type { ChangePolicyDecision } from "../../../shared/change-policy";
import type { PublicEventTypeRecord } from "../../event-types";
import type { PublicProfileRecord } from "../../host-profile";

export type PublicProfile = PublicProfileRecord;
export type PublicBookingPolicy = { lockedTimezone: string | null; rescheduleCutoffMinutes: number | null; cancellationCutoffMinutes: number | null; maxInviteeReschedules: number | null };
export type PublicEvent = PublicEventTypeRecord & { bookingPolicy?: PublicBookingPolicy };
export type PublicEventPayload = { profile: PublicProfile; eventType: PublicEvent };

export type Confirmation = { event: { eventTitle: string; durationMinutes: number; durationOptionsMinutes?: number[] }; host: { name: string; timezone: string; avatarKey?: string | null }; occurrence: { startAt: string; endAt: string }; inviteeTimezone: string; lockedTimezone?: string; changePolicy?: ChangePolicyDecision; browserTimezone?: string | null; location: { label: string; value?: string; state: string }; calendarState: string; meetingState: string; manageUrl: string; icsUrl: string; state: string };
