import { HostAvatar } from "../../host-profile";
import { useDocumentData } from "../../../app/document-data";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { MiniDial } from "../../../shared/drawing/MiniDial";
import { errorMessage, publicApi } from "../../../api/client";
import { PublicFooter, PublicHeader, PublicTheme } from "./public-shell";
import { PublicRecoveryPage } from "./recovery-page";
import type { PublicEvent, PublicProfile } from "./types";
import { useHydrated } from "../../../app/use-hydrated";
import { seedProfile } from "./document-seeds";

type ProfileResponse = { profile: PublicProfile; eventTypes: PublicEvent[] };

export function PublicProfilePage({ handle }: { handle: string }) {
  return <PublicProfileContent key={handle} handle={handle} />;
}
function PublicProfileContent({ handle }: { handle: string }) {
  const hydrated = useHydrated(), epoch = useRef(0);
  const [data, setData] = useState<ProfileResponse | undefined>(seedProfile(useDocumentData<unknown>(), handle));
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const current = ++epoch.current; setError("");
    try {
      const response = await publicApi.api.public.profiles[":handle"].$get({ param: { handle } });
      if (current !== epoch.current) return;
      if (response.status === 404) { setMissing(true); return; }
      if (!response.ok) { const message = await errorMessage(response); if (current === epoch.current) setError(message); return; }
      const received = seedProfile(await response.json(), handle);
      if (current !== epoch.current) return;
      if (!received) { setError("This profile could not be loaded. Please retry."); return; }
      setData(received); setMissing(false);
    } catch { if (current === epoch.current) setError("This profile could not be loaded. Please retry."); }
  }, [handle]);
  useEffect(() => { void load(); return () => { epoch.current += 1; }; }, [load]);
  if (missing) return <PublicRecoveryPage />;
  if (!data) return <PublicTheme><PublicHeader /><main className="pb-loading">{error ? <><p role="alert">{error}</p><button type="button" className="pb-secondary-button" disabled={!hydrated} onClick={() => void load()}>Reload profile</button></> : "Loading this booking profile…"}</main></PublicTheme>;
  const { profile, eventTypes } = data;
  return <PublicTheme><PublicHeader profilePath={`/book/${profile.handle}`} /><main className="pb-profile-page"><section className="pb-profile-intro"><HostAvatar name={profile.name} avatarKey={profile.avatarKey} className="pb-avatar" /><p className="pb-eyebrow">Meet your host</p><h1>{profile.name}</h1><p className="pb-profile-title">{profile.title}</p><p className="pb-profile-bio">{profile.biography}</p>{profile.focusAreas.length ? <section className="pb-profile-section"><h2>Focus areas</h2><div className="pb-focus-list">{profile.focusAreas.map((area) => <span key={area.label}>{area.label}</span>)}</div></section> : null}{profile.socialProof.length ? <section className="pb-profile-section"><h2>In their words</h2>{profile.socialProof.map((proof) => <blockquote key={`${proof.quote}-${proof.attribution}`}>“{proof.quote}”<cite>— {proof.attribution}</cite></blockquote>)}</section> : null}</section><section className="pb-profile-events" aria-labelledby="open-sessions"><p className="pb-eyebrow">Book with {profile.name}</p><h2 id="open-sessions">Choose a session</h2>{eventTypes.length ? <div className="pb-event-list">{eventTypes.map((eventType) => <EventCard key={eventType.slug} eventType={eventType} handle={profile.handle} />)}</div> : <section className="pb-empty-sessions"><span aria-hidden="true">◌</span><h3>No sessions are currently open.</h3><p>Check back when {profile.name} opens a session that can be booked.</p></section>}</section></main><PublicFooter /></PublicTheme>;
}

function EventCard({ eventType, handle }: { eventType: PublicEvent; handle: string }) {
  return <article className="pb-event-card"><div className="pb-event-art"><span>A focused working session</span><MiniDial /></div><div className="pb-event-card-body"><h3>{eventType.title}</h3><p>{eventType.description}</p><div className="pb-event-meta"><span>{eventType.durationMinutes} minutes</span><span>{eventType.locationLabel}</span></div><Link className="pb-primary-link" to="/book/$handle/$slug" params={{ handle, slug: eventType.slug }}>View session <span aria-hidden="true">→</span></Link></div></article>;
}
