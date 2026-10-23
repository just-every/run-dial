import { BookingsRepository } from "./repository";
import type { CalendarDeletionProbesRepository } from "./deletion-probes";
import type { BookingRecord } from "./types";

export type CalendarReconciliationChange =
  | { kind: "deleted"; providerEventId: string; updatedAt?: string; bookingId?: string; occurrenceId?: string }
  | { kind: "changed"; bookingId: string; occurrenceId: string; providerEventId: string; updatedAt: string; startAt?: string; endAt?: string; location?: string };

type Dependencies = {
  repository: BookingsRepository;
  probes: CalendarDeletionProbesRepository;
  /** Cancels the booking as the host's calendar deletion, with its mail and money (PAY-003 D4). */
  cancelDeleted(booking: BookingRecord, providerEventId: string): Promise<void>;
  reconcileUntimedDeletion(booking: BookingRecord, providerEventId: string): Promise<void>;
};

/**
 * Calendar transports pass only a normalised managed-event fact. This module
 * resolves deleted events by the persisted provider id and never adopts an
 * external time or location edit.
 */
export async function reconcileCalendarChange(dependencies: Dependencies, change: CalendarReconciliationChange) {
  const booking = change.bookingId
    ? await dependencies.repository.getById(change.bookingId)
    : await dependencies.repository.getByProviderEventId(change.providerEventId);
  if (!booking) return;
  // A restored probe records a historical provider target, regardless of the
  // occurrence carried by a later callback. Restaging cannot grant it authority.
  // Fresh targets on the same imported booking still follow normal reconciliation.
  if ((await dependencies.probes.get(booking.id, change.providerEventId))?.archiveHistorical === 1) return;
  // Event identity is part of ordering: a late deletion of an old provider
  // object cannot cancel its replacement, even if it has a newer timestamp.
  if (change.kind === "deleted" && (booking.state === "cancelled" || booking.calendarProviderEventId !== change.providerEventId)) return;
  if (change.updatedAt && booking.calendarProviderUpdatedAt && Date.parse(change.updatedAt) <= Date.parse(booking.calendarProviderUpdatedAt)) return;

  if (booking.state === "cancelled" && change.kind === "changed") {
    await dependencies.repository.enqueueCalendarRepair(booking, change.updatedAt);
    await dependencies.repository.advanceCalendarWatermark(booking, change.updatedAt);
    return;
  }

  if (change.occurrenceId && booking.occurrence.id !== change.occurrenceId) {
    await dependencies.repository.enqueueCalendarRepair(booking, change.updatedAt ?? change.providerEventId);
    return;
  }

  if (change.kind === "deleted") {
    if (!change.updatedAt) {
      await dependencies.reconcileUntimedDeletion(booking, change.providerEventId);
      return;
    }
    await dependencies.cancelDeleted(booking, change.providerEventId);
    return;
  }

  const canonicalLocation = (booking.locationType === "google_meet" || booking.locationType === "microsoft_teams") ? (booking.locationValue || "Google Meet") : booking.locationValue;
  const changed = (change.startAt !== undefined && change.startAt !== booking.occurrence.startAt)
    || (change.endAt !== undefined && change.endAt !== booking.occurrence.endAt)
    || (change.location !== undefined && change.location !== canonicalLocation);
  if (!changed) { await dependencies.repository.advanceCalendarWatermark(booking, change.updatedAt); return; }
  await dependencies.repository.recordCalendarConflict({
    booking,
    providerEventId: change.providerEventId,
    providerUpdatedAt: change.updatedAt,
    externalStartAt: change.startAt,
    externalEndAt: change.endAt,
    externalLocation: change.location,
  });
}
