import { useEffect, useState } from "react";
import { api } from "../../../api/client";

export function MicrosoftSetupGuide() {
  const [setup, setSetup] = useState<{ redirectUri: string; microsoft: { configured: boolean; missing: (string | null)[] } }>();
  useEffect(() => { void api.api.app.calendar.setup.$get().then(async response => { if (response.ok) setSetup(await response.json()); }); }, []);
  return <details className="mt-5 rounded-2xl bg-row px-4 py-3.5 text-sm leading-6 text-soft">
    <summary className="cursor-pointer text-[15px] font-bold text-ink">Set up Microsoft 365 or Outlook</summary>
    <p className="mt-3">Register a web application in Microsoft Entra supporting organizational directories and personal Microsoft accounts. Add this redirect URI:</p>
    {setup ? <code className="mt-2 block break-all rounded-lg bg-card p-2 font-mono text-ink">{setup.redirectUri}</code> : <p role="status">Loading deployment configuration…</p>}
    <p className="mt-3">Configure MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET as Worker secrets, and CALENDAR_WEBHOOK_SECRET with at least 32 characters. Delegated permissions are offline_access, Calendars.ReadWrite, OnlineMeetings.ReadWrite and User.Read. Your organization may require its administrator to approve these permissions in Entra.</p>
    <p className="mt-3">Dial connects one account per installation. Reconnecting replaces the current Google or Microsoft account and keeps calendar selections for you to check. Select calendars again when changing providers. Simultaneous accounts and organization-wide consent management are not available.</p>
    {setup ? <p className="mt-3 font-semibold">{setup.microsoft.configured ? "Microsoft bindings are present. Connect and check the account to verify access." : `Missing configuration: ${setup.microsoft.missing.join(", ")}.`}</p> : null}
  </details>;
}
