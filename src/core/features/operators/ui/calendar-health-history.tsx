import type { CalendarHealthChange } from "../../calendar-connection/health-history";
import { operatorTimestamp } from "../../../shared/operator-format";

export function CalendarHealthHistory({ changes, timezone }: { changes: CalendarHealthChange[]; timezone: string | null }) {
  return <section className="mt-6 border-t border-line-soft pt-5" aria-label="Recent calendar connection changes">
    <h3 className="text-sm font-[650] text-ink">Recent connection changes</h3>
    {changes.length ? <ol className="mt-3 grid gap-3 sm:grid-cols-2">
      {changes.map(change => <li key={change.id} className="min-w-0 text-sm leading-6">
        <p className="font-[650] text-ink"><span className="capitalize">{change.fromState}</span> → {change.toState}</p>
        <p className="break-words text-soft">{change.reason.replaceAll("_", " ")}</p>
        <time className="text-muted" dateTime={change.occurredAt}>{operatorTimestamp(change.occurredAt, timezone ?? "UTC")}</time>
      </li>)}
    </ol> : <p className="mt-2 text-sm text-soft">No connection changes recorded yet.</p>}
  </section>;
}
