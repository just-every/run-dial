import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { Button, Card, Input, Select, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import { useHydrated } from "../../../app/use-hydrated";
import type { EventTypeRecord } from "../../event-types";
import type { SchedulingReport } from "../../reports/client";
import type { BookingFilters } from "./booking-filters";
import { ReportTileCard } from "./report-tile";

const fieldLabel = "grid content-start gap-2 text-sm font-[650] text-ink";

/** REPORT-001 inside the Bookings workspace: the same period and event-type filters, one card per figure. */
export function SchedulingReportView({ filters, eventTypes, onChange }: { filters: BookingFilters; eventTypes: EventTypeRecord[]; onChange(change: Partial<BookingFilters>): void }) {
  const hydrated = useHydrated();
  const [report, setReport] = useState<SchedulingReport>(), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const { from, to, eventTypeId } = filters;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.api.app.reports.scheduling.$get({ query: { ...(from ? { fromDate: from } : {}), ...(to ? { throughDate: to } : {}), ...(eventTypeId ? { eventTypeId } : {}) } });
      if (!response.ok) { setReport(undefined); setError(await errorMessage(response)); }
      else { setReport(await response.json() as SchedulingReport); setError(""); }
    } catch { setReport(undefined); setError("The scheduling report could not be loaded."); }
    finally { setLoading(false); }
  }, [from, to, eventTypeId]);
  useEffect(() => { void load(); }, [load]);
  const empty = report && report.tiles.every(tile => tile.count === 0);
  return <div className="grid gap-7">
    <PageHeader eyebrow="Booking workspace" title="Scheduling report" description="What was booked, moved, canceled, attended and paid for in a period. Every figure states what it counts and lists those bookings." actions={<Link to="/app/bookings" search={() => ({})} className={buttonClassName("secondary")}>Back to bookings</Link>} />
    <Card className="p-4 sm:p-5"><fieldset disabled={!hydrated} aria-busy={!hydrated} className="grid min-w-0 gap-4 border-0 p-0 sm:grid-cols-2 xl:grid-cols-4">
      <label className={fieldLabel}>From date ({report?.period.timezone ?? "host time zone"})<Input type="date" value={from ?? report?.period.fromDate ?? ""} max={to} onChange={event => onChange({ from: event.currentTarget.value || undefined })} /></label>
      <label className={fieldLabel}>Through date ({report?.period.timezone ?? "host time zone"})<Input type="date" value={to ?? report?.period.throughDate ?? ""} min={from} onChange={event => onChange({ to: event.currentTarget.value || undefined })} /></label>
      <label className={fieldLabel}>Event type<Select value={eventTypeId ?? "all"} onChange={event => onChange({ eventTypeId: event.currentTarget.value === "all" ? undefined : event.currentTarget.value })}><option value="all">All event types</option>{eventTypes.map(eventType => <option value={eventType.id} key={eventType.id}>{eventType.title}</option>)}</Select></label>
      <div className="flex items-end"><Button type="button" variant="quiet" onClick={() => onChange({ from: undefined, to: undefined, eventTypeId: undefined })} disabled={!from && !to && !eventTypeId}>Last 30 days, all event types</Button></div>
    </fieldset></Card>
    {error ? <div role="alert" className={noticeClassName("error", "font-semibold")}>{error} <Button type="button" variant="quiet" onClick={() => void load()}>Try again</Button></div> : null}
    <p className="text-sm font-semibold text-soft" role="status" aria-live="polite">{loading ? "Loading the report…" : report ? `Period ${report.period.fromDate} to ${report.period.throughDate} in ${report.period.timezone}` : "Report unavailable"}</p>
    {!loading && empty ? <EmptyState title="No bookings in this period" description="Choose a longer period or another event type. Figures appear as bookings are created, moved, canceled and paid." /> : null}
    {!loading && report && !empty ? <div className="grid items-start gap-5 xl:grid-cols-2">{report.tiles.map(tile => <ReportTileCard key={tile.key} tile={tile} report={report} />)}</div> : null}
    <Card className="p-5 sm:p-6"><section aria-label="Figures not available yet"><h2 className="text-[19px] font-[750] leading-[1.25] text-ink">Not available on this install yet</h2>
      <ul className="mt-3 grid gap-2 text-sm leading-6 text-soft"><li>Choosing a host or a team: this install has one host, and team scheduling is not built yet.</li><li>Routing-form submissions and their conversion by route and UTM source: routing forms are not built yet.</li><li>Round-robin distribution: round-robin teams are not built yet.</li><li>A member seeing only their own figures: roles are not built yet, so every operator is an owner and sees every figure.</li></ul></section></Card>
  </div>;
}
