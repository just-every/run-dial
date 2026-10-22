import type { PublicEventPayload, SelectionPayment } from "./types";
export type PublicSelection = { approval?: {windowHours:number}; guestLimit?: number; nonce: string; expiresAt: string; selection: { startAt: string; endAt: string; hostTimezone?: string; inviteeTimezone: string }; payment?: SelectionPayment };
export type BookingDetailsCapability = { nonce: string; startAt: string; inviteeTimezone: string };
export type PublicSelectionLookup = PublicSelection & { event: PublicEventPayload["eventType"]; host: PublicEventPayload["profile"]; payment?: SelectionPayment };
