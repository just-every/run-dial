import type { OfferedSlot } from "./holds";
import { createOpaqueToken, hashToken } from "../../platform/auth/tokens";
import { nowIso } from "../../shared/ids";
import type { EventTypesService } from "../event-types";
import type { BookingLinkInput, BookingLinkRecord, LinkEvent } from "./types";
import { oneOffOverridesSchema } from "./types";
import { BookingLinksRepository } from "./repository";

export class BookingLinksService {
  constructor(private readonly repository: BookingLinksRepository, private readonly events: EventTypesService, private readonly secret: string) {}
  async list() {
    return (await this.repository.list()).map(record => ({ id: record.id, eventTypeId: record.eventTypeId, kind: record.kind, offeredStarts: record.offeredSlotsJson ? (JSON.parse(record.offeredSlotsJson) as OfferedSlot[]).map(slot=>slot.startAt) : undefined, holdUntil: record.holdUntil, expiresAt: record.expiresAt, createdAt: record.createdAt, state: state(record) }));
  }
  async create(input: BookingLinkInput, slots?: OfferedSlot[]) {
    input = {...input,expiresAt:new Date(input.expiresAt).toISOString()};
    if (input.expiresAt <= nowIso()) return { kind: "invalid_expiry" as const };
    const event = await this.events.getEventType(input.eventTypeId);
    if (!event || event.status === "disabled" || event.requestOnly) return { kind: "not_found" as const };
    const readiness = await this.events.publishReadiness(applyOverrides(event,input.overrides));
    // One-off dated windows supply availability directly; no recurring event schedule is required.
    const missing = readiness.missing.filter(reason=>reason!=="open_availability" || !input.overrides?.dates.some(date=>date.windows.length));
    if (missing.length) return {kind:"not_ready" as const,missing};
    const token = createOpaqueToken();
    const id = await this.repository.create(input, await hashToken(token, this.secret), slots);
    if (!id) return {kind:"slot_taken" as const};
    return { kind: "created" as const, id, token, slug: event.slug };
  }
  revoke(id: string) { return this.repository.revoke(id); }
  /** Manage authority belongs to the booking, independently of the spent offer link. */
  async resolveForBooking(bookingId:string):Promise<LinkEvent|undefined> {
    const link=await this.repository.byBooking(bookingId);
    if (!link) return undefined;
    const base=await this.events.getEventType(link.eventTypeId);
    return base ? this.effectiveEvent(base,{...link,offeredSlotsJson:null}) : undefined;
  }
  async resolve(slug: string, token?: string): Promise<{ kind: "active" | "used" | "expired"; event: LinkEvent } | undefined> {
    if (!token) {
      const event = await this.events.resolvePublishedEventForPublicRequest(slug);
      return event ? { kind: "active", event } : undefined;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const link = await this.repository.byToken(await hashToken(token, this.secret));
    if (!link || link.revokedAt) return undefined;
    const base = await this.events.getEventType(link.eventTypeId);
    if (!base || base.slug !== slug || base.status === "disabled") return undefined;
    const event=this.effectiveEvent(base,link);
    return { kind: link.consumedAt ? "used" : link.expiresAt <= nowIso() ? "expired" : "active", event };
  }
  private effectiveEvent(base:LinkEvent,link:BookingLinkRecord):LinkEvent {
    const overrides = link.overridesJson ? oneOffOverridesSchema.parse(JSON.parse(link.overridesJson)) : undefined;
    const event: LinkEvent = { ...applyOverrides(base,overrides), ...(link.offeredSlotsJson ? {durationOptionsMinutes:[base.durationMinutes]} : {}), status: "published", requestOnly: false, alternativeRequestsEnabled: false,
      bookingLink: { id: link.id,kind:link.kind, offeredStarts: link.offeredSlotsJson ? (JSON.parse(link.offeredSlotsJson) as OfferedSlot[]).map(slot=>slot.startAt) : undefined, expiresAt: link.expiresAt, dates: overrides?.dates },
    };
    return event;
  }
}
function state(record: BookingLinkRecord) { return record.consumedAt ? "used" : record.revokedAt || !record.tokenHash ? "revoked" : record.expiresAt <= nowIso() ? "expired" : "active"; }
function applyOverrides(base:LinkEvent,overrides:BookingLinkInput["overrides"]):LinkEvent {
  return { ...base, ...(overrides ? { durationMinutes: overrides.durationMinutes, durationOptionsMinutes: [overrides.durationMinutes], locationType: overrides.locationType, locationLabel: overrides.locationLabel, locationValue: overrides.locationValue, locations: undefined, availability: [], bookingHorizonMode: "indefinite" as const } : {}) };
}
