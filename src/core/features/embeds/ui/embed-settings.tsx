import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { readProfile } from "../../host-profile";
import { embedSnippet } from "../snippet";
import { EmbedWebsites, type EmbedMode } from "./embed-websites";

type EventSummary = { id: string; slug: string; title: string; status: string };

export function EmbedSettingsCard({ publicOrigin }: { publicOrigin: string }) {
  const [origins, setOrigins] = useState<string[]>([]);
  const [events, setEvents] = useState<EventSummary[]>();
  const [handle, setHandle] = useState("");
  const [slug, setSlug] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copyMode, setCopyMode] = useState<EmbedMode>();
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.api.app["embed-settings"].$get({}),
      api.api.app["event-types"].$get({}),
      api.api.app.profile.$get({}),
    ]).then(async ([settingsResponse, eventsResponse, profileResponse]) => {
      if (!settingsResponse.ok || !eventsResponse.ok) throw new Error(await errorMessage(!settingsResponse.ok ? settingsResponse : eventsResponse));
      const [settings, next, profile] = await Promise.all([
        settingsResponse.json(), eventsResponse.json() as Promise<EventSummary[]>, readProfile(profileResponse),
      ]);
      if (!active) return;
      const requestedEvent = new URLSearchParams(window.location.search).get("event");
      const published = next.filter(event => event.status === "published");
      setOrigins(settings.allowedOrigins);
      setEvents(next);
      setSlug((requestedEvent ? published.find(event => event.id === requestedEvent) : published[0])?.slug ?? "");
      setHandle(profile?.handle ?? "");
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Embed settings could not be loaded. Refresh to try again."); });
    return () => { active = false; };
  }, []);

  async function writeCode(mode: EmbedMode) {
    try {
      await navigator.clipboard.writeText(embedSnippet(publicOrigin, handle, slug, mode));
      setNotice(`${mode === "inline" ? "Inline" : "Popup"} embed copied.`);
    } catch { setError("The embed could not be copied. Allow clipboard access and try Copy again."); }
  }

  async function saveOrigins(next: string[], mode?: EmbedMode) {
    if (inFlight.current) return false;
    inFlight.current = true; setSaving(true); setNotice(""); setError("");
    try {
      const response = await api.api.app["embed-settings"].$put({ json: { allowedOrigins: next } });
      if (!response.ok) { setError(await errorMessage(response)); return false; }
      setOrigins((await response.json()).allowedOrigins);
      setCopyMode(undefined);
      if (mode) await writeCode(mode);
      else setNotice("Websites updated.");
      return true;
    } catch { setError("The website change could not be checked. Your address is kept here; try again."); return false; }
    finally { inFlight.current = false; setSaving(false); }
  }

  async function copy(mode: EmbedMode) {
    if (inFlight.current) return;
    setNotice(""); setError("");
    if (!handle || !events?.some(event => event.slug === slug && event.status === "published")) {
      setError("Complete your profile and publish an event before copying its embed."); return;
    }
    if (!origins.length) { setCopyMode(mode); return; }
    inFlight.current = true; setSaving(true);
    try { await writeCode(mode); }
    finally { inFlight.current = false; setSaving(false); }
  }

  const publishedEvents = events?.filter(event => event.status === "published") ?? [];
  const copyDisabled = saving || !handle || !slug || !publishedEvents.length;
  return <Card id="embed-settings" className="p-5 sm:p-6 xl:col-span-2">
    <SectionHeading icon="code" title="Embed" description="Let visitors book on your website." />
    {!events ? <WorkspaceLoadState error={error} label="Loading embed settings…" /> : null}
    <div className="mt-5 grid gap-4">
      <label className="grid gap-2 text-sm font-[650] text-ink">Event
        <Select value={slug} onChange={event => setSlug(event.target.value)} disabled={saving || !publishedEvents.length}>
          <option value="">{publishedEvents.length ? "Choose an event" : "Publish an event first"}</option>
          {publishedEvents.map(event => <option key={event.id} value={event.slug}>{event.title}</option>)}
        </Select>
      </label>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={() => void copy("inline")} disabled={copyDisabled}>Copy inline code</Button>
        <Button type="button" onClick={() => void copy("modal")} disabled={copyDisabled}>Copy popup code</Button>
      </div>
    </div>
    <EmbedWebsites origins={origins} disabled={saving || !events} copyMode={copyMode} onCancelCopy={() => setCopyMode(undefined)} onSave={saveOrigins} />
    {!publishedEvents.length && events ? <p className="mt-4 text-sm text-muted">Publish an event to copy its embed code.</p> : null}
    {error && events ? <p className={noticeClassName("error", "mt-4")} role="alert">{error}</p> : null}
    {notice ? <p className={noticeClassName("success", "mt-4")} role="status">{notice}</p> : null}
  </Card>;
}
