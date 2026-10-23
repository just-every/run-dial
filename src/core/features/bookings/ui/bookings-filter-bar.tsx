import { useHydrated } from "../../../app/use-hydrated";
import type { EventTypeRecord } from "../../event-types";
import { Button, Card, Input, Segmented, Select } from "../../../app/ui/primitives";
import { hasBookingFilters, type BookingFilters } from "./booking-filters";

type LifecycleState = NonNullable<BookingFilters["state"]> | "all";
const stateOptions = [["all", "All states"], ["confirmed", "Confirmed"], ["rescheduled", "Rescheduled"], ["cancelled", "Cancelled"]] as const;
const fieldLabel = "grid content-start gap-2 text-sm font-[650] text-ink";

export function BookingsFilterBar({
  filters,
  eventTypes,
  hostTimezone,
  onChange,
  onClear,
}: {
  filters: BookingFilters;
  eventTypes: EventTypeRecord[];
  hostTimezone?: string;
  onChange: (change: Partial<BookingFilters>) => void;
  onClear: () => void;
}) {
  const hydrated = useHydrated();
  const deliverySelection = filters.deliveryFailed === "true" ? "failed" : filters.deliveryFailed === "false" ? "clear" : "any";

  return <Card className="p-4 sm:p-5"><fieldset disabled={!hydrated} aria-busy={!hydrated} className="grid min-w-0 gap-5 border-0 p-0">
    <Segmented<LifecycleState> stacked label="Lifecycle state" name="booking-lifecycle-state" value={filters.state ?? "all"} options={stateOptions} onChange={(state) => onChange({ state: state === "all" ? undefined : state })} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className={`${fieldLabel} sm:col-span-2 xl:col-span-1`}>
        Search invitee name or email
        <Input type="search" autoComplete="off" maxLength={160} value={filters.query ?? ""} onChange={(event) => onChange({ query: event.currentTarget.value || undefined })} placeholder="Name or email" />
      </label>
      <label className={fieldLabel}>
        Start time
        <Select value={filters.time ?? "all"} onChange={(event) => onChange({ time: event.currentTarget.value === "all" ? undefined : event.currentTarget.value as NonNullable<BookingFilters["time"]> })}>
          <option value="all">Any time</option>
          <option value="future">Future</option>
          <option value="past">Past</option>
        </Select>
      </label>
      <label className={fieldLabel}>
        Event type
        <Select value={filters.eventTypeId ?? "all"} onChange={(event) => onChange({ eventTypeId: event.currentTarget.value === "all" ? undefined : event.currentTarget.value })}>
          <option value="all">All event types</option>
          {eventTypes.map((eventType) => <option value={eventType.id} key={eventType.id}>{eventType.title}</option>)}
        </Select>
      </label>
      <label className={fieldLabel}>
        External delivery
        <Select value={deliverySelection} onChange={(event) => onChange({ deliveryFailed: event.currentTarget.value === "any" ? undefined : event.currentTarget.value === "failed" ? "true" : "false" })}>
          <option value="any">Any delivery state</option>
          <option value="failed">Has a failed delivery</option>
          <option value="clear">No failed deliveries</option>
        </Select>
      </label>
      <label className={fieldLabel}>
        Reschedule request
        <Select value={filters.rescheduleRequest ?? "all"} onChange={event => onChange({ rescheduleRequest: event.currentTarget.value === "all" ? undefined : event.currentTarget.value as BookingFilters["rescheduleRequest"] })}>
          <option value="all">Any request state</option>
          <option value="open">Open</option>
          <option value="picked">New time picked</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </label>
      <label className={fieldLabel}>
        From date ({hostTimezone ?? "host time zone"})
        <Input type="date" value={filters.from ?? ""} max={filters.to} onChange={(event) => onChange({ from: event.currentTarget.value || undefined })} />
      </label>
      <label className={fieldLabel}>
        Through date ({hostTimezone ?? "host time zone"})
        <Input type="date" value={filters.to ?? ""} min={filters.from} onChange={(event) => onChange({ to: event.currentTarget.value || undefined })} />
      </label>
      <div className={fieldLabel}><label htmlFor="booking-attendance">Attendance</label><Select id="booking-attendance" value={filters.attendance??"all"} onChange={e=>onChange({attendance:e.target.value==="all"?undefined:e.target.value as BookingFilters["attendance"]})}><option value="all">Any attendance</option><option value="attended">Attended</option><option value="no_show">No-show</option><option value="unmarked">Not marked</option></Select></div>
      <div className="flex items-end">
        <Button type="button" variant="quiet" onClick={onClear} disabled={!hasBookingFilters(filters)}>Clear filters</Button>
      </div>
    </div>
  </fieldset></Card>;
}
