import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../../../api/client";
import { Card, Button, Input, Select, Textarea, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { useHydrated } from "../../../app/use-hydrated";
import { defaultFollowUp, type FollowUpSettings } from "../types";

export function FollowUpSettingsCard({ eventId }: { eventId: string }) {
  const hydrated = useHydrated(), [settings, setSettings] = useState<FollowUpSettings>(defaultFollowUp), [targets, setTargets] = useState<{ id: string; title: string; status: string }[]>([]);
  const [loaded, setLoaded] = useState(false), [working, setWorking] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  useEffect(() => { let current = true; void Promise.all([api.api.app["event-types"][":id"]["follow-up"].$get({ param: { id: eventId } }), api.api.app["event-types"].$get()]).then(async ([response, events]) => {
    if (!response.ok) throw new Error(await errorMessage(response)); if (!events.ok) throw new Error(await errorMessage(events));
    const saved = await response.json(), choices = await events.json(); if (current) { setSettings(saved); setTargets(choices); setLoaded(true); }
  }).catch(error => { if (current) setError(error instanceof Error ? error.message : "Follow-up settings could not be loaded."); }); return () => { current = false; }; }, [eventId]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (working || !loaded) return; setWorking(true); setError(""); setNotice("");
    try { const response = await api.api.app["event-types"][":id"]["follow-up"].$put({ param: { id: eventId }, json: settings }); if (!response.ok) { setError(await errorMessage(response)); return; } setSettings(await response.json()); setNotice("Follow-up settings saved."); }
    catch { setError("The save could not be checked. Reload to check the saved follow-up."); } finally { setWorking(false); }
  }
  return <Card className="mt-6 p-5 sm:p-6"><form aria-label="Post-meeting follow-up" className="grid gap-4" onSubmit={event => void save(event)}><SectionHeading icon="mail" title="After the meeting" description="Send one follow-up to the invitee after the meeting ends. Off until you turn it on; new bookings and reschedules create its timed job." /><fieldset disabled={!hydrated || !loaded || working} className="grid gap-4 border-0 p-0">
    <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" className="h-[18px] w-[18px]" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />Send a post-meeting follow-up</label>
    <label className="grid gap-2 text-sm font-semibold">Follow-up kind<Select value={settings.kind} onChange={event => setSettings({ ...settings, kind: event.target.value as FollowUpSettings["kind"], targetEventTypeId: null })}><option value="thank_you">Thank you and resources</option><option value="rebooking">Rebooking link</option><option value="feedback">Feedback request</option></Select></label>
    <label className="grid gap-2 text-sm font-semibold">Follow-up message<Textarea required maxLength={10000} value={settings.text} onChange={event => setSettings({ ...settings, text: event.target.value })} /></label>
    <p className="text-sm text-soft">Use booking template variables such as {"{invitee first name}"}, {"{host name}"}, {"{event name}"}, {"{date and time}"}, {"{duration}"}, {"{location}"} and answer variables. Private manage links are refused. Saved settings apply to pending follow-up sends.</p>
    <label className="grid gap-2 text-sm font-semibold">Minutes after the meeting ends<Input type="number" required min={1} max={43200} value={settings.offsetMinutes} onChange={event => setSettings({ ...settings, offsetMinutes: Number(event.target.value) })} /></label>
    {settings.kind === "rebooking" ? <label className="grid gap-2 text-sm font-semibold">Rebooking event<Select value={settings.targetEventTypeId ?? ""} onChange={event => setSettings({ ...settings, targetEventTypeId: event.target.value || null })}><option value="">This event type</option>{targets.filter(target => target.status === "published" && target.id !== eventId).map(target => <option key={target.id} value={target.id}>{target.title}</option>)}</Select></label> : null}
    <label className="flex items-start gap-3 text-sm font-semibold"><input type="checkbox" className="mt-1 h-[18px] w-[18px] shrink-0" checked={settings.attendedOnly} onChange={event => setSettings({ ...settings, attendedOnly: event.target.checked })} />Only when marked attended</label>
    <p className="text-sm text-soft">With attendance required, an unmarked or no-show booking sends nothing. Marking it attended after the offset allows one send on the next scheduled pass. Canceled and erased bookings send nothing. Balance-payment links are not available.</p>
    <Button type="submit" className="w-fit">{working ? "Saving…" : "Save follow-up settings"}</Button></fieldset>{error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}{notice ? <p role="status" className={noticeClassName("success")}>{notice}</p> : null}</form></Card>;
}
