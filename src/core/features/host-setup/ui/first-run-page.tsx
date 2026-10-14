import { Link } from "@tanstack/react-router";
import { HealthStatus } from "./health-status";
import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { PageHeader } from "../../../app/ui/page-header";
import { Button, Card, IconTile, noticeClassName } from "../../../app/ui/primitives";
import { ProgressDial } from "../../../shared/drawing/ProgressDial";
import { SetupChecklist } from "./setup-checklist";
import { useHostSetup } from "./use-host-setup";

export function FirstRunPage() {
  const { state, error } = useHostSetup();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState("");
  async function complete() {
    setWorking(true); setFailure("");
    try {
      const response = await api.api.app["host-setup"].complete.$post();
      if (!response.ok) throw new Error(await errorMessage(response));
      window.location.assign("/app");
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Setup could not be finished. Try again."); setWorking(false); }
  }
  return <div className="grid gap-7"><PageHeader eyebrow="First run" title="Set up your scheduling workspace" description="Save your host profile, publish an event or Open requests, and copy its booking link." titleArt={state ? <ProgressDial count={state.steps.length} done={state.steps.filter((step) => step.done).length} size={56} className="shrink-0" /> : undefined} actions={<Link to="/setup/event-types/new" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-gold-wash px-4 text-[15px] font-semibold text-ink underline decoration-[1.5px] underline-offset-[5px] hover:decoration-gold-deep"><span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-gold" />New event type</Link>} /><Card className="flex items-start gap-4 p-5 sm:p-6"><IconTile icon="mail" /><p className="text-sm leading-6 text-ink">Open requests needs a working mail sender, but no Google Calendar or availability windows. Automatic booking uses your saved availability and existing Dial bookings. Google Calendar is optional. Without a connected calendar, Dial does not check external calendar conflicts. Publishing an event turns on real bookings; when a calendar is connected it must pass its checks. Google Meet requires a connected calendar. Finishing checks the current connections again; later connection issues stay visible in Settings and never restart setup.</p></Card>{error || failure ? <p role="alert" className={noticeClassName("error")}>{failure || error}</p> : null}{state ? <><SetupChecklist state={state} /><HealthStatus state={state} workspace="/setup" /><Button type="button" className="w-full sm:w-fit" disabled={working || !state.profileReady || !state.links.some(link => link.copiedAt !== null)} onClick={() => void complete()}>{working ? "Finishing…" : "Finish setup"}</Button></> : <p role="status">Loading setup…</p>}</div>;
}
