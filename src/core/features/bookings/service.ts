import type { BookingLinksService } from "../booking-links";
import { resolveBookingLocation } from "../event-types";
import { suppressesMail } from "../../platform/mail/development";
import type { RescheduleRequestInput } from "./reschedule-requests";
import { requestEmail } from "./reschedule-request-mail";
import { bookingRedirect, cleanAttribution, type BookingAttribution } from "./link-context";
import { resolveEventDuration } from "../../shared/event-duration";
import { intervalDuration } from "./duration";
import { createOperatorBooking, recoverOperatorBooking, type OperatorBookingCreateResult } from "./operator-creation";
import type { OperatorCreationPayload } from "./operator-creation-receipts";
export type { OperatorBookingCreateResult } from "./operator-creation";
import type { AvailabilityService } from "../availability";
import { toPublicEventType, type EventTypeRecord, type EventTypesService } from "../event-types";
import { toPublicProfile, type HostProfileService, type ProfileRecord } from "../host-profile";
import { createOpaqueToken, deriveOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { createId, nowIso } from "../../shared/ids";
import { isCanonicalIanaTimeZone } from "../../shared/scheduling";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import { hostDateForInstant } from "../availability";
import { BookingsRepository } from "./repository";
import { reconcileCalendarChange, type CalendarReconciliationChange } from "./calendar-reconciliation";
import { ManageCapabilityService } from "./manage-capability";
import type { BookingConfirmation, BookingEmail, BookingNonce, BookingRecord } from "./types";
import { validateInvitee } from "./types";
import { bookingIcs, initialBookingIcs } from "./calendar-file";
import { reconcileDeletionProbe, type DeletionReconciliationDependencies } from "./deletion-reconciliation";
import { bookingCancellationMail, bookingChangeHtml, bookingConfirmationMail, formatTimeRange } from "../delivery/mail";
import { formatUsd, priceForDuration, type PaymentsService } from "../payments";
import { beginPaidConfirmation, paidReplay, type PaymentStep } from "./paid-confirmation";

const nonceLifetimeMs = 30 * 60 * 1000;
const manageTokenLifetimeMs = 90 * 24 * 60 * 60 * 1000;

export type BookingSelectionResult =
  | { kind: "issued"; nonce: BookingNonce }
  | { kind: "not_found" | "slot_invalid" | "calendar_unavailable" | "invalid_timezone" | "invalid_duration" }
  | { kind: "policy_blocked"; reason?: string }
  | { kind: "payments_unavailable"; reason: string };
export type BookingConfirmationResult =
  | { kind: "created"; booking: BookingConfirmation }
  | { kind: "replayed"; booking: BookingConfirmation }
  | { kind: "invalid_nonce" | "expired_nonce" | "slot_invalid" | "calendar_unavailable" | "invalid_answers" | "payload_mismatch" | "slot_taken" | "blocked" | "invalid_duration" }
  | { kind: "payment_required"; payment: PaymentStep }
  | { kind: "payments_unavailable"; reason: string };
export type PublicSelectionLookupResult =
  | {
    kind: "found";
    selection: {
      nonce: string;
      expiresAt: string;
      selection: { startAt: string; endAt: string; hostTimezone: string; inviteeTimezone: string };
      event: ReturnType<typeof toPublicEventType>;
      host: ReturnType<typeof toPublicProfile>;
      payment?: { amountCents: number; currency: "usd" };
    };
  }
  | { kind: "not_found" | "expired" };

export class BookingsService {
  constructor(
    private readonly repository: BookingsRepository,
    private readonly availability: AvailabilityService,
    private readonly profiles: HostProfileService,
    private readonly eventTypes: EventTypesService,
    private readonly runtime: RuntimeEnvironment,
    private readonly deletions: Pick<DeletionReconciliationDependencies, "inspect" | "probes">,
    private readonly bookingLinks?: BookingLinksService,
    private readonly payments?: PaymentsService,
  ) {}

  async issuePublicSelection(handle: string, slug: string, startAt: string, inviteeTimezone: string, durationMinutes?: number, link?: string): Promise<BookingSelectionResult> {
    if (!isCanonicalIanaTimeZone(inviteeTimezone) || !isIsoInstant(startAt)) return { kind: "invalid_timezone" };
    const verified = await this.availability.verifyPublicSelection(handle, slug, startAt, new Date(), undefined, durationMinutes, undefined, link);
    if (verified.kind !== "valid") return verified;
    const quote = await this.payments?.quote(verified.event.id, intervalDuration(verified.slot.startAt, verified.slot.endAt) ?? 0);
    if (quote?.kind === "unavailable") return { kind: "payments_unavailable", reason: quote.reason };
    const rawNonce = createOpaqueToken();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + nonceLifetimeMs).toISOString();
    await this.repository.createNonce({
      nonceHash: await hashToken(rawNonce, this.runtime.SESSION_SECRET),
      purpose: "confirm",
      linkId: verified.event.bookingLink?.id,
      eventTypeId: verified.event.id,
      selection: { startAt: verified.slot.startAt, endAt: verified.slot.endAt, inviteeTimezone },
      expiresAt,
      now,
    });
    return { kind: "issued", nonce: { nonce: rawNonce, expiresAt, selection: { startAt: verified.slot.startAt, endAt: verified.slot.endAt, inviteeTimezone } } };
  }

  async getPublicSelection(input: { handle: string; slug: string; nonce: string; startAt: string; inviteeTimezone: string; link?: string }): Promise<PublicSelectionLookupResult> {
    if (!isIsoInstant(input.startAt) || !isCanonicalIanaTimeZone(input.inviteeTimezone)) return { kind: "not_found" };
    const nonce = await this.repository.getNonce(await hashToken(input.nonce, this.runtime.SESSION_SECRET));
    if (!nonce || nonce.purpose !== "confirm") return { kind: "not_found" };
    if (nonce.consumedAt || nonce.expiresAt <= nowIso()) return { kind: "expired" };
    if (nonce.selectionStartAt !== input.startAt || nonce.inviteeTimezone !== input.inviteeTimezone) return { kind: "not_found" };
    const [profile, event] = await Promise.all([
      this.profiles.getPublicProfile(input.handle),
      this.bookingLinks ? this.bookingLinks.resolve(input.slug, input.link) : this.eventTypes.getEventType(nonce.eventTypeId).then(event => event ? {kind:"active" as const,event} : undefined),
    ]);
    if (profile && event?.kind === "expired" && "bookingLink" in event.event && event.event.bookingLink?.kind === "single_use" && event.event.id === nonce.eventTypeId && event.event.bookingLink.id === nonce.linkId) return {kind:"expired"};
    if (!profile || !event || event.kind !== "active" || event.event.status !== "published" || event.event.slug !== input.slug || event.event.id !== nonce.eventTypeId || ("bookingLink" in event.event ? event.event.bookingLink?.id ?? null : null) !== nonce.linkId) return { kind: "not_found" };
    const selectedDuration = intervalDuration(nonce.selectionStartAt, nonce.selectionEndAt);
    if (selectedDuration === undefined) return { kind: "not_found" };
    const amountCents = this.payments ? priceForDuration(await this.payments.eventPrice(event.event.id), selectedDuration) : undefined;
    return {
      kind: "found",
      selection: {
        nonce: input.nonce,
        expiresAt: nonce.expiresAt,
        selection: { startAt: nonce.selectionStartAt, endAt: nonce.selectionEndAt, hostTimezone: profile.timezone, inviteeTimezone: nonce.inviteeTimezone },
        event: toPublicEventType({ ...event.event, durationMinutes: selectedDuration }),
        host: toPublicProfile(profile),
        ...(amountCents === undefined ? {} : { payment: { amountCents, currency: "usd" as const } }),
      },
    };
  }

  async confirmPublic(input: { handle: string; slug: string; nonce: string; startAt: string; inviteeTimezone: string; name: string; email: string; answers: unknown; durationMinutes?: number; attribution?: BookingAttribution; link?: string; locationId?: string; locationInput?: string }): Promise<BookingConfirmationResult> {
    if (!isIsoInstant(input.startAt) || !isCanonicalIanaTimeZone(input.inviteeTimezone)) return { kind: "invalid_answers" };
    const nonceHash = await hashToken(input.nonce, this.runtime.SESSION_SECRET);
    const nonce = await this.repository.getNonce(nonceHash);
    const now = nowIso();
    if (!nonce) return { kind: "invalid_nonce" };
    if (nonce.expiresAt <= now && !nonce.consumedAt) return { kind: "expired_nonce" };
    const attribution = cleanAttribution(input.attribution);
    const payloadHash = await hashPayload({ startAt: input.startAt, inviteeTimezone: input.inviteeTimezone, name: input.name.trim(), email: input.email.trim().toLowerCase(), answers: input.answers, ...(Object.keys(attribution).length ? { attribution } : {}), ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }), ...(input.locationId === undefined ? {} : { locationId: input.locationId }), ...(input.locationInput === undefined ? {} : { locationInput: input.locationInput }) });
    const profile = await this.profiles.getPublicProfile(input.handle);
    if (!profile) return { kind: "invalid_nonce" };
    const offer = this.bookingLinks ? await this.bookingLinks.resolve(input.slug, input.link) : undefined;
    const originalEvent = offer?.event ?? (!input.link ? await this.eventTypes.getEventType(nonce.eventTypeId) : undefined);
    if (!originalEvent || originalEvent.id !== nonce.eventTypeId || originalEvent.slug !== input.slug || (offer?.event.bookingLink?.id ?? null) !== nonce.linkId) return { kind: "invalid_nonce" };
    if (nonce.consumedAt) {
      if (nonce.payloadHash !== payloadHash) return { kind: "payload_mismatch" };
      const booking = await this.repository.getByConsumedNonce(nonce);
      if (!booking) return (this.payments ? await paidReplay(this.payments, this.runtime, nonce.id, input.nonce, input.handle, input.slug) : undefined) ?? { kind: "invalid_nonce" };
      return { kind: "replayed", booking: this.toInitialConfirmation(booking, profile, await this.replayManageToken(booking, input.nonce)) };
    }
    if (nonce.purpose !== "confirm" || nonce.selectionStartAt !== input.startAt || nonce.inviteeTimezone !== input.inviteeTimezone) return { kind: "invalid_nonce" };
    if (offer && offer.kind !== "active") return {kind:"expired_nonce"};
    const event = resolveBookingLocation(originalEvent, input);
    if (!event) return {kind:"invalid_answers"};
    if (event.status !== "published") return { kind: "slot_invalid" };
    const selectedDuration = intervalDuration(nonce.selectionStartAt, nonce.selectionEndAt);
    if (selectedDuration === undefined) return { kind: "invalid_nonce" };
    const requestedDuration = input.durationMinutes ?? selectedDuration;
    if (resolveEventDuration(event, requestedDuration) === undefined) return { kind: "invalid_duration" };
    if (requestedDuration !== selectedDuration) return { kind: "invalid_nonce" };
    const invitee = validateInvitee(event, { name: input.name, email: input.email, answers: input.answers });
    if (!invitee) return { kind: "invalid_answers" };
    if (await this.repository.isBlocked(invitee.email)) return await this.confirmationReplay(nonceHash, payloadHash, profile, input.nonce) ?? { kind: "blocked" };
    const selection = await this.availability.verifyResolvedPublicSelection(profile, { ...event, ...(offer?.event.bookingLink ? {bookingLink:offer.event.bookingLink} : {}) }, input.startAt, new Date(), undefined, selectedDuration);
    if (selection.kind !== "valid") {
      if (selection.kind === "invalid_duration") return selection;
      if (selection.kind === "calendar_unavailable") return { kind: "calendar_unavailable" };
      const occupiedStart = new Date(Date.parse(input.startAt) - event.beforeBufferMinutes * 60_000).toISOString();
      const occupiedEnd = new Date(Date.parse(nonce.selectionEndAt) + event.afterBufferMinutes * 60_000).toISOString();
      if ((await this.repository.listInternalClaims(occupiedStart, occupiedEnd)).length) return { kind: "slot_taken" };
      return { kind: "slot_invalid" };
    }
    if (selection.event.id !== event.id || selection.slot.endAt !== nonce.selectionEndAt) return { kind: "slot_invalid" };
    if ((await this.repository.limitExclusions(event.id, profile.timezone, selection.slot.startAt, selection.slot.endAt, invitee.email)).length) return await this.confirmationReplay(nonceHash, payloadHash, profile, input.nonce) ?? { kind: "slot_invalid" };
    const bookingId = createId();
    const occurrenceId = createId();
    const manageTokenId = createId();
    const hostDate = hostDateForInstant(selection.slot.startAt, profile.timezone);
    const expiresAt = new Date(Date.parse(selection.slot.startAt) + manageTokenLifetimeMs).toISOString();
    const claimBase = {
      attribution,
      postBookingRedirectUrl: bookingRedirect({ event, selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone }, invitee, hostName: profile.name, bookingId, attribution }),
      bookingId, occurrenceId, nonceId: nonce.id, nonceHash, payloadHash, manageTokenId, manageTokenExpiresAt: expiresAt, event, invitee,
      selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone },
      hostTimezone: profile.timezone, hostDate,
      occupiedStartAt: new Date(Date.parse(selection.slot.startAt) - event.beforeBufferMinutes * 60_000).toISOString(),
      occupiedEndAt: new Date(Date.parse(selection.slot.endAt) + event.afterBufferMinutes * 60_000).toISOString(),
      now,
      calendarPayload: selection.calendarRequired !== false ? { bookingId, occurrenceId, icalUid: `dial-${bookingId}@dial`, eventTitle: event.title, startAt: selection.slot.startAt, endAt: selection.slot.endAt, hostTimezone: profile.timezone, lockedTimezone: event.bookingPolicy?.lockedTimezone, invitee: { name: invitee.name, email: invitee.email }, location: event.locationValue, locationType: event.locationType } : undefined,
    };
    const quote = await this.payments?.quote(event.id, selectedDuration);
    if (quote?.kind === "unavailable") return { kind: "payments_unavailable", reason: quote.reason };
    if (quote && this.payments) {
      const paid = await beginPaidConfirmation({ repository: this.repository, payments: this.payments, runtime: this.runtime, confirmationEmails: (manageToken, payment) => this.confirmationEmails({ profile, event, invitee, startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone, manageToken, bookingId, calendarRequired: selection.calendarRequired, payment }) },
        { claim: claimBase, nonce: input.nonce, handle: input.handle, slug: input.slug, quote, durationMinutes: selectedDuration });
      return paid.kind === "slot_taken" || paid.kind === "blocked" ? await this.confirmationReplay(nonceHash, payloadHash, profile, input.nonce) ?? paid : paid;
    }
    const manageToken = await this.managedTokenFromNonce(input.nonce);
    const manageTokenHash = await hashToken(manageToken, this.runtime.SESSION_SECRET);
    const emails = await this.confirmationEmails({ profile, event, invitee, startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone, manageToken, bookingId, calendarRequired: selection.calendarRequired });
    const claim = await this.repository.claim({
      attribution,
      postBookingRedirectUrl: bookingRedirect({ event, selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone }, invitee, hostName: profile.name, bookingId, attribution }),
      bookingId,
      occurrenceId,
      nonceId: nonce.id,
      nonceHash,
      payloadHash,
      manageTokenId,
      manageTokenHash,
      manageTokenExpiresAt: expiresAt,
      event,
      invitee,
      selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone },
      hostTimezone: profile.timezone,
      hostDate,
      occupiedStartAt: new Date(Date.parse(selection.slot.startAt) - event.beforeBufferMinutes * 60_000).toISOString(),
      occupiedEndAt: new Date(Date.parse(selection.slot.endAt) + event.afterBufferMinutes * 60_000).toISOString(),
      now,
      calendarPayload: selection.calendarRequired !== false ? { bookingId, occurrenceId, icalUid: `dial-${bookingId}@dial`, eventTitle: event.title, startAt: selection.slot.startAt, endAt: selection.slot.endAt, hostTimezone: profile.timezone, lockedTimezone: event.bookingPolicy?.lockedTimezone, invitee: { name: invitee.name, email: invitee.email }, location: event.locationValue, locationType: event.locationType } : undefined,
      emails,
    });
    if (claim === "blocked" || claim === "slot_taken") {
      return await this.confirmationReplay(nonceHash, payloadHash, profile, input.nonce) ?? { kind: claim };
    }
    const booking = await this.repository.getById(bookingId);
    return booking ? { kind: "created", booking: this.toInitialConfirmation(booking, profile, manageToken) } : { kind: "slot_taken" };
  }

  async getManageBooking(token: string) {
    const result = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!result) return { kind: "not_found" as const };
    if (result.status !== "active") return { kind: "expired" as const };
    const profile = await this.profiles.getProfile();
    if (!profile) return { kind: "not_found" as const };
    return { kind: "found" as const, booking: this.toConfirmation(result.booking, profile, token) };
  }

  async getRescheduleAvailability(token: string, week?: string, inviteeTimezone?: string, durationMinutes?: number) {
    const access = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!access) return { kind: "not_found" as const };
    if (access.status !== "active") return { kind: "expired" as const };
    if (access.booking.changePolicy?.rescheduleReason) return { kind: "policy_blocked" as const, reason: access.booking.changePolicy.rescheduleReason };
    if (access.booking.state === "cancelled" || (Date.parse(access.booking.occurrence.startAt) <= Date.now() && !openRequest(access.booking))) return { kind: "policy_blocked" as const };
    if (!access.booking.eventTypeId) return { kind: "not_found" as const };
    const availability = await this.availability.listRescheduleWeek(access.booking.eventTypeId, access.booking.id, week, inviteeTimezone, new Date(), durationMinutes, access.booking.durationMinutes);
    if (availability && "kind" in availability) return availability;
    const event = await this.bookingLinks?.resolveForBooking(access.booking.id) ?? await this.eventTypes.getEventType(access.booking.eventTypeId);
    return availability && event ? { kind: "found" as const, availability: { ...availability, durationOptionsMinutes: event.durationOptionsMinutes } } : { kind: "not_found" as const };
  }

  /** A receipt URL is bound to the public host and event route, not just its capability. */
  async getPublicConfirmation(input: { handle: string; slug: string; token: string }) {
    const result = await this.repository.findManageToken(await hashToken(input.token, this.runtime.SESSION_SECRET), nowIso());
    if (!result) return { kind: "not_found" as const };
    if (result.status !== "active") return { kind: "expired" as const };
    const profile = await this.profiles.getPublicProfile(input.handle);
    if (!profile || result.booking.eventSlug !== input.slug) return { kind: "not_found" as const };
    return { kind: "found" as const, booking: this.toConfirmation(result.booking, profile, input.token) };
  }

  recoverOperatorCreation(input: OperatorCreationPayload) {
    return recoverOperatorBooking({ repository: this.repository, runtime: this.runtime }, input);
  }

  createForOperator(input: OperatorCreationPayload): Promise<OperatorBookingCreateResult> {
    return createOperatorBooking({ repository: this.repository, availability: this.availability, runtime: this.runtime, confirmationEmails: (email) => this.confirmationEmails(email) }, input);
  }

  async listForOperator(filters: Parameters<BookingsRepository["listForOperator"]>[0]) {
    return this.repository.listForOperator(filters, nowIso());
  }

  async listForOperatorWithCount(filters: Parameters<BookingsRepository["listForOperator"]>[0]) {
    const now = nowIso();
    const [bookings, totalCount] = await Promise.all([
      this.repository.listForOperator(filters, now),
      this.repository.countForOperator(filters, now),
    ]);
    return { bookings, totalCount };
  }

  getForOperator(id: string) {
    return this.repository.getById(id);
  }

  async requestReschedule(id: string, operatorId: string, input: RescheduleRequestInput) {
    const booking = await this.repository.getById(id), profile = await this.profiles.getProfile();
    if (!booking || !profile) return { kind: "not_found" as const };
    if (!booking.eventTypeId || booking.state === "cancelled" || booking.occurrence.startAt <= nowIso()) return { kind: "not_available" as const };
    const storedManageUrl = await this.repository.storedManageUrl(id);
    const token = storedManageUrl ? undefined : createOpaqueToken();
    const manageUrl = storedManageUrl ?? new URL(`/manage/${token}`,this.runtime.APP_URL).toString();
    const capability = token ? {id:createId(),hash:await hashToken(token,this.runtime.SESSION_SECRET),expiresAt:new Date(Date.parse(booking.occurrence.startAt)+manageTokenLifetimeMs).toISOString()} : undefined;
    const result = await this.repository.requests.begin(booking,operatorId,input,requestEmail(booking,profile.name,manageUrl,input.message),nowIso(),capability);
    return result === "created" ? { kind: "created" as const, booking: await this.repository.getById(id) } : { kind: result };
  }

  async processRescheduleRequest(id: string, now = new Date()) {
    const booking = await this.repository.getById(id), profile = await this.profiles.getProfile();
    const request = booking?.rescheduleRequest, stamp = now.toISOString();
    if (!booking || !profile || !request || request.archiveHistorical || !["open","expired"].includes(request.state)) return;
    if (request.expiresAt <= stamp) {
      await this.repository.requests.expire(booking,stamp);
      if (request.releaseTime) await this.repository.cancel(booking,{type:"system"},"no new time picked",stamp,
        await this.changeEmails(profile,booking,"booking_cancelled","no new time picked",{actor:"the request expiry"}));
    } else {
      const manageUrl = await this.repository.storedManageUrl(id);
      if (manageUrl) await this.repository.requests.remind(booking,requestEmail(booking,profile.name,manageUrl,request.message,true),stamp);
    }
  }

  async cancelForOperator(id: string, operatorId: string, reason?: string) {
    const booking = await this.repository.getById(id);
    const profile = await this.profiles.getProfile();
    if (!booking || !profile) return undefined;
    const emails = await this.changeEmails(profile, booking, "booking_cancelled", reason, { actor: "an operator" });
    return this.repository.cancel(booking, { type: "operator", id: operatorId }, reason?.trim() || undefined, nowIso(), booking.imported ? emails.filter(email => email.recipientRole === "invitee") : emails);
  }

  /** Release an imported booking the source already cancelled: frees its time and buffers and records
   * the operator and reason in history, but sends no email, because the source already told the invitee. */
  async releaseImported(id: string, operatorId: string, reason: string) {
    const booking = await this.repository.getById(id);
    if (!booking || !booking.imported) return undefined;
    return this.repository.cancel(booking, { type: "operator", id: operatorId }, reason, nowIso(), []);
  }

  async rescheduleForOperator(input: { id: string; operatorId: string; startAt: string; inviteeTimezone: string; reason?: string; overridePublishedAvailability: boolean; durationMinutes?: number }) {
    if (!isIsoInstant(input.startAt) || !isCanonicalIanaTimeZone(input.inviteeTimezone)) return { kind: "invalid_timezone" as const };
    const booking = await this.repository.getById(input.id);
    if (!booking || !booking.eventTypeId) return { kind: "not_found" as const };
    const selection = await this.availability.verifyOperatorSelection(booking.eventTypeId, input.startAt, { overrideNoticeAndHorizon: input.overridePublishedAvailability, overridePublishedAvailability: input.overridePublishedAvailability }, new Date(), booking.id, input.durationMinutes, booking.durationMinutes);
    if (selection.kind !== "valid") return selection;
    if (booking.calendarState !== "not_required" && selection.calendarRequired === false) return { kind: "calendar_unavailable" as const };
    // An unsent capability has only a hash (for example after move-in). Issue its
    // first deliverable replacement together with the occurrence, never before it.
    const previousTokenId = await this.repository.getActiveManageTokenId(booking.id);
    const storedManageUrl = await this.repository.storedManageUrl(booking.id);
    const token = storedManageUrl ? undefined : createOpaqueToken();
    const manageCapability = token ? { previousTokenId, id: createId(), hash: await hashToken(token, this.runtime.SESSION_SECRET) } : undefined;
    const manageUrl = storedManageUrl ?? new URL(`/manage/${token}`, this.runtime.APP_URL).toString();
    const outcome = await this.repository.rescheduleForOperator({
      manageCapability,
      booking,
      operatorId: input.operatorId,
      reason: input.reason?.trim() || undefined,
      selection: { startAt: selection.slot.startAt, endAt: selection.slot.endAt, inviteeTimezone: input.inviteeTimezone },
      hostDate: hostDateForInstant(selection.slot.startAt, selection.profile.timezone),
      hostTimezone: selection.profile.timezone,
      occupiedStartAt: new Date(Date.parse(selection.slot.startAt) - selection.event.beforeBufferMinutes * 60_000).toISOString(),
      occupiedEndAt: new Date(Date.parse(selection.slot.endAt) + selection.event.afterBufferMinutes * 60_000).toISOString(),
      now: nowIso(),
      calendarPayload: selection.calendarRequired !== false ? { bookingId: booking.id, icalUid: booking.icalUid, eventTitle: selection.event.title, startAt: selection.slot.startAt, endAt: selection.slot.endAt, hostTimezone: selection.profile.timezone, lockedTimezone: booking.lockedTimezone, invitee: { name: booking.inviteeName, email: booking.inviteeEmail }, location: booking.locationValue, locationType: booking.locationType } : undefined,
      emails: await this.changeEmails(selection.profile, booking, "booking_changed", input.reason, { actor: "an operator", newStartAt: selection.slot.startAt, newEndAt: selection.slot.endAt, newInviteeTimezone: input.inviteeTimezone, manageUrl, calendarRequired: selection.calendarRequired }),
    });
    if (outcome === "slot_taken") return { kind: "slot_taken" as const };
    const updated = await this.repository.getById(booking.id);
    return updated ? { kind: "rescheduled" as const, booking: updated } : { kind: "slot_taken" as const };
  }

  async markAttendance(id: string, operatorId: string, status: "attended" | "no_show", note: string) {
    const booking = await this.repository.getById(id);
    if (!booking) return { kind: "not_found" as const };
    if (Date.parse(booking.occurrence.endAt) > Date.now()) return { kind: "not_ended" as const };
    await this.repository.markAttendance(booking, operatorId, status, note, nowIso());
    return { kind: "marked" as const, booking: await this.repository.getById(id) };
  }

  async reconcileCalendarChange(change: CalendarReconciliationChange): Promise<void> {
    await reconcileCalendarChange({
      repository: this.repository,
      probes: this.deletions.probes,
      profiles: this.profiles,
      cancellationEmails: (profile, booking) => this.changeEmails(profile, booking, "booking_cancelled", "deleted_in_google_calendar", { actor: "the connected calendar" }),
      reconcileUntimedDeletion: async (booking, providerEventId) => {
        await this.deletions.probes.stage(booking.id, providerEventId, booking.occurrence.id, nowIso());
        await this.reconcileDeletionProbe(booking.id, providerEventId);
      },
    }, change);
  }

  async reconcileDeletionProbe(bookingId: string, providerEventId: string) {
    await reconcileDeletionProbe({ ...this.deletions, repository: this.repository, reconcilePresent: (event) => this.reconcileCalendarChange(event), cancel: async (booking, eventId) => {
      const profile = await this.profiles.getProfile();
      if (!profile) throw new Error("Host profile is required to notify a managed-event deletion");
      await this.repository.cancel(booking, { type: "calendar_provider", id: eventId }, "deleted_in_google_calendar", nowIso(),
        await this.changeEmails(profile, booking, "booking_cancelled", "deleted_in_google_calendar", { actor: "the connected calendar" }));
    } }, bookingId, providerEventId);
  }

  async calendarDeletionStatus(bookingId: string) {
    if (!await this.repository.getById(bookingId)) return undefined;
    return this.deletions.probes.list(bookingId);
  }

  async retryCalendarDeletion(bookingId: string, providerEventId: string) {
    if (!await this.repository.getById(bookingId)) return "booking_not_found" as const;
    if (!await this.deletions.probes.retry(bookingId, providerEventId, nowIso())) return "probe_not_failed" as const;
    await this.reconcileDeletionProbe(bookingId, providerEventId);
    return "retried" as const;
  }

  async rotateManageTokenForOperator(id: string) {
    const booking = await this.repository.getById(id);
    if (!booking) return undefined;
    return new ManageCapabilityService(this.repository, this.runtime).rotate(booking);
  }

  async restoreCalendarConflictForOperator(bookingId: string, conflictId: string) {
    const booking = await this.repository.getById(bookingId);
    if (!booking) return "booking_not_found" as const;
    if (booking.state === "cancelled") return "booking_cancelled" as const;
    const conflict = booking.calendarConflicts.find((entry) => entry.id === conflictId);
    if (!conflict) return "calendar_conflict_not_found" as const;
    if (conflict.occurrenceId !== booking.occurrence.id) return "calendar_conflict_not_current" as const;
    if (conflict.state === "restored") return "restored" as const;
    if (conflict.state !== "open") return "calendar_conflict_not_open" as const;
    return (await this.repository.restoreCalendarConflict(booking, conflictId, nowIso())) ? "restored" as const : "conflict_not_found" as const;
  }

  /** A confirmation nonce already holds 256 CSPRNG bits; deriving preserves a replayable token without storing raw capability material. */
  private managedTokenFromNonce(nonce: string) {
    return deriveOpaqueToken(nonce, this.runtime.SESSION_SECRET, "booking-manage.v1");
  }

  /** A paid booking's manage token derives from its payment-return capability (PAY-001). */
  private async replayManageToken(booking: BookingRecord, nonce: string) {
    return booking.payment && this.payments ? this.payments.manageToken(await this.payments.returnToken(nonce)) : this.managedTokenFromNonce(nonce);
  }

  async getCalendarFile(token: string) {
    const result = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!result) return { kind: "not_found" as const };
    if (result.status !== "active") return { kind: "expired" as const };
    return { kind: "found" as const, ics: bookingIcs(result.booking) };
  }

  async contactHost(token: string, idempotencyKey: string, message?: string) {
    const access = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!access) return { kind: "not_found" as const };
    if (access.status !== "active") return { kind: "expired" as const };
    if (this.runtime.MAIL_PROVIDER === "rer" && !suppressesMail(this.runtime)) return { kind: "contact_unavailable" as const };
    await this.repository.contactHost(access.booking, idempotencyKey, message?.trim(), nowIso());
    return { kind: "sent" as const };
  }

  async cancelByManageToken(token: string, reason?: string) {
    const result = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!result) return { kind: "not_found" as const };
    if (result.status !== "active") return { kind: "expired" as const };
    if (result.booking.state !== "cancelled" && result.booking.changePolicy?.cancellationReason) return { kind: "policy_blocked" as const, reason: result.booking.changePolicy.cancellationReason };
    if (result.booking.state !== "cancelled" && (Date.parse(result.booking.occurrence.startAt) <= Date.now() && !openRequest(result.booking))) return { kind: "policy_blocked" as const };
    const profile = await this.profiles.getProfile();
    if (!profile) return { kind: "not_found" as const };
    const emails = await this.changeEmails(profile, result.booking, "booking_cancelled", reason, { actor: "the invitee" });
    const booking = await this.repository.cancel(result.booking, { type: "invitee" }, reason?.trim() || undefined, nowIso(), emails);
    if (booking && booking.state !== "cancelled") return { kind: "policy_blocked" as const, reason: booking.changePolicy?.cancellationReason ?? "cancellation_cutoff" };
    return booking ? { kind: "cancelled" as const, booking: this.toConfirmation(booking, profile, token) } : { kind: "not_found" as const };
  }

  async issueRescheduleSelection(token: string, startAt: string, inviteeTimezone: string, durationMinutes?: number): Promise<BookingSelectionResult | { kind: "expired" }> {
    if (!isIsoInstant(startAt) || !isCanonicalIanaTimeZone(inviteeTimezone)) return { kind: "invalid_timezone" };
    const access = await this.repository.findManageToken(await hashToken(token, this.runtime.SESSION_SECRET), nowIso());
    if (!access) return { kind: "not_found" };
    if (access.status !== "active") return { kind: "expired" };
    if (access.booking.changePolicy?.rescheduleReason) return { kind: "policy_blocked", reason: access.booking.changePolicy.rescheduleReason };
    if ((Date.parse(access.booking.occurrence.startAt) <= Date.now() && !openRequest(access.booking))) return { kind: "policy_blocked" };
    const [profile, event] = await Promise.all([this.profiles.getProfile(), access.booking.eventTypeId ? this.bookingLinks?.resolveForBooking(access.booking.id).then(event=>event ?? this.eventTypes.getEventType(access.booking.eventTypeId!)) ?? this.eventTypes.getEventType(access.booking.eventTypeId) : undefined]);
    if (!profile || !event || event.status !== "published") return { kind: "slot_invalid" };
    if (openRequest(access.booking) && durationMinutes !== undefined && durationMinutes !== access.booking.durationMinutes) return {kind:"invalid_duration"};
    const verified = await this.availability.verifyManagedSelection(event.id, access.booking.id, startAt, new Date(), durationMinutes, access.booking.durationMinutes);
    if (verified.kind !== "valid") return verified;
    const rawNonce = createOpaqueToken();
    const now = nowIso();
    const expiresAt = new Date(Date.now() + nonceLifetimeMs).toISOString();
    await this.repository.createNonce({ nonceHash: await hashToken(rawNonce, this.runtime.SESSION_SECRET), purpose: "reschedule", eventTypeId: event.id, bookingId: access.booking.id, selection: { startAt: verified.slot.startAt, endAt: verified.slot.endAt, inviteeTimezone }, expiresAt, now });
    return { kind: "issued", nonce: { nonce: rawNonce, expiresAt, selection: { startAt: verified.slot.startAt, endAt: verified.slot.endAt, inviteeTimezone } } };
  }

  async rescheduleByManageToken(input: { token: string; nonce: string; startAt: string; inviteeTimezone: string; reason?: string; durationMinutes?: number }) {
    if (!isIsoInstant(input.startAt) || !isCanonicalIanaTimeZone(input.inviteeTimezone)) return { kind: "invalid_nonce" as const };
    const access = await this.repository.findManageToken(await hashToken(input.token, this.runtime.SESSION_SECRET), nowIso());
    if (!access) return { kind: "not_found" as const };
    if (access.status !== "active") return { kind: "expired" as const };
    const nonceHash = await hashToken(input.nonce, this.runtime.SESSION_SECRET);
    const nonce = await this.repository.getNonce(nonceHash);
    const now = nowIso();
    if (!nonce?.consumedAt) {
    if (access.booking.changePolicy?.rescheduleReason) return { kind: "policy_blocked" as const, reason: access.booking.changePolicy.rescheduleReason };
    if ((Date.parse(access.booking.occurrence.startAt) <= Date.now() && !openRequest(access.booking))) return { kind: "policy_blocked" as const };
    }
    if (!nonce) return { kind: "invalid_nonce" as const };
    if (nonce.purpose !== "reschedule" || nonce.bookingId !== access.booking.id || nonce.selectionStartAt !== input.startAt || nonce.inviteeTimezone !== input.inviteeTimezone) return { kind: "invalid_nonce" as const };
    if (nonce.expiresAt <= now && !nonce.consumedAt) return { kind: "expired_nonce" as const };
    const payloadHash = await hashPayload({ startAt: input.startAt, inviteeTimezone: input.inviteeTimezone, name: "", email: "", answers: { reason: input.reason?.trim() ?? "" }, ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }) });
    const profile = await this.profiles.getProfile();
    if (!profile) return { kind: "not_found" as const };
    if (nonce.consumedAt) {
      if (nonce.payloadHash !== payloadHash) return { kind: "payload_mismatch" as const };
      const booking = await this.repository.getByConsumedNonce(nonce);
      return booking ? { kind: "replayed" as const, booking: this.toConfirmation(booking, profile, input.token) } : { kind: "invalid_nonce" as const };
    }
    const event = access.booking.eventTypeId ? await this.bookingLinks?.resolveForBooking(access.booking.id) ?? await this.eventTypes.getEventType(access.booking.eventTypeId) : undefined;
    if (!event || event.status !== "published") return { kind: "slot_invalid" as const };
    const selectedDuration = intervalDuration(nonce.selectionStartAt, nonce.selectionEndAt);
    if (selectedDuration === undefined || (openRequest(access.booking) && selectedDuration !== access.booking.durationMinutes)) return { kind: "invalid_nonce" as const };
    const requestedDuration = input.durationMinutes ?? selectedDuration;
    if (resolveEventDuration(event, requestedDuration, access.booking.durationMinutes) === undefined) return { kind: "invalid_duration" as const };
    if (requestedDuration !== selectedDuration) return { kind: "invalid_nonce" as const };
    const verified = await this.availability.verifyManagedSelection(event.id, access.booking.id, input.startAt, new Date(), selectedDuration, access.booking.durationMinutes);
    if (verified.kind === "invalid_duration") return verified;
    if (verified.kind !== "valid" || verified.slot.endAt !== nonce.selectionEndAt) return verified.kind === "calendar_unavailable" ? { kind: "calendar_unavailable" as const } : { kind: "slot_invalid" as const };
    if (access.booking.calendarState !== "not_required" && verified.calendarRequired === false) return { kind: "calendar_unavailable" as const };
    const emails = await this.changeEmails(profile, access.booking, "booking_changed", input.reason, { actor: "the invitee", newStartAt: verified.slot.startAt, newEndAt: verified.slot.endAt, newInviteeTimezone: input.inviteeTimezone, manageUrl: new URL(`/manage/${input.token}`, this.runtime.APP_URL).toString(), calendarRequired: verified.calendarRequired });
    const outcome = await this.repository.reschedule({
      booking: access.booking, nonceId: nonce.id, nonceHash, payloadHash, reason: input.reason?.trim() || undefined,
      selection: { startAt: verified.slot.startAt, endAt: verified.slot.endAt, inviteeTimezone: input.inviteeTimezone },
      hostDate: hostDateForInstant(verified.slot.startAt, profile.timezone),
      hostTimezone: profile.timezone,
      occupiedStartAt: new Date(Date.parse(verified.slot.startAt) - event.beforeBufferMinutes * 60_000).toISOString(),
      occupiedEndAt: new Date(Date.parse(verified.slot.endAt) + event.afterBufferMinutes * 60_000).toISOString(),
      now,
      calendarPayload: verified.calendarRequired !== false ? { bookingId: access.booking.id, icalUid: access.booking.icalUid, eventTitle: event.title, startAt: verified.slot.startAt, endAt: verified.slot.endAt, hostTimezone: profile.timezone, lockedTimezone: access.booking.lockedTimezone, invitee: { name: access.booking.inviteeName, email: access.booking.inviteeEmail }, location: access.booking.locationValue, locationType: access.booking.locationType } : undefined,
      emails,
    });
    if (outcome === "slot_taken") {
      const current = await this.repository.getById(access.booking.id);
      if (current?.changePolicy?.rescheduleReason) return { kind: "policy_blocked" as const, reason: current.changePolicy.rescheduleReason };
      return { kind: "slot_taken" as const };
    }
    const booking = await this.repository.getById(access.booking.id);
    return booking ? { kind: "rescheduled" as const, booking: this.toConfirmation(booking, profile, input.token) } : { kind: "slot_taken" as const };
  }

  private async confirmationReplay(nonceHash: string, payloadHash: string, profile: ProfileRecord, nonce: string) {
    const consumed = await this.repository.getNonce(nonceHash);
    if (!consumed?.consumedAt || consumed.payloadHash !== payloadHash) return undefined;
    const stored = await this.repository.getByConsumedNonce(consumed);
    return stored ? { kind: "replayed" as const, booking: this.toInitialConfirmation(stored, profile, await this.replayManageToken(stored, nonce)) } : undefined;
  }

  private toInitialConfirmation(booking: BookingRecord, profile: ProfileRecord, token: string): BookingConfirmation {
    return { ...this.toConfirmation(booking, profile, token), bookingReference: booking.id, ...(booking.postBookingRedirectUrl ? { postBookingRedirectUrl: booking.postBookingRedirectUrl } : {}) };
  }

  private toConfirmation(booking: BookingRecord, profile: ProfileRecord, manageToken: string): BookingConfirmation {
    const locationValue = booking.locationType === "google_meet" ? booking.meetingUrl ?? undefined : booking.locationValue;
    const locationState = locationValue ? "ready" as const : "pending" as const;
    const manageUrl = new URL(`/manage/${manageToken}`, this.runtime.APP_URL).toString();
    return {
      bookingReference: booking.id,
      ...(booking.rescheduleRequest ? { rescheduleRequest: booking.rescheduleRequest } : {}),
      ...(booking.lockedTimezone ? { lockedTimezone: booking.lockedTimezone, browserTimezone: booking.browserTimezone ?? null } : {}),
      ...(booking.changePolicy ? { changePolicy: booking.changePolicy } : {}),
      event: { eventTitle: booking.eventTitle, durationMinutes: booking.durationMinutes },
      host: { name: profile.name, timezone: booking.hostTimezone, avatarKey: profile.avatarKey },
      occurrence: { startAt: booking.occurrence.startAt, endAt: booking.occurrence.endAt },
      inviteeTimezone: booking.inviteeTimezone,
      location: { label: booking.locationLabel, state: locationState, ...(locationValue ? { value: locationValue } : {}) },
      calendarState: booking.calendarState,
      meetingState: booking.meetingState,
      manageUrl,
      icsUrl: new URL(`/api/public/manage/${manageToken}/calendar.ics`, this.runtime.APP_URL).toString(),
      state: booking.state,
      ...(booking.payment ? { payment: { amountCents: booking.payment.amountCents, currency: booking.payment.currency, reference: booking.payment.checkoutSessionId, refundIssuedByDial: false } } : {}),
    };
  }

  private async confirmationEmails(input: { profile: ProfileRecord; event: EventTypeRecord; invitee: { name: string; email: string; answers: Record<string, string | string[]> }; startAt: string; endAt: string; inviteeTimezone: string; browserTimezone?: string | null; manageToken: string; bookingId: string; calendarRequired?: boolean; payment?: { amountCents: number; reference: string } }): Promise<BookingEmail[]> {
    const { profile, event, invitee, startAt, endAt, inviteeTimezone, manageToken, bookingId } = input;
    const manageUrl = new URL(`/manage/${manageToken}`, this.runtime.APP_URL).toString();
    const location = event.locationType === "google_meet" ? "Google Meet link pending" : event.locationValue;
    const answerDetails = event.questions.flatMap((question) => {
      const answer = question.key ? invitee.answers[question.key] : undefined;
      return answer === undefined ? [] : [{ label: question.label, value: Array.isArray(answer) ? answer.join(", ") : answer }];
    });
    // Managed mail carries the private Add to calendar link in both mail parts;
    // its relay does not accept attachments. Direct providers also carry the file.
    const calendarFile = this.runtime.MAIL_PROVIDER === "rer" ? {} : { attachments: [{ filename: "booking.ics", contentBase64: base64(initialBookingIcs({ bookingId, lockedTimezone: event.bookingPolicy?.lockedTimezone ?? undefined, eventTitle: event.title, startAt, endAt, location, createdAt: nowIso() })), contentType: "text/calendar" }] };
    const operators = await this.repository.listOperatorRecipients();
    const details = {
      hostName: profile.name, eventTitle: event.title, startAt, endAt, durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
      lockedTimezone: event.bookingPolicy?.lockedTimezone ?? undefined, browserTimezone: input.browserTimezone === undefined ? inviteeTimezone : input.browserTimezone,
      inviteeTimezone, hostTimezone: profile.timezone, locationType: event.locationType, locationLabel: event.locationLabel,
      locationValue: event.locationValue, calendarState: input.calendarRequired === false ? "not_required" : "pending",
      inviteeName: invitee.name, inviteeEmail: invitee.email, answers: answerDetails,
      ...(input.payment ? { payment: { amount: formatUsd(input.payment.amountCents), reference: input.payment.reference } } : {}),
    };
    return [
      { to: invitee.email, recipientRole: "invitee", messageKind: "confirmation", manageUrl, subject: `Confirmed: ${event.title}`, ...bookingConfirmationMail({ ...details, recipientRole: "invitee", manageUrl }), ...calendarFile },
      ...operators.map(({ email: to, id, generation }) => ({ to, operatorAccess: { id, generation }, recipientRole: "operator" as const, subject: `New booking: ${event.title}`, ...bookingConfirmationMail({ ...details, recipientRole: "operator" }) })),
    ];
  }

  private async changeEmails(profile: ProfileRecord, booking: BookingRecord, template: "booking_changed" | "booking_cancelled", reason?: string, change: { actor: string; newStartAt?: string; newEndAt?: string; newInviteeTimezone?: string; manageUrl?: string; calendarRequired?: boolean } = { actor: "the invitee" }): Promise<BookingEmail[]> {
    const changed = template === "booking_cancelled";
    const normalizedReason = reason?.trim() || undefined;
    const inviteeManageUrl = changed ? undefined : change.manageUrl ?? await this.repository.storedManageUrl(booking.id);
    if (!changed && !inviteeManageUrl) throw new Error("Missing invitee manage capability for reschedule notification");
    const startAt = change.newStartAt ?? booking.occurrence.startAt;
    const endAt = change.newEndAt ?? booking.occurrence.endAt;
    const mailDetails = {
      lockedTimezone: booking.lockedTimezone, browserTimezone: booking.browserTimezone,
      previousLockedTime: booking.lockedTimezone ? formatTimeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.lockedTimezone, true) : undefined,
      hostName: profile.name,
      eventTitle: booking.eventTitle,
      startAt,
      endAt,
      durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
      inviteeTimezone: change.newInviteeTimezone ?? booking.inviteeTimezone,
      hostTimezone: booking.hostTimezone,
      locationType: booking.locationType,
      locationLabel: booking.locationLabel,
      locationValue: booking.locationValue,
      meetingUrl: booking.meetingUrl,
      calendarState: (change.calendarRequired ?? (booking.calendarState !== "not_required")) ? "pending" : "not_required",
      actor: change.actor,
      previousInviteeTime: renderTimeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.inviteeTimezone),
      previousHostTime: renderTimeRange(booking.occurrence.startAt, booking.occurrence.endAt, booking.hostTimezone),
      reason: normalizedReason,
      inviteeName: booking.inviteeName,
      inviteeEmail: booking.inviteeEmail,
      ...(booking.payment ? { payment: { amount: formatUsd(booking.payment.amountCents), reference: booking.payment.checkoutSessionId } } : {}),
    };
    if (changed) {
      const template = { kind: "booking-cancellation" as const, hostName: profile.name, actor: change.actor, ...(normalizedReason ? { reason: normalizedReason } : {}) };
      const inviteeMail = bookingCancellationMail({ ...mailDetails, calendarState: (change.calendarRequired ?? (booking.calendarState !== "not_required")) ? "pending" : "not_required", actor: template.actor, reason: template.reason, recipientRole: "invitee", inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail });
      return [
        { to: booking.inviteeEmail, recipientRole: "invitee" as const, messageKind: "cancellation", subject: inviteeMail.subject, text: inviteeMail.text, html: inviteeMail.html, mailTemplate: template },
        ...(await this.repository.listOperatorRecipients()).map(({ email: to, id, generation }) => {
          const operatorMail = bookingCancellationMail({ ...mailDetails, calendarState: (change.calendarRequired ?? (booking.calendarState !== "not_required")) ? "pending" : "not_required", actor: template.actor, reason: template.reason, recipientRole: "operator", inviteeName: booking.inviteeName, inviteeEmail: booking.inviteeEmail });
          return { to, operatorAccess: { id, generation }, recipientRole: "operator" as const, subject: operatorMail.subject, text: operatorMail.text, html: operatorMail.html, mailTemplate: template };
        }),
      ];
    }
    const inviteeMail = bookingChangeHtml({ ...mailDetails, recipientRole: "invitee", ...(inviteeManageUrl ? { manageUrl: inviteeManageUrl } : {}) });
    return [
      { to: booking.inviteeEmail, recipientRole: "invitee", messageKind: "reschedule", changeReason: normalizedReason, subject: `Rescheduled: ${booking.eventTitle}`, text: inviteeMail.text, ...(inviteeManageUrl ? { manageUrl: inviteeManageUrl } : {}), html: inviteeMail.html },
      ...(await this.repository.listOperatorRecipients()).map(({ email: to, id, generation }) => {
        const operatorMail = bookingChangeHtml({ ...mailDetails, recipientRole: "operator" });
        return { to, operatorAccess: { id, generation }, recipientRole: "operator" as const, subject: `Rescheduled: ${booking.eventTitle}`, text: operatorMail.text, html: operatorMail.html };
      }),
    ];
  }
}

function isIsoInstant(value: string) {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

async function hashPayload(payload: { startAt: string; inviteeTimezone: string; name: string; email: string; answers: unknown; durationMinutes?: number; attribution?: BookingAttribution }) {
  const source = new TextEncoder().encode(stableJson(payload));
  const digest = await crypto.subtle.digest("SHA-256", source);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function base64(value: string) {
  let encoded = "";
  for (const byte of new TextEncoder().encode(value)) encoded += String.fromCharCode(byte);
  return btoa(encoded);
}

function renderTimeRange(startAt: string, endAt: string, timeZone: string) {
  return formatTimeRange(startAt, endAt, timeZone);
}

function openRequest(booking: BookingRecord) { return !booking.rescheduleRequest?.archiveHistorical && booking.rescheduleRequest?.state === "open" && booking.rescheduleRequest.expiresAt > nowIso(); }
