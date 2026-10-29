import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { errorMessage } from "../../../api/client";
import { SectionHeading } from "../../../app/ui/page-header";
import { Badge, Button, Card, Input, Select, noticeClassName } from "../../../app/ui/primitives";

const subscriptionSchema = z.object({
  id: z.string(), endpoint: z.string(), events: z.array(z.string()),
  scope: z.enum(["workspace", "host", "team"]), scopeId: z.string().nullable(), createdAt: z.string(),
});
const deliverySchema = z.object({
  id: z.string(), eventId: z.string(), eventType: z.string(), subscriptionId: z.string(),
  state: z.enum(["pending", "sending", "delivered", "failed"]), responseCode: z.number().nullable(),
  attempts: z.number(), nextAttemptAt: z.string(), createdAt: z.string(),
});
const settingsSchema = z.object({
  subscriptions: z.array(subscriptionSchema), deliveries: z.array(deliverySchema),
  eventTypes: z.array(z.string()), hostId: z.string(), teams: z.array(z.object({ id: z.string(), name: z.string() })),
});
type Settings = z.infer<typeof settingsSchema>;

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(await errorMessage(response));
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Dial returned an unexpected webhook response. Reload to check the result.");
  return parsed.data;
}

function eventLabel(value: string) {
  const words = value.replace(/\.v\d+$/, "").replace(/[._-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function WebhookSettingsCard() {
  const [settings, setSettings] = useState<Settings>();
  const [endpoint, setEndpoint] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [scope, setScope] = useState<"workspace" | "host" | "team">("workspace");
  const [teamId, setTeamId] = useState("");
  const [consent, setConsent] = useState(false);
  const [secret, setSecret] = useState<{ id: string; secret: string }>();
  const [showForm, setShowForm] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void request("/api/app/webhooks", settingsSchema, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setSettings(value); setShowForm(!value.subscriptions.length); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Webhooks could not be loaded."); });
    return () => controller.abort();
  }, []);

  async function action(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The result could not be checked. Reload webhooks before trying again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function reload(deliveries = false) {
    await action(async () => {
      const value = await request("/api/app/webhooks", settingsSchema);
      setSettings(value);
      if (!value.subscriptions.length) setShowForm(true);
      if (deliveries) setShowDeliveries(true);
    });
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!settings || secret || inFlight.current) return;
    try {
      const url = new URL(endpoint.trim());
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { setError("Enter an HTTPS endpoint without a username or password."); return; }
    if (!events.length || !consent) { setError("Choose at least one event and authorize delivery to this endpoint."); return; }
    if (scope === "team" && !settings.teams.some(team => team.id === teamId)) { setError("Choose an available team before creating this webhook."); return; }
    await action(async () => {
      const created = await request("/api/app/webhooks", z.object({ id: z.string(), secret: z.string() }), {
        method: "POST", headers: { "content-type": "application" + "/json" },
        body: JSON.stringify({ endpoint: endpoint.trim(), events, scope, scopeId: scope === "host" ? settings.hostId : scope === "team" ? teamId : null }),
      });
      setSecret(created); setEndpoint(""); setEvents([]); setConsent(false); setShowForm(false);
      setNotice("Webhook created. Store its signing secret before dismissing it.");
      setSettings(await request("/api/app/webhooks", settingsSchema));
    });
  }

  async function remove(id: string) {
    if (inFlight.current || !window.confirm("Delete this webhook and stop sending events to its endpoint?")) return;
    await action(async () => {
      await request(`/api/app/webhooks/${encodeURIComponent(id)}`, z.object({ deleted: z.literal(true) }), { method: "DELETE" });
      if (secret?.id === id) setSecret(undefined);
      setSettings(current => current ? { ...current, subscriptions: current.subscriptions.filter(item => item.id !== id) } : current);
      setNotice("Webhook deleted.");
      setSettings(await request("/api/app/webhooks", settingsSchema));
    });
  }

  async function redeliver(id: string) {
    await action(async () => {
      await request(`/api/app/webhook-deliveries/${encodeURIComponent(id)}/redeliver`, z.object({ queued: z.literal(true) }), { method: "POST" });
      setNotice("Delivery queued. Load deliveries again to check its outcome.");
      setSettings(await request("/api/app/webhooks", settingsSchema));
    });
  }

  return <Card id="webhook-settings" className="min-w-0 p-5 sm:p-6 xl:col-span-2">
    <SectionHeading title="Webhooks" description="Send selected events to an HTTPS endpoint you control." action={
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void reload()}>Reload webhooks</Button>
    } />
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-4")}>{notice}</p> : null}
    {!settings && !error ? <p role="status" className="mt-4 text-sm text-soft">Loading webhooks…</p> : null}
    {secret ? <div className="mt-5 grid min-w-0 gap-3 rounded-xl bg-gold-wash p-4" role="region" aria-label="New webhook signing secret">
      <h3 className="text-[15px] font-bold text-ink">Save your signing secret</h3>
      <p className="text-sm leading-6 text-soft">This secret is shown once. Store it securely in your receiving service.</p>
      <code className="block select-all break-all whitespace-pre-wrap text-[13px] text-ink">{secret.secret}</code>
      <div><Button type="button" variant="secondary" onClick={() => { setSecret(undefined); setNotice(""); }}>I stored the secret — dismiss</Button></div>
    </div> : null}
    {settings ? <>
      <ul className="mt-5 grid gap-3" aria-label="Webhook subscriptions">
        {settings.subscriptions.map(subscription => <li key={subscription.id} className="min-w-0 rounded-xl bg-row p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="break-all text-[15px] font-semibold text-ink">{subscription.endpoint}</h3>
              <p className="mt-1 text-sm text-soft">{subscription.scope === "workspace" ? "Workspace" : subscription.scope === "host" ? "Host" : `Team: ${settings.teams.find(team => team.id === subscription.scopeId)?.name ?? subscription.scopeId}`} · {subscription.events.map(eventLabel).join(", ")}</p>
            </div>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void remove(subscription.id)}>Delete webhook</Button>
          </div>
        </li>)}
      </ul>
      {!settings.subscriptions.length ? <p className="mt-4 text-sm text-soft">No webhooks yet. Choose which events to send below.</p> : null}
      {!showForm ? <Button type="button" variant="secondary" className="mt-4" disabled={busy || !!secret} onClick={() => setShowForm(true)}>Add webhook</Button> : <form className="mt-5 grid gap-4" aria-label="Create webhook" onSubmit={event => void create(event)}>
        <fieldset disabled={busy || !!secret} className="grid min-w-0 gap-4">
          <legend className="mb-3 text-[15px] font-bold text-ink">New webhook</legend>
          <label className="grid gap-2 text-sm font-semibold text-ink">HTTPS endpoint
            <Input type="url" required value={endpoint} placeholder="https://your-service.com/webhooks" onChange={event => { setEndpoint(event.target.value); setConsent(false); }} />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-ink">Send events from
            <Select value={scope} onChange={event => { setScope(event.target.value as "workspace" | "host" | "team"); setConsent(false); }}>
              <option value="workspace">Entire workspace</option><option value="host">Current host</option>
              <option value="team" disabled={!settings.teams.length}>Team</option>
            </Select>
          </label>
          {!settings.teams.length ? <p className="text-sm text-soft">Create a team before subscribing at team scope.</p> : null}
          {scope === "team" ? <label className="grid gap-2 text-sm font-semibold text-ink">Team
            <Select required value={teamId} onChange={event => { setTeamId(event.target.value); setConsent(false); }}>
              <option value="">Choose a team</option>
              {settings.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </Select>
          </label> : null}
          <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-semibold text-ink">Events</legend>
            {settings.eventTypes.map(type => <label key={type} className="flex min-h-11 items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-[18px] w-[18px] shrink-0 accent-ink" checked={events.includes(type)} onChange={event => { setEvents(current => event.target.checked ? [...current, type] : current.filter(item => item !== type)); setConsent(false); }} />
              {eventLabel(type)}
            </label>)}
            {!settings.eventTypes.length ? <p className="text-sm text-soft">No subscribable events are available.</p> : null}
          </fieldset>
          <label className="flex items-start gap-3 text-sm leading-6 text-ink">
            <input type="checkbox" required className="mt-1 h-[18px] w-[18px] shrink-0 accent-ink" checked={consent} onChange={event => setConsent(event.target.checked)} />
            I authorize Dial to send the selected events and their data to this endpoint.
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!endpoint.trim() || !events.length || !consent || (scope === "team" && !settings.teams.some(team => team.id === teamId))}>{busy ? "Creating…" : "Create webhook and send events"}</Button>
            {settings.subscriptions.length ? <Button type="button" variant="quiet" onClick={() => setShowForm(false)}>Cancel</Button> : null}
          </div>
        </fieldset>
      </form>}
      <details className="mt-5 text-sm leading-6 text-soft"><summary className="min-h-11 cursor-pointer font-semibold text-ink">Verify incoming events</summary>
        <p>Read the signature fields <code>t</code> and <code>v1</code>. Compute HMAC-SHA256 using your signing secret over the timestamp, a period, and the unchanged raw request body (<code>t + '.' + rawBody</code>), then compare it securely with <code>v1</code>. Reject timestamps outside a five-minute window. Deduplicate using the stable event ID; retries and manual redeliveries can repeat an event.</p>
      </details>
      <div className="mt-5">
        <SectionHeading title="Deliveries" action={<Button type="button" variant="secondary" disabled={busy} onClick={() => void reload(true)}>{busy ? "Working…" : showDeliveries ? "Refresh deliveries" : "Load deliveries"}</Button>} />
        {showDeliveries ? <ul className="mt-4 grid gap-3" aria-label="Webhook deliveries">
          {settings.deliveries.map(delivery => {
            const subscription = settings.subscriptions.find(item => item.id === delivery.subscriptionId);
            return <li key={delivery.id} className="min-w-0 rounded-xl bg-row p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-ink">{eventLabel(delivery.eventType)}</h3>
                <Badge tone={delivery.state === "delivered" ? "success" : delivery.state === "failed" ? "danger" : "neutral"}>{delivery.state}</Badge>
              </div>
              <p className="mt-2 break-all text-sm text-soft">{subscription?.endpoint ?? `Deleted webhook (${delivery.subscriptionId})`}</p>
              <p className="mt-1 text-sm text-soft">{delivery.responseCode === null ? "No HTTP response" : `HTTP ${delivery.responseCode}`} · {delivery.attempts} attempts</p>
              <p className="mt-1 break-all text-sm text-soft">Event ID: {delivery.eventId}</p>
              <p className="mt-1 text-sm text-soft">Created: {new Date(delivery.createdAt).toLocaleString()}</p>
              {delivery.state === "pending" || delivery.state === "failed" ? <p className="mt-1 text-sm text-soft">Next attempt: {new Date(delivery.nextAttemptAt).toLocaleString()}</p> : null}
              <Button type="button" variant="secondary" className="mt-3" disabled={busy || !subscription || delivery.state === "sending" || delivery.state === "pending"} onClick={() => void redeliver(delivery.id)}>Redeliver event</Button>
            </li>;
          })}
          {!settings.deliveries.length ? <li className="text-sm text-soft">No deliveries recorded.</li> : null}
        </ul> : null}
      </div>
    </> : null}
  </Card>;
}
