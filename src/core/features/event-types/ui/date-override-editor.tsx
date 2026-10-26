import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Badge, Button, Card } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import type { DateAvailabilityOverrideRecord } from "../repository";
import { useHydrated } from "../../../app/use-hydrated";
import { OverrideForm, type OverrideDraft } from "./date-override-form";
import { boundaryLabel } from "./window-time";

const blankOverride = (): OverrideDraft => ({ hostDate: "", mode: "closed", windows: [] });

export function DateOverrideEditor({ eventId, timezone }: { eventId: string; timezone?: string }) {
  const hydrated = useHydrated();
  const addButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  const inFlight = useRef(false);
  const loadEpoch = useRef(0);
  const edited = useRef(false);
  const [overrides, setOverrides] = useState<DateAvailabilityOverrideRecord[]>();
  const [draft, setDraft] = useState<OverrideDraft>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!draft && !saving && restoreFocus.current) {
      (opener.current?.isConnected ? opener.current : addButton.current)?.focus();
      restoreFocus.current = false;
    }
  }, [draft, saving]);

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    setError("");
    try {
      const response = await api.api.app["event-types"][":id"]["availability-overrides"].$get({ param: { id: eventId } });
      if (epoch !== loadEpoch.current) return;
      if (!response.ok) { const message = await errorMessage(response); if (epoch === loadEpoch.current) setError(message); return; }
      const records = await response.json();
      if (epoch === loadEpoch.current && !edited.current) setOverrides(records);
    } catch { if (epoch === loadEpoch.current) setError("Date overrides could not be loaded. Reload to try again."); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { loadEpoch.current += 1; }; }, [load]);

  function update(next: Partial<OverrideDraft>) {
    edited.current = true;
    setDraft((current) => ({ ...(current ?? blankOverride()), ...next }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || !hydrated || inFlight.current) return;
    inFlight.current = true; loadEpoch.current += 1; setSaving(true); setError("");
    try {
      const response = await api.api.app["event-types"][":id"]["availability-overrides"][":hostDate"].$put({ param: { id: eventId, hostDate: draft.hostDate }, json: { mode: draft.mode, windows: draft.windows } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const stored = await response.json();
      setOverrides((current) => [...(current ?? []).filter((entry) => entry.hostDate !== stored.hostDate), stored].sort((left, right) => left.hostDate.localeCompare(right.hostDate)));
      restoreFocus.current = true;
      setDraft(undefined);
    } catch { setError("The save result could not be checked. Your date and windows are kept here; review the override before retrying."); }
    finally { inFlight.current = false; setSaving(false); }
  }
  async function remove(hostDate: string) {
    if (!hydrated || inFlight.current) return;
    inFlight.current = true; loadEpoch.current += 1; setSaving(true); setError("");
    try {
      const response = await api.api.app["event-types"][":id"]["availability-overrides"][":hostDate"].$delete({ param: { id: eventId, hostDate } });
      if (!response.ok && response.status !== 404) { setError(await errorMessage(response)); return; }
      opener.current = null; restoreFocus.current = true;
      setOverrides((current) => current?.filter((entry) => entry.hostDate !== hostDate));
      if (draft?.hostDate === hostDate) setDraft(undefined);
    } catch { setError("Removal could not be checked. The override is kept here; retry removal to check it again."); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading icon="overrides" title="Date-specific overrides" description={`An override replaces recurring windows for one host date. ${timezone ? `Dates use ${timezone}.` : "Loading the host timezone…"}`} action={!draft ? <Button ref={addButton} type="button" variant="secondary" disabled={!hydrated || saving || !overrides} onClick={(event) => { opener.current = event.currentTarget; setDraft(blankOverride()); }}>Add date override</Button> : undefined} />
      {error ? <p role="alert" className="mt-4 rounded-[14px] bg-danger-wash p-3 text-sm leading-6 text-danger">{error}</p> : null}
      {draft ? <OverrideForm draft={draft} saving={!hydrated || saving} onChange={update} onCancel={() => { restoreFocus.current = true; setDraft(undefined); }} onSave={save} /> : null}
      {overrides === undefined ? error ? <Button type="button" className="mt-5" variant="secondary" disabled={!hydrated} onClick={() => void load()}>Reload date overrides</Button> : <p role="status" className="mt-5 text-sm text-muted">Loading date overrides…</p> : overrides.length === 0 ? <p className="mt-5 rounded-2xl bg-row px-4 py-3.5 text-sm text-soft">No date overrides are configured. Recurring windows apply on every date.</p> : <div className="mt-5 grid gap-2.5">{overrides.map((override) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-row px-4 py-3.5" key={override.id}><div><h3 className="font-bold">{override.hostDate}</h3><p className="mt-1.5 text-sm text-soft">{override.mode === "closed" ? <Badge tone="warning">{describeOverride(override)}</Badge> : describeOverride(override)}</p></div><div className="flex gap-2"><Button type="button" variant="quiet" disabled={!hydrated || saving} onClick={(event) => { opener.current = event.currentTarget; setDraft({ hostDate: override.hostDate, mode: override.mode, windows: override.windows }); }}>Edit {override.hostDate}</Button><Button type="button" variant="quiet" disabled={!hydrated || saving} aria-label={`Remove override for ${override.hostDate}`} onClick={() => void remove(override.hostDate)}>Remove</Button></div></div>)}</div>}
    </Card>
  );
}

function describeOverride(override: DateAvailabilityOverrideRecord) {
  return override.mode === "closed" ? "Closed all day" : override.windows.map((window) => `${boundaryLabel(window.startMinute)}–${boundaryLabel(window.endMinute)}`).join(", ");
}
