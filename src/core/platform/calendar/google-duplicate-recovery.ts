import { googleEventPayload } from "./google-managed-events";
import { isRecord } from "./google-wire";
import { ProviderFailure, type ManagedCalendarCommandAdmission, type ManagedCalendarEvent, type ManagedCalendarRecoveryPair } from "./types";

type ProviderEvent = Record<string, unknown> & { id: string; etag: string };
type RecoveryInput = {
  collectionUrl: string;
  event: ManagedCalendarEvent;
  canonicalId: string;
  readList(url: string): Promise<Record<string, unknown>>;
  readEvent(url: string, etag: string): Promise<Record<string, unknown>>;
  removeEvent(url: string, etag: string): Promise<unknown>;
  admit?: ManagedCalendarCommandAdmission;
};

/** Only upsert can remove an owned outage duplicate. Cancellation uses its original lookup. */
export async function resolveGoogleUpsertEvent(input: RecoveryInput): Promise<{ event?: ProviderEvent; recovered: boolean }> {
  const url = new URL(input.collectionUrl);
  url.searchParams.set("privateExtendedProperty", `dial-booking-id=${input.event.bookingId}`);
  url.searchParams.set("showDeleted", "false");
  // A third candidate or another page makes the result ambiguous, never a pair.
  url.searchParams.set("maxResults", "3");
  const list = () => input.readList(url.toString());
  const events = listed(await list());
  const command = await input.admit?.();
  if (command?.state === "stale") throw new ProviderFailure("superseded_occurrence", false);
  const recovery = command?.recovery;
  if (recovery) {
    await admit(input);
    if (recovery.canonicalId !== input.canonicalId || events.length === 0) refuse();
    const canonical = events.find(event => event.id === recovery.canonicalId);
    if (!canonical || canonical.etag !== recovery.canonicalEtag) refuse();
    if (events.length === 1) return { event: await verifyCanonical(input, canonical, list), recovered: true };
    if (events.length !== 2 || !events.some(event => event.id === recovery.extraId && event.etag === recovery.extraEtag)) refuse();
  }
  if (events.length < 2) {
    const existing = events[0];
    // A lost cleanup response leaves only the canonical event. The same command
    // must verify it without another PATCH and another provider invitation.
    const properties = existing && isRecord(existing.extendedProperties) && isRecord(existing.extendedProperties.private)
      ? existing.extendedProperties.private : undefined;
    if (existing?.id === input.canonicalId && properties?.["dial-idempotency-key"] === input.event.idempotencyKey
      && !input.event.requestGoogleMeet && !input.event.guestEmails?.length && input.event.transparency !== "transparent"
      && command && command.state !== "unsupported") {
      assertIntended(existing, input.event);
      const verified = await verifyCanonical(input, existing, list);
      return { event: verified, recovered: true };
    }
    return { event: existing, recovered: false };
  }
  if (events.length !== 2 || input.event.requestGoogleMeet || input.event.guestEmails?.length
    || input.event.transparency === "transparent" || !input.admit) refuse();
  const canonical = events.find(event => event.id === input.canonicalId);
  const extra = events.find(event => event.id !== input.canonicalId);
  if (!canonical || !extra) refuse();
  for (const event of [canonical, extra]) assertIntended(event, input.event);

  // Both identities and ETags must survive a fresh provider read before any deletion.
  for (const event of [canonical, extra]) {
    const fresh = await input.readEvent(eventUrl(input, event.id), event.etag);
    if (fresh.id !== event.id || fresh.etag !== event.etag) throw new ProviderFailure("provider_write_conflict", true);
    assertIntended(fresh, input.event);
  }
  await admit(input, { canonicalId: canonical.id, canonicalEtag: canonical.etag, extraId: extra.id, extraEtag: extra.etag });
  await input.removeEvent(`${eventUrl(input, extra.id)}?sendUpdates=none`, extra.etag);

  return { event: await verifyCanonical(input, canonical, list), recovered: true };
}

async function verifyCanonical(input: RecoveryInput, canonical: ProviderEvent, list: () => Promise<Record<string, unknown>>) {
  // A successful cleanup response alone is not proof of the provider's resulting state.
  await admit(input);
  const remaining = listed(await list());
  if (remaining.length !== 1 || remaining[0].id !== canonical.id || remaining[0].etag !== canonical.etag) refuse();
  assertIntended(remaining[0], input.event);
  const verified = await input.readEvent(eventUrl(input, canonical.id), canonical.etag);
  if (verified.id !== canonical.id || verified.etag !== canonical.etag) throw new ProviderFailure("provider_write_conflict", true);
  assertIntended(verified, input.event);
  await admit(input);
  return verified as ProviderEvent;
}

function eventUrl(input: RecoveryInput, id: string) { return `${input.collectionUrl}/${encodeURIComponent(id)}`; }
async function admit(input: RecoveryInput, beginCleanup?: ManagedCalendarRecoveryPair) {
  if ((await input.admit?.(beginCleanup))?.state !== "current") throw new ProviderFailure("superseded_occurrence", false);
}
function refuse(): never { throw new ProviderFailure("invalid_provider_response", false); }
function listed(body: Record<string, unknown>): ProviderEvent[] {
  if ((body.items !== undefined && !Array.isArray(body.items)) || body.nextPageToken !== undefined) refuse();
  const items: ProviderEvent[] = [];
  // Google can omit the items field for an empty collection.
  for (const value of (body.items ?? []) as unknown[]) {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.etag !== "string" || !value.etag) refuse();
    if (value.status === "cancelled") refuse();
    items.push(value as ProviderEvent);
  }
  if (new Set(items.map(event => event.id)).size !== items.length) refuse();
  return items;
}
function assertIntended(value: Record<string, unknown>, event: ManagedCalendarEvent) {
  const expected = googleEventPayload(event, false, false);
  const properties = isRecord(value.extendedProperties) && isRecord(value.extendedProperties.private) ? value.extendedProperties.private : undefined;
  for (const [key, marker] of Object.entries(expected.extendedProperties.private)) {
    if (!properties || properties[key] !== marker) refuse();
  }
  if (value.status !== "confirmed" || value.summary !== expected.summary || value.description !== expected.description
    || value.location !== expected.location || (value.transparency ?? "opaque") !== expected.transparency
    || value.conferenceData || value.hangoutLink || value.recurrence || value.recurringEventId
    || value.locked || value.privateCopy || (value.eventType !== undefined && value.eventType !== "default")
    || typeof value.updated !== "string" || !Number.isFinite(Date.parse(value.updated))) refuse();
  for (const key of ["start", "end"] as const) {
    const actual = value[key], intended = expected[key];
    if (!isRecord(actual) || typeof actual.dateTime !== "string" || actual.date !== undefined
      || actual.timeZone !== intended.timeZone || !Number.isFinite(Date.parse(actual.dateTime))
      || Date.parse(actual.dateTime) !== Date.parse(intended.dateTime)) refuse();
  }
  const attendees = value.attendees;
  if (!Array.isArray(attendees) || attendees.length !== 1 || !isRecord(attendees[0])
    || attendees[0].email !== event.inviteeEmail || attendees[0].resource
    || (attendees[0].additionalGuests !== undefined && attendees[0].additionalGuests !== 0)) refuse();
}
