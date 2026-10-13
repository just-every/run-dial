import { and, asc, eq } from "drizzle-orm";
import type { createDatabase } from "../../../platform/db/client";
import { availabilityDateOverrides, availabilityDateOverrideWindows } from "../../../platform/db/schema";
import type { DateAvailabilityOverrideRecord } from "../repository";

/** Filter in D1 so the query's bind count never grows with stored overrides. */
export async function readDateOverrides(db: ReturnType<typeof createDatabase>, eventTypeId: string, hostDate?: string): Promise<DateAvailabilityOverrideRecord[]> {
  const rows = await db
    .select({ override: availabilityDateOverrides, window: availabilityDateOverrideWindows })
    .from(availabilityDateOverrides)
    .leftJoin(availabilityDateOverrideWindows, eq(availabilityDateOverrideWindows.overrideId, availabilityDateOverrides.id))
    .where(and(eq(availabilityDateOverrides.eventTypeId, eventTypeId), hostDate === undefined ? undefined : eq(availabilityDateOverrides.hostDate, hostDate)))
    .orderBy(asc(availabilityDateOverrides.hostDate), asc(availabilityDateOverrideWindows.position));
  const overrides = new Map<string, DateAvailabilityOverrideRecord>();
  for (const { override, window } of rows) {
    let record = overrides.get(override.id);
    if (!record) {
      record = {
        id: override.id,
        hostDate: override.hostDate,
        mode: override.mode,
        windows: [],
        createdAt: override.createdAt,
        updatedAt: override.updatedAt,
      };
      overrides.set(override.id, record);
    }
    if (window) record.windows.push({ startMinute: window.startMinute, endMinute: window.endMinute });
  }
  return [...overrides.values()];
}
