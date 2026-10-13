import { embedSnippet } from "../snippet";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { readProfile } from "../../host-profile";
import { Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";

type EventSummary = { slug: string; title: string; status: string };

export function EmbedSettingsCard({ publicOrigin }: { publicOrigin: string }) {
  const [origins, setOrigins] = useState<string[]>([]);
  const [events, setEvents] = useState<EventSummary[]>();
  const [handle, setHandle] = useState("");
  const [slug, setSlug] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.api.app["embed-settings"].$get({}),
      api.api.app["event-types"].$get({}),
      api.api.app.profile.$get({}),
    ]).then(async ([settingsResponse, eventsResponse, profileResponse]) => {
      if (!settingsResponse.ok || !eventsResponse.ok) throw new Error(await errorMessage(!settingsResponse.ok ? settingsResponse : eventsResponse));
      setOrigins((await settingsResponse.json()).allowedOrigins);
      if (eventsResponse.ok) {
        const next = await eventsResponse.json() as EventSummary[];
        setEvents(next);
        setSlug((current) => current || next.find((event) => event.status === "published")?.slug || "");
      }
      const profile = await readProfile(profileResponse);
      setHandle(profile?.handle ?? "");
    }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Embed settings could not be loaded. Refresh to try again."));
  }, []);

  async function saveOrigins() {
    setSaving(true); setNotice("");
    const response = await api.api.app["embed-settings"].$put({ json: { allowedOrigins: origins.filter((origin) => origin.trim()) } });
    setSaving(false);
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    setOrigins((await response.json()).allowedOrigins);
    setNotice("Allowed origins saved.");
  }

  async function copy(mode: "inline" | "modal") {
    if (!handle || !slug) { setNotice("Configure the host handle and choose an event type first."); return; }
    if (!events?.some((event) => event.slug === slug && event.status === "published")) { setNotice("Only published event types can be embedded."); return; }
    if (!origins.length) { setNotice("Add an allowed origin before copying an embed."); return; }
    const snippet = embedSnippet(publicOrigin, handle, slug, mode);
    try { await navigator.clipboard.writeText(snippet); setNotice(`${mode === "inline" ? "Inline" : "Modal"} embed copied.`); } catch { setNotice("The embed could not be copied. Select and copy the snippet manually."); }
  }

  const publishedEvents = events?.filter((event) => event.status === "published") ?? [];
  return <Card id="embed-settings" className="p-5 sm:p-6 xl:col-span-2"><div><SectionHeading icon="code" title="Origin-gated embeds" /><p className="mt-3 text-sm leading-6 text-soft">Only the exact origins below may frame Dial. Wildcards, paths, and arbitrary domains are refused.</p></div><div className="mt-5 grid gap-3">{origins.map((origin, index) => <div className="flex gap-2" key={`${origin}-${index}`}><Input aria-label={`Allowed origin ${index + 1}`} value={origin} onChange={(event) => setOrigins((current) => current.map((entry, position) => position === index ? event.target.value : entry))} placeholder="https://example.com" /><Button type="button" variant="secondary" onClick={() => setOrigins((current) => current.filter((_, position) => position !== index))}>Remove</Button></div>)}</div><div className="mt-4 flex flex-wrap gap-3"><Button type="button" variant="secondary" onClick={() => setOrigins((current) => [...current, ""])}>Add origin</Button><Button type="button" onClick={() => void saveOrigins()} disabled={saving}>{saving ? "Saving…" : "Save origins"}</Button></div><div className="mt-7 grid gap-4 border-t border-line-soft pt-6 lg:grid-cols-[minmax(0,1fr)_auto_auto]"><label className="grid gap-2 text-sm font-[650] text-ink">Published event type<Select value={slug} onChange={(event) => setSlug(event.target.value)} disabled={!publishedEvents.length}><option value="">{publishedEvents.length ? "Choose an event type" : "Publish an event type first"}</option>{publishedEvents.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</Select></label><Button type="button" variant="secondary" className="self-end" onClick={() => void copy("inline")} disabled={!handle || !slug || !publishedEvents.length}>Copy inline tag</Button><Button type="button" className="self-end" onClick={() => void copy("modal")} disabled={!handle || !slug || !publishedEvents.length}>Copy modal tag</Button></div>{!publishedEvents.length && events ? <p className="mt-4 text-sm text-muted">Publish an event type after Calendar and mail are healthy to generate an embed.</p> : null}{notice ? <p className={noticeClassName("success", "mt-4 font-semibold")} role="status">{notice}</p> : null}</Card>;
}
