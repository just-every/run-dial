import { useDocumentInstant } from "../../../app/document-data";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { readProfile } from "../../host-profile";
import { mailConnectionMessage } from "../../../platform/mail/connection-message";
import { ExtensionContribution } from "../../../app/extensions";
import { operatorTimestamp } from "../../../shared/operator-format";
import { CalendarHealthHistory } from "./calendar-health-history";
import type { CalendarHealthChange } from "../../calendar-connection";
import { MailTracking } from "./mail-tracking";
import { GoogleSetupGuide, useGoogleSetup } from "./google-setup-guide";
import { OperatorAccessCard } from "./operator-access";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../../api/client";
import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Badge, Button, Card, Select, noticeClassName } from "../../../app/ui/primitives";
import { MiniDial } from "../../../shared/drawing/MiniDial";

type Session = { operator: { email: string; expiresAt: string } };
type CalendarHealth = { recentChanges: CalendarHealthChange[]; provider: "google_calendar"; state: "healthy" | "unhealthy" | "disconnected"; checkedAt: string | null; reason: string | null; destinationSelected: boolean; destinationCalendarId: string | null; conflictCalendarIds: string[]; conflictCalendarCount: number; conferenceCapable: boolean };
type Calendar = { id: string; accessRole: "freeBusyReader" | "reader" | "writer" | "owner" | "none"; primary: boolean; conferenceCapable: boolean };
type MailHealth = { state: "healthy" | "unhealthy" | "unchecked"; checkedAt: string | null; reason: string | null; provider: "sendgrid" | "resend" | "rer" | "development"; eventTracking: "on" | "off" | "not_applicable" };

export function SettingsPage({ embedSettings, blockingSettings, mailPreferences, privacySettings, paymentSettings }: { embedSettings?: ReactNode; blockingSettings?: ReactNode; mailPreferences?: ReactNode; privacySettings?: ReactNode; paymentSettings?: (timezone: string | null) => ReactNode }) {
  const initialSession = useWorkspaceRead<Session>("/api/app/session");
  const initialCalendar = useWorkspaceRead<CalendarHealth>("/api/app/calendar/connection");
  const initialMail = useWorkspaceRead<MailHealth>("/api/app/mail/connection");
  const initialProfile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const [session, setSession] = useState<Session | undefined>(initialSession);
  const [timezone, setTimezone] = useState<string | null>(initialProfile?.timezone ?? null);
  const [calendar, setCalendar] = useState<CalendarHealth | undefined>(initialCalendar);
  const [mail, setMail] = useState<MailHealth | undefined>(initialMail);
  const [calendars, setCalendars] = useState<Calendar[]>();
  const [destination, setDestination] = useState("");
  const [conflicts, setConflicts] = useState<string[]>([]);
  const selectionInitialized = useRef(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<"calendar" | "mail" | "selection" | "disconnect">();

  const load = async (resetSelection = false) => {
    try {
      const [sessionResponse, calendarResponse, mailResponse, profileResponse] = await Promise.all([api.api.app.session.$get(), api.api.app.calendar.connection.$get(), api.api.app.mail.connection.$get(), api.api.app.profile.$get()]);
      setTimezone((await readProfile(profileResponse))?.timezone || null);
      if (sessionResponse.ok) setSession(await sessionResponse.json()); else setError(await errorMessage(sessionResponse));
      if (calendarResponse.ok) {
        const health = await calendarResponse.json() as CalendarHealth;
        setCalendar(health);
        if (resetSelection || !selectionInitialized.current) {
          setDestination(health.destinationCalendarId || ""); setConflicts(health.conflictCalendarIds);
          selectionInitialized.current = true;
        }
      } else setError(await errorMessage(calendarResponse));
      if (mailResponse.ok) setMail(await mailResponse.json() as MailHealth); else setError(await errorMessage(mailResponse));
    } catch { setError("Settings could not be loaded. Reload to check the current connections."); }
  };
  const loadCalendars = async () => {
    try {
      const response = await api.api.app.calendar.calendars.$get();
      if (!response.ok) { setError(await errorMessage(response)); return; }
      const next = (await response.json() as { calendars: Calendar[] }).calendars;
      setCalendars(next);

    } catch { setError("Calendars could not be loaded. Reload to try again."); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (calendar && calendar.state !== "disconnected") void loadCalendars(); }, [calendar?.state]);

  async function perform(kind: NonNullable<typeof working>, request: () => Promise<{ ok: boolean; json(): Promise<unknown> }>, success: string) {
    if (working) return;
    setWorking(kind); setNotice(""); setError("");
    try {
      const response = await request();
      if (!response.ok) { setError(await errorMessage(response)); await load(); return; }
      if (kind === "disconnect") { setCalendars(undefined); setDestination(""); setConflicts([]); }
      setNotice(success); await load(kind === "selection" || kind === "disconnect");
    } catch { setError("The result could not be received. Reload settings to check the current state before retrying."); }
    finally { setWorking(undefined); }
  }
  function checkCalendar() { return perform("calendar", () => api.api.app.calendar.check.$post(), "Calendar check passed."); }
  function checkMail() { return perform("mail", () => api.api.app.mail.check.$post(), "Mail sender verified."); }
  function disconnectCalendar() { return perform("disconnect", () => api.api.app.calendar.connection.$delete(), "Google Calendar disconnected."); }
  async function saveSelection() {
    if (!destination || conflicts.length === 0) { setError("Choose one writable destination and at least one conflict calendar."); return; }
    await perform("selection", () => api.api.app.calendar.selection.$put({ json: { destinationCalendarId: destination, conflictCalendarIds: conflicts } }), "Calendar selection saved. Check the connection to verify it.");
  }

  return <div className="grid gap-7"><PageHeader title="Settings" description={session?.operator.email ?? "Provider connections"} art={<MiniDial size={72} />} /><p className="text-sm text-soft">Connection times are shown in {timezone ?? "UTC"}.</p>{error && session ? <p role="alert" className={noticeClassName("error", "font-semibold")}>{error} <button type="button" className="underline" disabled={Boolean(working)} onClick={() => { setError(""); return load(true); }}>Reload settings</button></p> : null}{notice ? <p role="status" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}{!session ? <WorkspaceLoadState error={error} label="Loading settings…" onRetry={() => { setError(""); return load(true); }} /> : <div className="grid gap-5 xl:grid-cols-2"><MailConnection timezone={timezone} health={mail} working={working === "mail"} onCheck={checkMail} /><CalendarConnection timezone={timezone} health={calendar} calendars={calendars} destination={destination} conflicts={conflicts} working={working} onConnect={() => window.location.assign("/api/app/calendar/oauth/start")} onLoad={() => void loadCalendars()} onDestination={(id) => { selectionInitialized.current = true; setDestination(id); }} onToggleConflict={(id) => { selectionInitialized.current = true; setConflicts((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]); }} onSave={saveSelection} onCheck={checkCalendar} onDisconnect={disconnectCalendar} />{paymentSettings?.(timezone)}<OperatorAccessCard />{privacySettings}{mailPreferences}{blockingSettings}{embedSettings}<ExtensionContribution id="operator.settings-section.v1" /></div>}</div>;
}

function MailConnection({ health, working, onCheck, timezone }: { timezone: string | null; health?: MailHealth; working: boolean; onCheck: () => void }) { return <Card id="mail-connection" className="p-5 sm:p-6"><SectionHeading icon="mail" title="Transactional mail" action={<HealthBadge state={health?.state} />} /><p className="mt-3 text-sm leading-6 text-soft">Booking notices, magic links, and request acknowledgements use the configured transactional mail provider (RER Managed mail, SendGrid or Resend).</p><ConnectionFacts timezone={timezone} checkedAt={health?.checkedAt} reason={mailConnectionMessage(health?.reason)} /><MailTracking health={health} /><Button className="mt-5" type="button" onClick={onCheck} disabled={working}>{working ? "Checking sender…" : "Check sender"}</Button></Card>; }

function CalendarConnection({ timezone, health, calendars, destination, conflicts, working, onConnect, onLoad, onDestination, onToggleConflict, onSave, onCheck, onDisconnect }: { timezone: string | null; health?: CalendarHealth; calendars?: Calendar[]; destination: string; conflicts: string[]; working: "calendar" | "mail" | "selection" | "disconnect" | undefined; onConnect: () => void; onLoad: () => void; onDestination: (id: string) => void; onToggleConflict: (id: string) => void; onSave: () => void; onCheck: () => void; onDisconnect: () => void }) {
  const connected = Boolean(health && health.state !== "disconnected");
  const setup = useGoogleSetup(), unconfigured = setup?.configured === false;
  return <Card id="calendar-connection" className="min-w-0 p-5 sm:p-6 xl:col-span-2"><SectionHeading icon="calendar" title="Google Calendar" action={<HealthBadge state={health?.state} />} /><p className="mt-3 max-w-2xl text-sm leading-6 text-soft">{connected ? "Dial reads every selected conflict calendar before offering a time, then writes confirmed bookings to the destination calendar." : "Dial checks saved availability and existing Dial bookings. External calendar conflicts are not checked until you connect a calendar. Publishing an event with a fixed location turns on bookings using these checks."}</p><ConnectionFacts timezone={timezone} checkedAt={health?.checkedAt} reason={health?.reason} />{unconfigured ? <p className="mt-4 text-sm font-semibold text-ink">Google Calendar is not set up for this installation.</p> : null}<GoogleSetupGuide setup={setup} />{connected ? <div className="mt-5 grid min-w-0 gap-5 border-t border-line-soft pt-5 lg:grid-cols-2"><label className="grid min-w-0 gap-2 text-sm font-[650] text-ink">Destination calendar<Select value={destination} onChange={(event) => onDestination(event.target.value)} className="min-w-0 max-w-full"><option value="">Choose destination calendar</option>{calendars?.filter((entry) => entry.accessRole === "owner" || entry.accessRole === "writer").map((entry) => <option key={entry.id} value={entry.id}>{calendarLabel(entry)}{entry.conferenceCapable ? " · Meet enabled" : ""}</option>)}</Select></label><fieldset className="min-w-0"><legend className="text-sm font-[650] text-ink">Conflict calendars</legend><p className="mt-1 text-sm text-soft">Every checked calendar is read for conflicts.</p><div className="mt-3 grid min-w-0 gap-2">{calendars?.filter((entry) => entry.accessRole !== "none").map((entry) => <label key={entry.id} className="flex min-w-0 items-start gap-3 rounded-xl bg-row px-3 py-2.5 text-sm"><input className="mt-0.5 h-[18px] w-[18px] shrink-0" type="checkbox" checked={conflicts.includes(entry.id)} onChange={() => onToggleConflict(entry.id)} /><span className="min-w-0 flex-1 break-all">{calendarLabel(entry)}</span><span className="ml-auto shrink-0 text-[13px] text-muted">{entry.accessRole}</span></label>) ?? <p className="text-sm text-soft">Load calendars to choose the read set.</p>}</div></fieldset></div> : unconfigured ? null : <p className="mt-5 text-sm leading-6 text-soft">Connect the Google account that owns the calendar you schedule from. Dial will ask you to choose the destination and the calendars that block availability.</p>}<div className="mt-5 flex min-w-0 flex-wrap gap-3">{!connected ? <Button className="min-w-0 max-w-full" type="button" onClick={onConnect} disabled={!health || !setup?.configured || Boolean(working)}>Connect Google Calendar</Button> : <><Button className="min-w-0 max-w-full" variant="secondary" type="button" onClick={onLoad} disabled={Boolean(working)}>Reload calendars</Button><Button className="min-w-0 max-w-full" type="button" onClick={onSave} disabled={Boolean(working)}>{working === "selection" ? "Saving selection…" : "Save calendar selection"}</Button><Button className="min-w-0 max-w-full" variant="secondary" type="button" onClick={onCheck} disabled={Boolean(working)}>{working === "calendar" ? "Checking calendar…" : "Check connection"}</Button><Button className="min-w-0 max-w-full" variant="danger" type="button" onClick={onDisconnect} disabled={Boolean(working)}>{working === "disconnect" ? "Disconnecting…" : "Disconnect"}</Button></>}</div><CalendarHealthHistory changes={health?.recentChanges ?? []} timezone={timezone} /></Card>;
}

function HealthBadge({ state }: { state?: "healthy" | "unhealthy" | "disconnected" | "unchecked" }) { return <Badge tone={state === "healthy" ? "success" : "warning"}>{state === "healthy" ? "Healthy" : state === "unhealthy" ? "Needs attention" : state === "unchecked" ? "Not yet checked" : "Not connected"}</Badge>; }
function ConnectionFacts({ checkedAt, reason, timezone }: { timezone: string | null; checkedAt?: string | null; reason?: string | null }) { const referenceInstant = useDocumentInstant(); return <div className="mt-4 text-sm leading-6 text-ink">{reason ? <p>Status: {reason.replaceAll("_", " ")}.</p> : null}<p>{checkedAt ? `Last checked ${operatorTimestamp(checkedAt, timezone ?? "UTC", referenceInstant)}.` : "Not yet checked."}</p></div>; }

function calendarLabel(calendar: Calendar) { return calendar.primary ? `${calendar.id} (primary)` : calendar.id; }
