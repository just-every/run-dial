import { ProviderFailure, type ManagedEventInspection } from "../../platform/calendar";
import { nowIso } from "../../shared/ids";
import type { BookingsRepository } from "./repository";
import type { CalendarDeletionProbesRepository } from "./deletion-probes";
import type { BookingRecord } from "./types";

export type DeletionReconciliationDependencies = {
  repository: BookingsRepository;
  probes: CalendarDeletionProbesRepository;
  inspect(input: { bookingId: string; providerEventId: string }): Promise<ManagedEventInspection>;
  cancel(booking: BookingRecord, providerEventId: string): Promise<void>;
  reconcilePresent(event: Extract<ManagedEventInspection, { kind: "present" }>["event"]): Promise<void>;
};

/** Untimed facts are wake-ups. Only a fresh, affirmative snapshot can cancel. */
export async function reconcileDeletionProbe(dependencies: DeletionReconciliationDependencies, bookingId: string, providerEventId: string) {
  const probe = await dependencies.probes.claim(bookingId, providerEventId, nowIso());
  if (!probe) return;
  try {
    const booking = await dependencies.repository.getById(bookingId);
    if (!booking || booking.state === "cancelled" || booking.calendarProviderEventId !== providerEventId || booking.occurrence.id !== probe.occurrenceId) {
      await dependencies.probes.resolve(probe, "superseded", nowIso());
      return;
    }
    const inspection = await dependencies.inspect({ bookingId, providerEventId });
    if (inspection.kind === "unresolved") {
      await dependencies.probes.defer(probe, inspection.code, nowIso());
      return;
    }
    // Recheck persisted ownership after I/O as well as before it.
    const current = await dependencies.repository.getById(bookingId);
    if (!current || current.state === "cancelled" || current.calendarProviderEventId !== providerEventId || current.occurrence.id !== probe.occurrenceId) {
      await dependencies.probes.resolve(probe, "superseded", nowIso());
      return;
    }
    if (inspection.kind === "present") {
      if (inspection.event.bookingId !== bookingId) {
        await dependencies.probes.defer(probe, "identity_missing", nowIso());
        return;
      }
      // A replacement or edited event is repaired to Dial's canonical occurrence;
      // timestamps from a different identity never advance its local watermark.
      if (inspection.event.providerEventId !== providerEventId || inspection.event.occurrenceId !== current.occurrence.id) {
        await dependencies.repository.enqueueCalendarRepair(current, `inspection:${inspection.event.providerEventId}:${inspection.event.updatedAt}`);
      } else await dependencies.reconcilePresent(inspection.event);
      await dependencies.probes.resolve(probe, "present", nowIso());
      return;
    }
    if (inspection.providerEventId !== providerEventId) {
      await dependencies.probes.defer(probe, "identity_missing", nowIso());
      return;
    }
    await dependencies.cancel(current, providerEventId);
    await dependencies.probes.resolve(probe, "deleted", nowIso());
  } catch (error) {
    await dependencies.probes.defer(probe, error instanceof ProviderFailure ? error.code : "internal_error", nowIso());
  }
}
