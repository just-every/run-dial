import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sheet } from "../../../app/ui/sheet";
import { useEventPage } from "./event-page-context";
import { AdvancedSettings } from "./advanced-sheet";
import { AvailabilityPage } from "./availability-page";
import { SchedulingLimits } from "./scheduling-limits";

export function EventAdvancedRoute() {
  const page = useEventPage();
  const navigate = useNavigate();
  return <Sheet title="Advanced settings" closeLabel="Close settings" returnFocusId="event-advanced-row" onClose={() => void navigate({ to: `${page.workspace}/event-types/$id`, params: { id: page.event.id } })}><AdvancedSettings event={page.event} details={page.details} onSaved={page.onSaved} hostName={page.hostName} hostTimezone={page.hostTimezone} /></Sheet>;
}
export function EventHoursRoute() {
  const page = useEventPage();
  const { onHoursClosed } = page;
  useEffect(() => () => onHoursClosed(), [onHoursClosed]);
  const navigate = useNavigate();
  return <Sheet title={`${page.event.title}’s hours`} closeLabel="Close hours" returnFocusId="event-hours-row" onClose={() => void navigate({ to: `${page.workspace}/event-types/$id`, params: { id: page.event.id } })}><AvailabilityPage eventId={page.event.id} workspace={page.workspace} /><SchedulingLimits /></Sheet>;
}
