import { hasSupportedInstantPrecision } from "../../shared/instants";
import type { AvailabilityService, SlotExclusion } from "../availability";
import { hostDateForInstant } from "../availability";
import type { EventTypeRecord } from "../event-types";
import type { ProfileRecord } from "../host-profile";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId, nowIso } from "../../shared/ids";
import { isCanonicalIanaTimeZone } from "../../shared/scheduling";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { operatorCreationIdentity, type OperatorCreationPayload } from "./operator-creation-receipts";
import type { BookingsRepository } from "./repository";
import { validateInvitee, type BookingEmail, type BookingRecord, type ValidatedInvitee } from "./types";

export type OperatorBookingCreateResult =
  | { kind: "created" | "replayed"; booking: BookingRecord }
  | { kind: "not_found" | "invalid_timezone" | "invalid_answers" | "calendar_unavailable" | "slot_taken" | "blocked" | "payload_mismatch" | "attempt_erased" }
  | { kind: "slot_invalid"; exclusions: SlotExclusion[] };
type CreationDependencies = {
  repository: BookingsRepository; availability: AvailabilityService; runtime: RuntimeEnvironment;
  confirmationEmails(input: { profile: ProfileRecord; event: EventTypeRecord; invitee: ValidatedInvitee; startAt: string; endAt: string; inviteeTimezone: string; manageToken: string; bookingId: string; calendarRequired?: boolean }): Promise<BookingEmail[]>;
};
const manageTokenLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export async function recoverOperatorBooking(dependencies: Pick<CreationDependencies, "repository" | "runtime">, input: OperatorCreationPayload) {
  const identity = await operatorCreationIdentity(input, dependencies.runtime.SESSION_SECRET);
  if (!identity) return undefined;
  const receipt = await dependencies.repository.operatorCreationReceipt(identity.keyHash);
  if (receipt && receipt.operatorId === input.operatorId) {
    if (receipt.payloadHash !== identity.payloadHash) return { kind: "payload_mismatch" as const };
    const booking = await dependencies.repository.getById(receipt.bookingId);
    if (booking) return { kind: "replayed" as const, booking };
  }
  return await dependencies.repository.operatorCreationErased(identity.keyHash, input.operatorId) ? { kind: "attempt_erased" as const } : undefined;
}

export async function createOperatorBooking(dependencies: CreationDependencies, input: OperatorCreationPayload): Promise<OperatorBookingCreateResult> {
  if (!isIsoInstant(input.startAt) || !hasSupportedInstantPrecision(input.startAt) || !isCanonicalIanaTimeZone(input.inviteeTimezone)) return { kind: "invalid_timezone" };
  const prior = await recoverOperatorBooking(dependencies, input);
  if (prior) return prior;
  const creationIdentity = await operatorCreationIdentity(input, dependencies.runtime.SESSION_SECRET);
  const selection = await dependencies.availability.verifyOperatorSelection(input.eventTypeId, input.startAt, { overrideNoticeAndHorizon: input.overrideNoticeAndHorizon }, new Date());
  if (selection.kind !== "valid") return await recoverOperatorBooking(dependencies, input) ?? selection;
  const invitee = validateInvitee(selection.event, { name: input.name, email: input.email, answers: input.answers });
  if (!invitee) return await recoverOperatorBooking(dependencies, input) ?? { kind: "invalid_answers" };
  if (await dependencies.repository.isBlocked(invitee.email)) return await recoverOperatorBooking(dependencies, input) ?? { kind: "blocked" };
  const bookingId = createId();
  const occurrenceId = createId();
  const manageTokenId = createId();
  const manageToken = createOpaqueToken();
  const now = nowIso();
  const claim = await dependencies.repository.claimForOperator({
    bookingId,
    creationIdentity,
    requestId: input.requestId,
    occurrenceId,
    manageTokenId,
    hostName: selection.profile.name,
    manageTokenHash: await hashToken(manageToken, dependencies.runtime.SESSION_SECRET),
    manageTokenExpiresAt: new Date(Date.parse(selection.slot.startAt) + manageTokenLifetimeMs).toISOString(),
    event: selection.event,
    invitee,
    selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone },
    hostTimezone: selection.profile.timezone,
    hostDate: hostDateForInstant(selection.slot.startAt, selection.profile.timezone),
    occupiedStartAt: new Date(Date.parse(selection.slot.startAt) - selection.event.beforeBufferMinutes * 60_000).toISOString(),
    occupiedEndAt: new Date(Date.parse(selection.slot.endAt) + selection.event.afterBufferMinutes * 60_000).toISOString(),
    now,
    calendarPayload: selection.calendarRequired !== false ? { bookingId, occurrenceId, icalUid: `dial-${bookingId}@dial`, eventTitle: selection.event.title, startAt: selection.slot.startAt, endAt: selection.slot.endAt, hostTimezone: selection.profile.timezone, invitee: { name: invitee.name, email: invitee.email }, location: selection.event.locationValue, locationType: selection.event.locationType } : undefined,
    emails: await dependencies.confirmationEmails({ profile: selection.profile, event: selection.event, invitee, startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone, manageToken, bookingId, calendarRequired: selection.calendarRequired }),
  }, input.operatorId);
  if (claim !== "claimed") return await recoverOperatorBooking(dependencies, input) ?? { kind: claim };
  const booking = await dependencies.repository.getById(bookingId);
  return booking ? { kind: "created", booking } : await recoverOperatorBooking(dependencies, input) ?? { kind: "slot_taken" };
}

function isIsoInstant(value: string) { return Number.isFinite(Date.parse(value)) && value.endsWith("Z"); }
