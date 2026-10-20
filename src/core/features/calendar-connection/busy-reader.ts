import type { CalendarAdapter, CalendarCredentials } from "../../platform/calendar";
import { failureCode } from "./health";
import type { CalendarConnectionRepository } from "./repository";

const cacheLifetimeMs = 5 * 60 * 1_000;

export type CalendarAvailabilityReader = {
  readBusy(input: { startAt: string; endAt: string; freshness: "cached" | "fresh" }): Promise<
    | { kind: "ok"; calendarRequired?: boolean; observedAt: string; intervals: Array<{ startAt: string; endAt: string }> }
    | { kind: "unavailable"; code: string }
  >;
};

export class CalendarBusyReader implements CalendarAvailabilityReader {
  constructor(
    private readonly repository: CalendarConnectionRepository,
    private readonly calendar: CalendarAdapter,
    private readonly credentials: () => Promise<CalendarCredentials>,
    private readonly recoverConnection: () => Promise<{ kind: "healthy" } | { kind: "unavailable"; code: string }>,
    private readonly onFailure: (error: unknown) => Promise<void>,
  ) {}

  async readBusy(input: { startAt: string; endAt: string; freshness: "cached" | "fresh" }) {
    let connection = await this.repository.get();
    // Absence is an explicit scheduling mode. An unhealthy or incomplete connection
    // always continues through the provider checks below and fails closed.
    if (!connection || connection.status === "disconnected") return { kind: "ok" as const, calendarRequired: false, observedAt: new Date().toISOString(), intervals: [] };
    let requiresFreshRead = input.freshness === "fresh";
    if (connection.status !== "healthy" || !connection.syncCursor) {
      const recovered = await this.recoverConnection();
      if (recovered.kind === "unavailable") return recovered;
      connection = await this.repository.get();
      // A callback, revoked token, or timeout may have invalidated an otherwise
      // recent snapshot. Successful health recovery must be followed by a
      // provider read for the requested range before exposing availability.
      requiresFreshRead = true;
    }
    const destination = connection?.selection.find((entry) => entry.purpose === "destination");
    const conflicts = connection?.selection.filter((entry) => entry.purpose === "conflict") ?? [];
    if (!connection || connection.status !== "healthy" || !destination || conflicts.length === 0) {
      return { kind: "unavailable" as const, code: "calendar_unavailable" };
    }
    const calendarIds = conflicts.map((entry) => entry.calendarId);
    if (!requiresFreshRead) {
      const cached = await this.repository.cachedBusyIntervals(calendarIds, input.startAt, input.endAt, new Date(Date.now() - cacheLifetimeMs).toISOString());
      if (cached) return { kind: "ok" as const, observedAt: cached.observedAt, intervals: cached.intervals.map((interval) => ({ startAt: interval.startsAt, endAt: interval.endsAt })) };
    }
    try {
      const busy = await this.calendar.readBusy((await this.credentials()).accessToken, {
        calendarIds,
        startsAt: input.startAt,
        endsAt: input.endAt,
        timeZone: "UTC",
      });
      await this.repository.replaceBusyIntervals({ calendarIds, startsAt: input.startAt, endsAt: input.endAt, intervals: busy.intervals, observedAt: busy.observedAt });
      await this.repository.markHealthy(busy.observedAt, true);
      return {
        kind: "ok" as const,
        observedAt: busy.observedAt,
        intervals: busy.intervals
          .filter((interval) => interval.transparency === "opaque" && !interval.deleted)
          .map((interval) => ({ startAt: interval.startsAt, endAt: interval.endsAt })),
      };
    } catch (error) {
      await this.onFailure(error);
      return { kind: "unavailable" as const, code: failureCode(error) };
    }
  }
}
