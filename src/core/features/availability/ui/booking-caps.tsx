import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Input } from "../../../app/ui/primitives";
import { SavedMark, SaveFailed } from "../../../app/ui/autosave/saved-state";
import { useAutosave } from "../../../app/ui/autosave/use-autosave";
import type { BookingLimitsConfig } from "../booking-limits";

const periods = [["day", "Day"], ["week", "Week"], ["month", "Month"]] as const;
type LimitValues = Record<keyof BookingLimitsConfig, string>;

/** Limits have their scope fixed by their home: all events in Settings, or this event in its Hours. */
export function BookingCaps({ scope, initial, onSaved }: { scope: string; initial?: BookingLimitsConfig; onSaved?(limits: BookingLimitsConfig): void }) {
  const [limits, setLimits] = useState(initial);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await api.api.app["booking-limits"][":scope"].$get({ param: { scope } });
      if (!response.ok) throw new Error(await errorMessage(response));
      setLimits(await response.json() as BookingLimitsConfig);
    } catch { setError("Limits could not be loaded."); }
  }, [scope]);
  useEffect(() => { if (!initial) void load(); }, [initial, load]);
  if (!limits) return error ? <p role="alert" className="text-sm text-danger">{error} <Button type="button" variant="quiet" onClick={() => void load()}>Retry</Button></p> : <p role="status" className="text-sm text-muted">Loading limits…</p>;
  return <CapFields scope={scope} initial={limits} onSaved={onSaved} />;
}

function CapFields({ scope, initial, onSaved }: { scope: string; initial: BookingLimitsConfig; onSaved?(limits: BookingLimitsConfig): void }) {
  const initialValues = Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, value === null ? "" : String(value)])) as LimitValues;
  const form = useAutosave(`booking-caps:${scope}`, initialValues, async (values, init) => {
    const limits = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === "" && key !== "inviteeGapMinutes" ? null : Number(value)])) as BookingLimitsConfig;
    const response = await api.api.app["booking-limits"][":scope"].$put({ param: { scope }, json: limits }, { init });
    if (!response.ok) throw new Error(await errorMessage(response));
    onSaved?.(await response.json());
  });
  return <div className="grid gap-4">
    <p className="text-sm text-muted">{scope === "host" ? "Across all events." : "For this event."} Blank means no cap; zero closes that period.</p>
    <div className="grid gap-4 sm:grid-cols-3">{periods.map(([period, label]) => <div key={period} className="grid content-start gap-3">
      <h3 className="text-sm font-bold">{label}</h3>
      {(["Count", "Minutes"] as const).map(kind => {
        const field = `${period}${kind}` as keyof LimitValues;
        const id = `${scope}-${field}-failure`;
        return <label key={field} className="grid min-w-0 content-start gap-1.5 text-sm">
          <span className="flex flex-wrap items-center justify-between gap-1">{kind === "Count" ? "Bookings" : "Minutes"}<SavedMark state={form.state(field)} /></span>
          <Input type="number" min="0" step="1" aria-label={`${label} ${kind === "Count" ? "booking cap" : "minute cap"}`} aria-describedby={form.state(field).failed ? id : undefined} value={form.values[field]} onChange={event => form.type(field, event.target.value)} onBlur={form.leave} />
          <SaveFailed id={id} state={form.state(field)} what={`${label.toLowerCase()} limit`} onRetry={form.retry} />
        </label>;
      })}
    </div>)}</div>
    <label className="grid content-start gap-1.5 text-sm">
      <span className="flex flex-wrap items-center justify-between gap-1">Minimum gap for the same invitee (minutes)<SavedMark state={form.state("inviteeGapMinutes")} /></span>
      <Input type="number" min="0" step="1" aria-label="Minimum gap for the same invitee (minutes)" value={form.values.inviteeGapMinutes} aria-describedby={form.state("inviteeGapMinutes").failed ? `${scope}-gap-failure` : undefined} onChange={event => form.type("inviteeGapMinutes", event.target.value)} onBlur={form.leave} />
      <SaveFailed id={`${scope}-gap-failure`} state={form.state("inviteeGapMinutes")} what="invitee gap" onRetry={form.retry} />
    </label>
  </div>;
}

export function capsSummary(limits: BookingLimitsConfig) {
  const parts: string[] = [];
  for (const [period] of periods) {
    const count = limits[`${period}Count`], minutes = limits[`${period}Minutes`];
    if (count !== null) parts.push(`${count} bookings/${period}`);
    if (minutes !== null) parts.push(`${minutes} min/${period}`);
  }
  if (limits.inviteeGapMinutes) parts.push(`${limits.inviteeGapMinutes} min between the same invitee`);
  return parts.join(" · ") || "No daily or weekly caps";
}
