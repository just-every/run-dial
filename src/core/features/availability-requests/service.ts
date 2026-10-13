import { offsetMinutesForInstant, wallClockInstants } from "../availability";
import { hashToken, createOpaqueToken } from "../../platform/auth/tokens";
import { hostDateToday, isCanonicalIanaTimeZone } from "../../shared/scheduling";
import type { RuntimeEnvironment } from "../../shared/runtime-env";
import type { EventTypeRecord } from "../event-types";
import type { PublicProfileRecord } from "../host-profile";
import {
  AvailabilityRequestsRepository,
  type RequestComposition,
  type RequestedWindow,
  type RequestRecord,
  type RequestState,
  type RequestAcknowledgementState,
} from "./repository";

const reviewNonceLifetimeMs = 30 * 60 * 1000;

export type PublicRequestEventResolver = {
  resolvePublishedEventForPublicRequest(slug: string): Promise<EventTypeRecord | undefined>;
};
export type RequestProfileReader = {
  getPublicProfile(handle: string): Promise<PublicProfileRecord | undefined>;
  getProfile(): Promise<PublicProfileRecord | undefined>;
};
export type PublicRequestReview = {
  nonce: string;
  expiresAt: string;
  request: PublicRequestComposition;
};
export type PublicRequestComposition = RequestComposition & { eventTitle: string; hostName: string };
export type OperatorRequest = Omit<RequestRecord, "compositionHash"> & { windows: OperatorRequestedWindow[] };
export type OperatorRequestedWindow = RequestedWindow & { inviteeLabel: string; hostLabel: string };

export class AvailabilityRequestsService {
  constructor(
    private readonly repository: AvailabilityRequestsRepository,
    private readonly eventTypes: PublicRequestEventResolver,
    private readonly hostProfiles: RequestProfileReader,
    private readonly runtime: RuntimeEnvironment,
  ) {}

  async issueReview(handle: string, slug: string, composition: RequestComposition): Promise<
    | { kind: "issued"; review: PublicRequestReview }
    | { kind: "not_found" | "invalid_dates" }
  > {
    const event = await this.resolvePublicEvent(handle, slug);
    if (!event) return { kind: "not_found" };
    if (!isRequestForFutureDates(composition)) return { kind: "invalid_dates" };
    const canonical = canonicalComposition(composition);
    const nonce = createOpaqueToken();
    const expiresAt = new Date(Date.now() + reviewNonceLifetimeMs).toISOString();
    await this.repository.issueReviewNonce(event.event.id, await this.nonceHash(nonce), await compositionHash(canonical), expiresAt, canonical.inviteeEmail);
    return {
      kind: "issued",
      review: {
        nonce,
        expiresAt,
        request: { ...canonical, eventTitle: event.event.title, hostName: event.profile.name },
      },
    };
  }

  async submit(handle: string, slug: string, nonce: string, composition: RequestComposition): Promise<
    | { kind: "created" | "replayed"; request: PublicRequestComposition }
    | { kind: "not_found" | "expired" | "mismatched" | "invalid_dates" | "blocked" }
  > {
    const canonical = canonicalComposition(composition);
    const nonceHash = await this.nonceHash(nonce);
    const hash = await compositionHash(canonical);
    const review = await this.repository.getReviewNonce(nonceHash);
    if (!review) return { kind: "not_found" };
    if (review.compositionHash !== hash) return { kind: "mismatched" };
    const resolved = await this.resolvePublicEvent(handle, slug);
    if (!resolved || review.eventTypeId !== resolved.event.id) return { kind: "not_found" };
    if (review.consumedAt && review.requestId) {
      const existing = await this.repository.get(review.requestId);
      if (!existing || existing.compositionHash !== hash) return { kind: "not_found" };
      return { kind: "replayed", request: toPublicRequest(existing, resolved.profile.name) };
    }
    if (Date.parse(review.expiresAt) <= Date.now()) return { kind: "expired" };
    if (!isRequestForFutureDates(canonical)) return { kind: "invalid_dates" };
    const request = await this.repository.createFromNonce({
      nonceHash,
      compositionHash: hash,
      eventTypeId: resolved.event.id,
      eventTitle: resolved.event.title,
      hostName: resolved.profile.name,
      composition: canonical,
      operatorRecipients: await this.repository.listOperators(),
    });
    if (request === "blocked") return { kind: "blocked" };
    return { kind: "created", request: toPublicRequest(request, resolved.profile.name) };
  }

  async listForOperator(state?: RequestState) {
    const records = await this.repository.list(state);
    const profile = await this.hostProfiles.getProfile();
    return Promise.all(records.map((record) => toOperatorRequest(record, profile?.timezone ?? "UTC")));
  }

  async getReceipt(handle: string, slug: string, nonce: string): Promise<
    | { kind: "found"; acknowledgement: RequestAcknowledgementState }
    | { kind: "not_found" | "expired" }
  > {
    const nonceHash = await this.nonceHash(nonce);
    const review = await this.repository.getReviewNonce(nonceHash);
    if (!review) return { kind: "not_found" };
    const resolved = await this.resolvePublicEvent(handle, slug);
    if (!resolved || review.eventTypeId !== resolved.event.id) return { kind: "not_found" };
    if (!review.consumedAt || !review.requestId) {
      return { kind: Date.parse(review.expiresAt) <= Date.now() ? "expired" : "not_found" };
    }
    // A consumed nonce keeps its existing replay semantics after expiry, but
    // grants only this acknowledgement projection of the original request.
    const acknowledgement = await this.repository.getAcknowledgementState({
      requestId: review.requestId,
      eventTypeId: resolved.event.id,
      nonceHash,
      compositionHash: review.compositionHash,
    });
    return acknowledgement ? { kind: "found", acknowledgement } : { kind: "not_found" };
  }

  async getForOperator(id: string) {
    const record = await this.repository.get(id);
    if (!record) return undefined;
    const profile = await this.profileForOperator();
    return toOperatorRequest(record, profile?.timezone ?? "UTC");
  }

  async transitionForOperator(id: string, state: Exclude<RequestState, "submitted">, operatorId: string) {
    const existing = await this.repository.get(id);
    if (!existing) return "not_found";
    if (existing.state !== "submitted") return "already_resolved";
    const profile = await this.profileForOperator();
    if (!profile) throw new Error("Host profile is required to notify an alternative request update");
    const result = await this.repository.transition(id, state, operatorId, profile.name);
    if (typeof result === "string") return result;
    return toOperatorRequest(result, profile.timezone);
  }

  async markHandledFromBooking(requestId: string, bookingId: string, operatorId: string) {
    const existing = await this.repository.get(requestId);
    if (!existing) return "not_found";
    if (existing.state !== "submitted") return existing.bookingId === bookingId ? existing : "already_resolved";
    const profile = await this.profileForOperator();
    if (!profile) throw new Error("Host profile is required to notify a linked alternative request");
    return this.repository.linkBooking(requestId, bookingId, operatorId, profile.name);
  }

  private async resolvePublicEvent(handle: string, slug: string) {
    const [profile, event] = await Promise.all([
      this.hostProfiles.getPublicProfile(handle),
      this.eventTypes.resolvePublishedEventForPublicRequest(slug),
    ]);
    return profile && event?.alternativeRequestsEnabled ? { profile, event } : undefined;
  }

  private nonceHash(nonce: string) {
    return hashToken(nonce, this.runtime.SESSION_SECRET);
  }

  private async profileForOperator() {
    return this.hostProfiles.getProfile();
  }
}

export function canonicalComposition(input: RequestComposition): RequestComposition {
  return {
    inviteeName: input.inviteeName.trim(),
    inviteeEmail: input.inviteeEmail.trim().toLowerCase(),
    inviteeTimezone: input.inviteeTimezone.trim(),
    note: input.note?.trim() || null,
    windows: [...input.windows]
      .map((window) => ({ ...window }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.startMinute - right.startMinute || left.endMinute - right.endMinute),
  };
}

export function isRequestForFutureDates(input: RequestComposition) {
  if (!isCanonicalIanaTimeZone(input.inviteeTimezone)) return false;
  const today = hostDateToday(input.inviteeTimezone);
  return input.windows.every((window) => window.date > today && windowInstants(window, input.inviteeTimezone) !== undefined);
}

function toPublicRequest(record: RequestRecord, hostName: string): PublicRequestComposition {
  return {
    inviteeName: record.inviteeName,
    inviteeEmail: record.inviteeEmail,
    inviteeTimezone: record.inviteeTimezone,
    note: record.note,
    windows: record.windows,
    eventTitle: record.eventTitle,
    hostName,
  };
}

function toOperatorRequest(record: RequestRecord, hostTimezone: string): OperatorRequest {
  return {
    id: record.id,
    eventTypeId: record.eventTypeId,
    eventTitle: record.eventTitle,
    inviteeName: record.inviteeName,
    inviteeEmail: record.inviteeEmail,
    inviteeTimezone: record.inviteeTimezone,
    note: record.note,
    state: record.state,
    bookingId: record.bookingId,
    submittedAt: record.submittedAt,
    handledAt: record.handledAt,
    closedAt: record.closedAt,
    stateChangedByOperatorId: record.stateChangedByOperatorId,
    windows: record.windows.map((window) => ({
      ...window,
      inviteeLabel: formatWindow(window, record.inviteeTimezone),
      hostLabel: formatWindowInZone(window, record.inviteeTimezone, hostTimezone),
    })),
  };
}

function formatWindow(window: RequestedWindow, timeZone: string) {
  return formatWindowInZone(window, timeZone, timeZone);
}

function formatWindowInZone(window: RequestedWindow, sourceTimeZone: string, destinationTimeZone: string) {
  const instants = windowInstants(window, sourceTimeZone);
  if (!instants) throw new Error("Persisted alternative request contains a nonexistent local time");
  const formatter = new Intl.DateTimeFormat(undefined, { timeZone: destinationTimeZone, dateStyle: "medium", timeStyle: "short" });
  return `${formatter.format(instants.start)} ${utcOffset(offsetMinutesForInstant(instants.start.toISOString(), destinationTimeZone))}–${formatter.format(instants.end)} ${utcOffset(offsetMinutesForInstant(instants.end.toISOString(), destinationTimeZone))} (${destinationTimeZone})`;
}

function utcOffset(minutes: number) {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function windowInstants(window: RequestedWindow, timeZone: string) {
  const start = wallClockInstants(window.date, window.startMinute, timeZone)[0];
  const endDate = window.endMinute === 1440 ? nextDate(window.date) : window.date;
  const endMinute = window.endMinute === 1440 ? 0 : window.endMinute;
  const end = wallClockInstants(endDate, endMinute, timeZone).at(-1);
  return start && end && end.getTime() > start.getTime() ? { start, end } : undefined;
}

function nextDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + 1));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

async function compositionHash(input: RequestComposition) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
