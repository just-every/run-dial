import { useDocumentData } from "../../../app/document-data";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHydrated } from "../../../app/use-hydrated";
import { api, errorMessage, publicApi } from "../../../api/client";
import { PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import { PublicEventEntry } from "./event-entry";
import { seedEvent } from "./document-seeds";
import type { PublicEventPayload } from "./types";
export { BookingConfirmationPage } from "./confirmation-page";
export { ManageBookingPage } from "./manage-page";
export { BookingDetailsPage } from "./booking-details-page";
export type { BookingDetailsCapability, PublicSelection } from "./selection-types";

export function PublicEventPage(props: { handle: string; slug: string; embedded?: boolean }) {
  return <PublicEventContent key={`${props.handle}/${props.slug}`} {...props} />;
}
function PublicEventContent({ handle, slug, embedded = false }: { handle: string; slug: string; embedded?: boolean }) {
  const documentData = useDocumentData<unknown>();
  const initial = seedEvent(documentData, handle, slug);
  const search = useRouterState({select: state => state.location.searchStr});
  const link = new URLSearchParams(search).get("link") ?? undefined;
  const [used,setUsed] = useState(Boolean(documentData && typeof documentData === "object" && "linkState" in documentData && documentData.linkState === "used"));
  const hydrated = useHydrated(), epoch = useRef(0);
  const [data, setData] = useState<PublicEventPayload | undefined>(initial);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const current = ++epoch.current; setError("");
    try {
      const response = await publicApi.api.public.events[":handle"][":slug"].$get({ param: { handle, slug }, query:{link} });
      if (current !== epoch.current) return;
      if (response.status === 404 || response.status === 410) { setMissing(true); return; }
      if (!response.ok) { const message = await errorMessage(response); if (current === epoch.current) setError(message); return; }
      const payload = await response.json();
      if ("linkState" in payload && payload.linkState === "used") { setUsed(true); setData(undefined); return; }
      setUsed(false);
      const received = seedEvent(payload, handle, slug);
      if (current !== epoch.current) return;
      if (!received) { setError("This session could not be loaded. Please retry."); return; }
      setData(received); setMissing(false);
    } catch { if (current === epoch.current) setError("This session could not be loaded. Please retry."); }
  }, [handle, slug, link]);
  useEffect(() => { void load(); return () => { epoch.current += 1; }; }, [load]);
  if (missing) return <PublicRecoveryPage />;
  if (used) return <PublicTheme><PublicHeader embedded={embedded} /><main className="pb-recovery"><section><p className="pb-eyebrow">Booking link used</p><h1>This link has already been used.</h1><p>Contact the host if you need another meeting.</p></section></main></PublicTheme>;
  if (!data) return <PublicTheme><PublicHeader embedded={embedded} /><main className="pb-loading">{error ? <><p role="alert">{error}</p><button type="button" className="pb-secondary-button" disabled={!hydrated} onClick={() => void load()}>Reload session</button></> : "Loading this session…"}</main></PublicTheme>;
  return <PublicEventEntry data={data} embedded={embedded} />;
}

export function PublicEventPreviewPage({ eventId }: { eventId: string }) {
  return <EventPreview key={eventId} eventId={eventId} />;
}
function EventPreview({ eventId }: { eventId: string }) {
  const hydrated = useHydrated(), epoch = useRef(0);
  const [data, setData] = useState<PublicEventPayload>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const current = ++epoch.current; setError("");
    try {
      const response = await api.api.app["event-types"][":id"].preview.$get({ param: { id: eventId } });
      if (current !== epoch.current) return;
      if (!response.ok) { const message = await errorMessage(response); if (current === epoch.current) setError(message); return; }
      const received = await response.json();
      if (current === epoch.current) setData(received);
    } catch { if (current === epoch.current) setError("The preview could not be loaded. Please retry."); }
  }, [eventId]);
  useEffect(() => { void load(); return () => { epoch.current += 1; }; }, [load]);
  return data ? <PublicEventEntry data={data} preview /> : <div className="text-sm text-muted">{error ? <><p role="alert">{error}</p><button type="button" className="pb-secondary-button" disabled={!hydrated} onClick={() => void load()}>Reload preview</button></> : "Loading public preview…"}</div>;
}
