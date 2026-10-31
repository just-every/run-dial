import { useEffect, useState } from "react";
import { api } from "../../../api/client";

export type GoogleSetup = { redirectUri: string; configured: boolean };

/** Only public configuration leaves the Worker; credentials stay in encrypted bindings. */
export function useGoogleSetup() {
  const [setup, setSetup] = useState<GoogleSetup>();
  useEffect(() => { void api.api.app.calendar.setup.$get().then(async (response) => {
    if (response.ok) setSetup(await response.json());
  }).catch(() => { /* The guide remains useful while the deployment information is unavailable. */ }); }, []);
  return setup;
}

export function GoogleSetupGuide({ setup }: { setup?: GoogleSetup }) {
  return <details className="mt-5 rounded-2xl bg-row px-4 py-3.5 text-sm leading-6 text-soft">
    <summary className="cursor-pointer text-[15px] font-bold text-ink">Set up Google Calendar for this installation</summary>
    <ol className="mt-3 list-decimal space-y-3 pl-5">
      <li>In your own Google Cloud project, enable <strong>Google Calendar API</strong> under APIs &amp; Services → Library.</li>
      <li>Open <strong>Google Auth platform → Branding</strong>. Enter the app name, support email, and developer contact email. Complete the requested app details.</li>
      <li>Under <strong>Audience</strong>, choose <strong>External</strong> and keep the publishing status <strong>Testing</strong>. Under <strong>Test users</strong>, add the Google account that owns the calendar you will connect.</li>
      <li>Under <strong>Data Access → Add or remove scopes</strong>, add <code className="break-all">https://www.googleapis.com/auth/calendar</code>. Dial uses this scope to read conflicts and create, update, and cancel calendar events and Google Meet conferences.</li>
      <li>Under <strong>Clients → Create client</strong>, choose <strong>Web application</strong>. Add this exact <strong>Authorized redirect URI</strong>:
        {setup ? <code className="mt-2 block break-all rounded-lg bg-card p-2 font-mono text-ink">{setup.redirectUri}</code> : <p role="status">Deployment URL unavailable. Reload settings to obtain the exact redirect URI.</p>}
        This value comes from the Worker’s canonical APP_URL plus <code>/api/calendar/oauth/callback</code>. Each installation or changed APP_URL needs its own exact authorized URI.</li>
      <li>Copy the client’s <strong>Client ID</strong> and <strong>Client secret</strong>. In Cloudflare → Workers &amp; Pages → this Worker → Settings → Variables and Secrets, paste them into encrypted <strong>Secret</strong> bindings named <code>GOOGLE_OAUTH_CLIENT_ID</code> and <code>GOOGLE_OAUTH_CLIENT_SECRET</code>. Add a separate random secret of at least 32 characters as <code>CALENDAR_WEBHOOK_SECRET</code>. Save and deploy those bindings. Dial reads these names directly; never put secrets in source files or ordinary text variables.</li>
      <li>Return here, connect Google Calendar using the test user account, select one writable destination and at least one conflict calendar, then save and check the connection. A Google Meet event type requires a destination that supports Meet.</li>
    </ol>
    <p className="mt-3">External apps in Testing using Calendar access receive refresh tokens that expire after seven days. Reconnect when access expires; complete Google’s production consent and verification requirements before relying on long-lived access.</p>
    {setup ? <p className="mt-3 font-semibold">{setup.configured ? "Required Google bindings are present. Connect and check the account to verify access." : "Required Google bindings are missing. Add all three secrets before connecting."}</p> : null}
    <p className="mt-3"><a className="font-semibold text-ink underline" href="https://developers.google.com/workspace/guides/configure-oauth-consent" target="_blank" rel="noreferrer">Google consent setup</a> · <a className="font-semibold text-ink underline" href="https://developers.google.com/identity/protocols/oauth2/web-server" target="_blank" rel="noreferrer">Google web application OAuth</a></p>
  </details>;
}
