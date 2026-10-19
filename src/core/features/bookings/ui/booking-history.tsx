import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import type { BookingHistoryEntry, BookingRecord } from "../types";
import { startTime } from "./operator-time";

const actions: Record<BookingHistoryEntry["action"], string> = {
  manage_link_rotated: "Manage link replaced",
  created: "Created", cancelled: "Cancelled", rescheduled: "Rescheduled",
  attendance_marked: "Attendance recorded", calendar_cancelled: "Cancelled by calendar provider",
  reschedule_requested: "Invitee asked to pick a new time", reschedule_request_reminded: "Reschedule request reminder sent",
  reschedule_request_picked: "New time picked", reschedule_request_expired: "Reschedule request expired",
};

export function BookingHistory({ booking }: { booking: BookingRecord }) {
  const [operators, setOperators] = useState<Array<{ id: string; email: string }>>([]);
  const [error, setError] = useState("");
  const hasOperator = booking.history.some(entry => entry.actorType === "operator");
  useEffect(() => {
    if (!hasOperator) return;
    let active = true;
    void (async () => {
      try {
        const response = await api.api.app.operators.$get();
        if (!response.ok) throw new Error(await errorMessage(response));
        const result = await response.json();
        if (active) setOperators(result.operators);
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : "Operator names could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [hasOperator]);
  const actor = (entry: BookingHistoryEntry) => {
    if (entry.actorType === "operator") {
      const operator = operators.find(operator => operator.id === entry.actorId);
      return `Operator ${operator ? `${operator.email} · ` : ""}${entry.actorId ?? "identity not recorded"}`;
    }
    return { invitee: "Manage-link holder", calendar_provider: "Calendar provider", system: "System" }[entry.actorType];
  };
  const newest = booking.history.reduce<BookingHistoryEntry | undefined>((latest, entry) => !latest || entry.createdAt > latest.createdAt ? entry : latest, undefined);
  return <section className="mt-6 border-t border-line-soft pt-5" aria-label="Booking history">
    <h3 className="font-bold text-ink">History</h3>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    {booking.history.length ? <ol className="mt-4 grid gap-4 text-sm text-muted">{booking.history.map(entry => {
      const imported = Boolean(booking.imported) && entry.action === "created";
      return <li key={entry.id} className="relative min-w-0 break-words pl-6 before:absolute before:top-1.5 before:bottom-[-1.25rem] before:left-[3.5px] before:w-px before:bg-line last:before:hidden">
        <span aria-hidden="true" className={`absolute top-1.5 left-0 h-2 w-2 rounded-full ${entry === newest ? "bg-gold" : "bg-ink"}`} />
        <p className="font-[650] text-ink">{imported ? "Imported" : actions[entry.action]} · {actor(entry)}</p>
        <p>{imported ? "Effective snapshot time (reviewed as of): " : "Action time: "}<time dateTime={entry.createdAt}>{startTime(entry.createdAt, booking.hostTimezone)}</time></p>
        {imported ? <p>Source created: <time dateTime={booking.createdAt}>{startTime(booking.createdAt, booking.hostTimezone)}</time></p> : null}
        {entry.previousStartAt ? <p>Previous start: <time dateTime={entry.previousStartAt}>{startTime(entry.previousStartAt, booking.hostTimezone)}</time></p> : null}
        {entry.newStartAt ? <p>New start: <time dateTime={entry.newStartAt}>{startTime(entry.newStartAt, booking.hostTimezone)}</time></p> : null}
        {entry.reason ? <p>{entry.reason}</p> : null}
      </li>;
    })}</ol> : <p className="mt-2 text-sm text-muted">No history recorded.</p>}
  </section>;
}
