import type { PublicEventTypeRecord } from "../../event-types";
import type { PublicProfileRecord } from "../../host-profile";

export type PublicProfile = PublicProfileRecord;
export type PublicEvent = PublicEventTypeRecord;
export type PublicEventPayload = { profile: PublicProfile; eventType: PublicEvent };

export type Confirmation = { event: { eventTitle: string; durationMinutes: number; durationOptionsMinutes?: number[] }; host: { name: string; timezone: string; avatarKey?: string | null }; occurrence: { startAt: string; endAt: string }; inviteeTimezone: string; location: { label: string; value?: string; state: string }; calendarState: string; meetingState: string; manageUrl: string; icsUrl: string; state: string };
