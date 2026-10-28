import { useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Card, Input, noticeClassName } from "../../../app/ui/primitives";
import { SectionHeading } from "../../../app/ui/page-header";
import { errorMessage } from "../../../api/client";

type Tags = { ga4MeasurementId?: string; gtmContainerId?: string; metaPixelId?: string; googleAds?: { conversionId: string; conversionLabel: string }; linkedInPartnerId?: string };
type Connections = Record<"google_ads" | "linkedin", { connected: boolean; customerId?: string; conversionAction?: string; conversionId?: string; reason?: string }>;
const emptyFields = { ga4MeasurementId: "", gtmContainerId: "", metaPixelId: "", googleAdsId: "", googleAdsLabel: "", linkedInPartnerId: "" };
type Fields = typeof emptyFields;
const fields: Array<[keyof Fields, string, string]> = [["ga4MeasurementId", "GA4 measurement ID", "G-…"], ["gtmContainerId", "GTM container ID", "GTM-…"], ["metaPixelId", "Meta Pixel ID", "Numeric pixel ID"], ["googleAdsId", "Google Ads conversion tag", "AW-…"], ["googleAdsLabel", "Google Ads conversion label", "Conversion label"], ["linkedInPartnerId", "LinkedIn Insight partner ID", "Numeric partner ID"]];
const toFields = (tags: Tags): Fields => ({ ...emptyFields, ...tags, googleAdsId: tags.googleAds?.conversionId ?? "", googleAdsLabel: tags.googleAds?.conversionLabel ?? "" });
const toTags = (values: Fields): Tags => ({ ...Object.fromEntries((["ga4MeasurementId", "gtmContainerId", "metaPixelId", "linkedInPartnerId"] as const).flatMap(key => values[key].trim() ? [[key, values[key].trim()]] : [])), ...(values.googleAdsId.trim() || values.googleAdsLabel.trim() ? { googleAds: { conversionId: values.googleAdsId.trim(), conversionLabel: values.googleAdsLabel.trim() } } : {}) });

async function request(path: string, body?: unknown, method = body === undefined ? "GET" : "PUT") {
  const response = await fetch(`/api/app/analytics${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.status === 204 ? undefined : response.json();
}

export function AnalyticsSettingsCard() {
  const [values, setValues] = useState<Fields>(), [connections, setConnections] = useState<Connections>(), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saving = useRef(false), pending = useRef<Fields | undefined>(undefined);
  const loadConnections = async () => setConnections(await request("/connections") as Connections);
  useEffect(() => { void Promise.all([request(""), request("/connections")]).then(([tags, accounts]) => { setValues(toFields(tags as Tags)); setConnections(accounts as Connections); }).catch(failure => setError(failure.message)); }, []);
  async function save(next: Fields) {
    if (Boolean(next.googleAdsId.trim()) !== Boolean(next.googleAdsLabel.trim())) { setNotice("Enter both the Google Ads tag and conversion label, or clear both to disable it."); return; }
    pending.current = next;
    if (saving.current) return;
    saving.current = true; setError(""); setNotice("Saving…");
    try {
      while (pending.current) {
        const snapshot = pending.current; pending.current = undefined;
        await request("", toTags(snapshot));
      }
      setNotice("Saved");
    } catch (failure) { setNotice(""); setError(failure instanceof Error ? failure.message : "Tracking settings could not be saved."); }
    finally { saving.current = false; }
  }
  return <Card id="analytics-settings" className="min-w-0 p-5 sm:p-6 xl:col-span-2"><SectionHeading icon="limits" title="Analytics and conversions" /><p className="mt-3 text-sm leading-6 text-soft">Measure visits, time selection and confirmed bookings on your booking pages. Leave a tag blank to keep it off. The invitee privacy notice explains these providers; embedded bookings report to the parent website.</p>
    {error ? <p role="alert" className={noticeClassName("error", "mt-4")}>{error}</p> : null}
    {values ? <><fieldset className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">Browser tags</legend>{fields.map(([key, label, placeholder]) => <label key={key} className="grid min-w-0 gap-2 text-sm font-semibold">{label}<Input value={values[key]} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={event => setValues({ ...values, [key]: event.target.value })} onBlur={() => void save(values)} /></label>)}</fieldset><p role="status" className="mt-3 min-h-6 text-sm text-soft">{notice}</p></> : <p className="mt-4 text-sm">{error ? "Reload Settings to try again." : "Loading tracking settings…"}</p>}
    <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">{(["google_ads", "linkedin"] as const).map(provider => <AdsConnection key={provider} provider={provider} status={connections?.[provider]} onChanged={loadConnections} />)}</div>
  </Card>;
}

function AdsConnection({ provider, status, onChanged }: { provider: "google_ads" | "linkedin"; status?: Connections["google_ads"]; onChanged(): Promise<void> }) {
  const google = provider === "google_ads", label = google ? "Google Ads" : "LinkedIn Ads";
  const [accessToken, setAccessToken] = useState(""), [developerToken, setDeveloperToken] = useState(""), [customerId, setCustomerId] = useState(""), [conversionAction, setConversionAction] = useState(""), [loginCustomerId, setLoginCustomerId] = useState(""), [conversionId, setConversionId] = useState(""), [working, setWorking] = useState(false), [error, setError] = useState("");
  async function connect(event: FormEvent) {
    event.preventDefault(); setWorking(true); setError("");
    try {
      await request(`/connections/${provider}`, google ? { accessToken, developerToken, customerId, conversionAction, ...(loginCustomerId ? { loginCustomerId } : {}) } : { accessToken, conversionId });
      setAccessToken(""); setDeveloperToken(""); await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Account connection failed."); }
    finally { setWorking(false); }
  }
  async function disconnect() {
    setWorking(true); setError("");
    try { await request(`/connections/${provider}`, undefined, "DELETE"); await onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Account disconnection failed."); }
    finally { setWorking(false); }
  }
  return <details className="min-w-0 rounded-2xl border border-line p-4"><summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 text-[15px] font-semibold">{label} conversions <Badge tone={status?.connected ? "success" : "neutral"}>{status?.connected ? "Connected" : "Not connected"}</Badge></summary><p className="mt-3 text-sm leading-6 text-soft">Connect an authorized account token and its booking conversion destination. Dial uploads only the matching click ID and a booking conversion reference and time. Disconnecting cancels pending uploads.</p>{status?.reason ? <p role="status" className="mt-3 text-sm">{status.reason.replaceAll("_", " ")}</p> : null}
    {status?.connected ? <div className="mt-3 grid gap-3"><p className="break-all text-sm">{status.customerId ?? status.conversionId}</p><Button type="button" variant="secondary" disabled={working} onClick={() => void disconnect()}>Disconnect {label}</Button></div> : null}
    <form aria-label={`Connect ${label} conversions`} onSubmit={event => void connect(event)} className="mt-4 grid min-w-0 gap-3"><label className="grid gap-2 text-sm font-semibold">{label} access token<Input type="password" autoComplete="off" required value={accessToken} onChange={event => setAccessToken(event.target.value)} /></label>
      {google ? <><label className="grid gap-2 text-sm font-semibold">Google Ads developer token<Input type="password" autoComplete="off" required value={developerToken} onChange={event => setDeveloperToken(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold">Google Ads customer ID<Input inputMode="numeric" required value={customerId} onChange={event => setCustomerId(event.target.value)} /></label><label className="grid gap-2 text-sm font-semibold">Google Ads conversion action<Input required value={conversionAction} onChange={event => setConversionAction(event.target.value)} placeholder="Full conversion action resource name" /></label><label className="grid gap-2 text-sm font-semibold">Google Ads manager customer ID (optional)<Input inputMode="numeric" value={loginCustomerId} onChange={event => setLoginCustomerId(event.target.value)} /></label></> : <label className="grid gap-2 text-sm font-semibold">LinkedIn conversion ID<Input inputMode="numeric" required value={conversionId} onChange={event => setConversionId(event.target.value)} /></label>}
      {error ? <p role="alert" className={noticeClassName("error")}>{error}</p> : null}<Button type="submit" disabled={working || !status}>{working ? "Connecting…" : status?.connected ? `Replace ${label} connection` : `Connect ${label}`}</Button>
    </form></details>;
}
