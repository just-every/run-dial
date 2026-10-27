import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Card, IconTile, textLinkClassName } from "../../../app/ui/primitives";
import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import type { HoursRead } from "../your-hours";
import type { BookingLimitsConfig } from "../booking-limits";
import { WeeklyHours } from "./weekly-hours";
import { BookingCaps, capsSummary } from "./booking-caps";
import { Holidays, OtherHours, TimeOff } from "./hours-extras";
import { HoursRow } from "./hours-row";

type Read = { hours: HoursRead; limits: BookingLimitsConfig };

export function HoursPage() {
  const [data, setData] = useState<Read>();
  const [error, setError] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const token = ++epoch.current;
    setError(false);
    try {
      const [hoursResponse, limitsResponse] = await Promise.all([api.api.app.hours.$get(), api.api.app["booking-limits"][":scope"].$get({ param: { scope: "host" } })]);
      if (!hoursResponse.ok || !limitsResponse.ok) throw new Error();
      const [hours, limits] = await Promise.all([hoursResponse.json(), limitsResponse.json()]);
      if (token === epoch.current) setData(current => current ?? { hours, limits });
    } catch { if (token === epoch.current) setError(true); }
  }, []);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  return data ? <HoursSettings data={data} /> : <WorkspaceLoadState error={error} label="Loading hours…" onRetry={load} />;
}

function HoursSettings({ data: { hours, limits } }: { data: Read }) {
  const [caps, setCaps] = useState(limits);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const scheduleId = useRef(hours.yours?.id);
  const initial = { name: "Your hours", windows: hours.yours?.windows ?? [1, 2, 3, 4, 5].map(weekday => ({ weekday, startMinute: 540, endMinute: 1020 })), blockUsHolidays: hours.yours?.blockUsHolidays ?? false, reopenedHolidays: hours.yours?.reopenedHolidays ?? [], timeOff: hours.yours?.timeOff ?? [] };
  const form = useAutosave("settings:your-hours", initial, async (next, init) => {
    if (next.windows.some(window => window.endMinute <= window.startMinute)) throw new Error("Ends before it starts. Choose a later end time.");
    // A fresh installation has no schedule yet. The first edit creates yours without binding any event.
    if (!scheduleId.current) {
      const response = await api.api.app.hours.closures.$put({ json: { blockUsHolidays: next.blockUsHolidays, reopenedHolidays: next.reopenedHolidays, timeOff: next.timeOff } }, { init });
      if (!response.ok) throw new Error(await errorMessage(response));
      scheduleId.current = (await response.json()).id;
    }
    const response = await api.api.app["availability-schedules"][":id"].$put({ param: { id: scheduleId.current }, json: next }, { init });
    if (!response.ok) throw new Error(await errorMessage(response));
  });
  const ownEvents = hours.events.filter(event => event.uses === "own");
  return <div className="grid min-w-0 gap-6">
    <PageHeader title="Hours" description="When people can book you." />
    <Card className="min-w-0 p-5 sm:p-6">
      <SectionHeading title="Your hours" icon="clock" action={<SavedMark state={form.state("windows")} />} />
      <p className="mb-5 mt-2 text-sm text-soft">Every event uses these unless it has its own. {profile?.timezone ? `Times are in ${profile.timezone.replaceAll("_", " ")}.` : "Set your time zone in Profile."}</p>
      <WeeklyHours windows={form.values.windows} onChange={windows => form.choose("windows", windows)} />
      <SaveFailed id="your-windows-failed" state={form.state("windows")} what="your hours" choice onRetry={form.retry} />
    </Card>
    <Card className="min-w-0 py-1">
      <HoursRow title="Time off" summary={form.values.timeOff.length ? `${form.values.timeOff.length} planned` : "Nothing planned · add days you’re away"} icon="calendar">
        <TimeOff value={form.values} state={form.state("timeOff")} onChange={timeOff => form.choose("timeOff", timeOff)} onRetry={form.retry} />
      </HoursRow>
      <div className="min-w-0 px-5 py-3 sm:px-6">
        <label className="relative flex min-h-[52px] cursor-pointer items-center gap-3">
          <IconTile icon="calendar" />
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-1 text-[16px] font-bold">US public holidays<SavedMark state={form.state("blockUsHolidays")} /></span><span className="mt-0.5 block text-sm text-soft">{form.values.blockUsHolidays ? "On · every US federal holiday is closed" : "Off · turn on to close every US federal holiday"}</span></span>
          <input type="checkbox" role="switch" aria-label="US public holidays" checked={form.values.blockUsHolidays} onChange={change => form.choose("blockUsHolidays", change.target.checked)} className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0" />
          <span aria-hidden="true" className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${form.values.blockUsHolidays ? "justify-end bg-gold-wash" : "bg-wash"}`}><span className="size-5 rounded-full bg-ink" /></span>
        </label>
        <SaveFailed id="your-holidays-failed" state={form.state("blockUsHolidays")} what="holiday choice" choice onRetry={form.retry} />
        <div hidden={!form.values.blockUsHolidays}><details className="mt-3"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Review holidays</summary><Holidays value={form.values} state={form.state("reopenedHolidays")} onChange={next => { if (next.reopenedHolidays) form.choose("reopenedHolidays", next.reopenedHolidays); }} onRetry={form.retry} /></details></div>
      </div>
      <HoursRow title="Limits" summary={capsSummary(caps)}><BookingCaps scope="host" initial={limits} onSaved={setCaps} /></HoursRow>
      <HoursRow title="Other hours" summary="Hours shared between events"><OtherHours initial={hours.others} windows={form.values.windows} /></HoursRow>
      <HoursRow title="Events with their own hours" summary={ownEvents.length ? ownEvents.map(event => event.title).join(" · ") : "Every event uses shared hours"}>
        <div className="grid gap-1">{ownEvents.map(event => <Link key={event.id} to="/app/event-types/$id/availability" params={{ id: event.id }} className={`${textLinkClassName} flex min-h-11 items-center py-2`}>{event.title}</Link>)}</div>
      </HoursRow>
    </Card>
  </div>;
}
