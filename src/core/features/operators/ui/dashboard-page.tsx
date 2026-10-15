import { useHostSetup } from "../../host-setup";
import { SetupChecklist } from "../../host-setup";
import { HealthStatus } from "../../host-setup";
import { Link, useLoaderData } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader, SectionHeading } from "../../../app/ui/page-header";
import { Badge, Card, buttonClassName, noticeClassName, textLinkClassName } from "../../../app/ui/primitives";
import { MiniDial } from "../../../shared/drawing/MiniDial";
import type { EventTypeRecord } from "../../event-types";
import { readProfile, type ProfileRecord } from "../../host-profile";
import { OverviewActivity } from "./overview-activity";

export function DashboardPage() {
  const setup = useHostSetup();
  const initial = useLoaderData({ from: "/app" });
  const [profile, setProfile] = useState<ProfileRecord | null>(initial.profile ?? null);
  const [eventTypes, setEventTypes] = useState<EventTypeRecord[]>();
  const [profileError, setProfileError] = useState("");
  const [eventError, setEventError] = useState("");
  useEffect(() => {
    let active = true;
    void api.api.app.profile.$get().then(readProfile).then((current) => {
      if (active) { setProfile(current); setProfileError(""); }
    }).catch((error: unknown) => {
      if (active) setProfileError(error instanceof Error ? error.message : "The host profile could not be loaded. Reload to try again.");
    });
    void api.api.app["event-types"].$get().then(async (response) => {
      if (!response.ok) throw new Error(await errorMessage(response));
      const current = await response.json();
      if (active) setEventTypes(current);
    }).catch((error: unknown) => {
      if (active) setEventError(error instanceof Error ? error.message : "Event types could not be loaded. Reload to try again.");
    });
    return () => { active = false; };
  }, []);
  const published = eventTypes?.filter((eventType) => eventType.status === "published").length ?? 0;
  return <div className="grid gap-7">
    <PageHeader eyebrow="Operator workspace" title={profile ? `Welcome, ${profile.name.split(" ")[0]}.` : "Scheduling overview"} description={setup.state?.completedAt ? "Review your event types, bookings, requests, and connection health." : "Review live scheduling configuration and resolve the requirements that keep public booking unavailable."} art={<MiniDial size={72} />} actions={<Link to="/app/event-types/new" className={buttonClassName()}>New event type</Link>} />
    {profileError ? <p role="alert" className={noticeClassName("error")}>{profileError}</p> : null}
    {eventError ? <p role="alert" className={noticeClassName("error")}>{eventError}</p> : null}
    {setup.error ? <p role="alert" className="text-sm text-danger">{setup.error}</p> : setup.state ? <SetupChecklist state={setup.state} workspace="/app" /> : <p role="status">Loading setup…</p>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5 sm:p-6">
        <SectionHeading icon="calendar" title="Event types" description={eventTypes ? `${published} published of ${eventTypes.length} configured.` : eventError ? "Event types unavailable." : "Loading event types…"} action={<Link to="/app/event-types" className={`${textLinkClassName} text-[15px]`}>Manage</Link>} />
        {eventTypes?.length ? <div className="mt-5 grid gap-3">{eventTypes.map((eventType) => <Link key={eventType.id} to="/app/event-types/$id" params={{ id: eventType.id }} className="flex items-center justify-between gap-3 rounded-2xl bg-row px-4 py-3.5 transition-colors hover:bg-gold-wash"><span className="min-w-0"><strong className="block text-base font-bold">{eventType.title}</strong><small className="text-sm text-soft">{eventType.durationMinutes} minutes · {eventType.locationLabel}</small></span><Badge tone={eventType.status === "published" ? "success" : eventType.status === "disabled" ? "danger" : "warning"}>{eventType.status}</Badge></Link>)}</div> : eventTypes ? <p className="mt-5 text-sm leading-6 text-soft">No event types are configured yet.</p> : null}
      </Card>
      {setup.state ? <HealthStatus state={setup.state} /> : null}
      <OverviewActivity />
    </div>
    {profile === null && !profileError ? <EmptyState title="Host profile not configured" description="Add the host identity before publishing a scheduling page." action={<Link to="/app/profile" className={buttonClassName()}>Set up host profile</Link>} /> : null}
  </div>;
}
