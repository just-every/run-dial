import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sheet } from "../../../app/ui/sheet";
import { useEventPage } from "./event-page-context";
import { AdvancedSettings } from "./advanced-sheet";
import { AvailabilityPage } from "./availability-page";
import { SchedulingLimits } from "./scheduling-limits";

declare module "@tanstack/react-router" {
  interface HistoryState { eventSettingsFrom?: string; }
}

function useCloseSettings() {
  const page = useEventPage();
  const navigate = useNavigate();
  const router = useRouter();
  return () => {
    const eventPath = `${page.workspace}/event-types/${page.event.id}`;
    // A row added this sheet after its event page; closing consumes that entry.
    if (router.state.location.state.eventSettingsFrom === eventPath) router.history.back();
    else void navigate({ to: `${page.workspace}/event-types/$id`, params: { id: page.event.id }, replace: true });
  };
}

export function EventAdvancedRoute() {
  const page = useEventPage();
  const close = useCloseSettings();
  return <Sheet title="Advanced settings" closeLabel="Close settings" returnFocusId="event-advanced-row" onClose={close}><AdvancedSettings event={page.event} details={page.details} onSaved={page.onSaved} hostName={page.hostName} hostTimezone={page.hostTimezone} /></Sheet>;
}
export function EventHoursRoute() {
  const page = useEventPage();
  const { onHoursClosed } = page;
  useEffect(() => () => onHoursClosed(), [onHoursClosed]);
  const close = useCloseSettings();
  return <Sheet title={`${page.event.title}’s hours`} closeLabel="Close hours" returnFocusId="event-hours-row" onClose={close}><AvailabilityPage eventId={page.event.id} workspace={page.workspace} /><SchedulingLimits /></Sheet>;
}
