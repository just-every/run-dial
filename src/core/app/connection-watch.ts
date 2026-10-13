import type { AppBindings } from "./bindings";
import type { ConnectionWatchObservers } from "../features/calendar-connection";

// NOTIFY-007: alert within 60 seconds of the calendar connection becoming unhealthy, and never for a brief error.
// This singleton coordinator keeps the watch on its alarm. From the moment a connection becomes healthy, and while one
// exists, it probes the provider 30 s after each full health check (the scheduled pass's, or its own when a pass is
// missing), so no healthy stretch goes unread for longer than about 30 s. A request, pass or probe that sees a healthy
// connection fail starts an incident: the connection is re-checked 10 s later and confirmed 20 s later. Only the
// confirmation alerts, and only when every check since the sighting failed; a re-check that reads healthy ends the
// incident, so an error that clears within the window sends nothing, and the next failure starts its own window.
export const connectionWatchBoundary = "connection-watch";
export const connectionProbeAfterCheckMs = 30_000;
/** A probe's own successor leaves room for the scheduled pass, whose check moves the next probe to 30 s after it. */
export const connectionProbeAfterProbeMs = 35_000;
export const connectionRecheckDelayMs = 10_000;
export const connectionConfirmationDelayMs = 20_000;

const confirmKey = "confirm-at";
const recheckKey = "recheck-at";
const probeKey = "probe-at";

/** What a connection's checks tell the watch from outside its coordinator; a healthy check starts the watch at connect. */
export function connectionWatchObservers(env: AppBindings): ConnectionWatchObservers {
  return {
    sighting: () => askWatch(env, "/__connection-sighting"),
    stillFailing: () => askWatch(env, "/__connection-confirmation"),
    checkedHealthy: () => askWatch(env, "/__connection-watch"),
  };
}

async function askWatch(env: AppBindings, path: string) {
  const namespace = env.BOOKING_COORDINATOR;
  const response = await namespace.get(namespace.idFromName(connectionWatchBoundary)).fetch(new Request(`http://coordinator.internal${path}`, { method: "POST" }));
  if (!response.ok) throw new Error(`The calendar connection watch refused ${path} (${response.status}).`);
}

export const connectionWatchPaths = ["/__connection-sighting", "/__connection-confirmation", "/__connection-watch"];

/** The watch's schedule in the coordinator's storage: the next probe and a pending incident's re-check and confirmation. */
export class ConnectionWatchSchedule {
  constructor(private readonly storage: DurableObjectStorage) {}

  answer(path: string, now = Date.now()) {
    if (path === "/__connection-sighting") return this.sighting(now);
    if (path === "/__connection-confirmation") return this.requestConfirmation(now);
    return this.checked(now);
  }

  /** The same observers inside the coordinator's own alarm, which must not call itself. */
  observers(): ConnectionWatchObservers {
    return { sighting: () => this.sighting(), stillFailing: () => this.requestConfirmation(), checkedHealthy: () => this.checked() };
  }

  /** A new incident replaces any earlier one: that one ended when a check read the connection healthy in between. */
  async sighting(now = Date.now()) {
    await this.storage.put({ [recheckKey]: now + connectionRecheckDelayMs, [confirmKey]: now + connectionConfirmationDelayMs });
    await this.rearm();
  }

  async requestConfirmation(now = Date.now()) {
    if (await this.storage.get<number>(confirmKey) === undefined) return this.sighting(now);
    await this.rearm();
  }

  async checked(now = Date.now()) {
    await this.storage.put(probeKey, now + connectionProbeAfterCheckMs);
    await this.rearm();
  }

  /** What the alarm firing now must do, most decisive first: the confirmation, else the re-check, else a probe. */
  async due(now = Date.now()) {
    const at = await this.storage.get<number>([confirmKey, recheckKey, probeKey]);
    const dueAt = (key: string) => { const value = at.get(key); return value !== undefined && value <= now ? value : undefined; };
    if (dueAt(confirmKey) !== undefined) return { kind: "confirm" as const, key: confirmKey, at: dueAt(confirmKey)! };
    if (dueAt(recheckKey) !== undefined) return { kind: "recheck" as const, key: recheckKey, at: dueAt(recheckKey)! };
    if (dueAt(probeKey) !== undefined) return { kind: "probe" as const, key: probeKey, at: dueAt(probeKey)! };
    return undefined;
  }

  /**
   * After the alarm's work. A re-check that read healthy ends its incident. A probe schedules its successor unless a
   * full check moved it meanwhile; the watch stops once no connection exists. Entries a request changed meanwhile stay.
   */
  async settle(ran: Awaited<ReturnType<ConnectionWatchSchedule["due"]>>, outcome: { connected: boolean; healthy: boolean }, now = Date.now()) {
    if (ran && await this.storage.get<number>(ran.key) === ran.at) {
      if (ran.kind === "probe") await this.storage.put(probeKey, now + connectionProbeAfterProbeMs);
      else if (ran.kind === "recheck") await this.storage.delete(outcome.healthy ? [recheckKey, confirmKey] : [recheckKey]);
      else await this.storage.delete([confirmKey, recheckKey]);
    }
    if (!outcome.connected) await this.storage.delete([probeKey, recheckKey, confirmKey]);
    await this.rearm();
  }

  private async rearm() {
    const next = [...(await this.storage.get<number>([confirmKey, recheckKey, probeKey])).values()];
    if (next.length === 0) await this.storage.deleteAlarm();
    else await this.storage.setAlarm(Math.min(...next));
  }
}
