import type { PublicEventPayload } from "./types";
export type PublicSelection = { nonce: string; expiresAt: string; selection: { startAt: string; endAt: string; hostTimezone?: string; inviteeTimezone: string } };
export type BookingDetailsCapability = { nonce: string; startAt: string; inviteeTimezone: string };
export type PublicSelectionLookup = PublicSelection & { event: PublicEventPayload["eventType"]; host: PublicEventPayload["profile"] };
