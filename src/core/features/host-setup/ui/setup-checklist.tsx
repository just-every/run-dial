import { Card, textLinkClassName } from "../../../app/ui/primitives";
import { Icon, type IconName } from "../../../shared/drawing/icons";
import { ProgressDial } from "../../../shared/drawing/ProgressDial";
import type { HostSetupOverview } from "../steps";
import { CopyBookingLink } from "./copy-booking-link";

const stepIcons: Record<string, IconName> = { profile: "user", mail: "mail", calendar: "calendar", availability: "clock", event: "file", publication: "check", copy: "link" };

export function SetupChecklist({ state, workspace = "/setup" }: { state: HostSetupOverview; workspace?: "/app" | "/setup" }) {
  const complete = state.completedAt !== null;
  const done = state.steps.filter((step) => step.done).length;
  return <Card className="p-5 sm:p-6"><details open={!complete} className="group">
    <summary className="flex cursor-pointer list-none items-center gap-3 text-[19px] font-[750] leading-[1.25] tracking-[-.01em] [&::-webkit-details-marker]:hidden">
      {complete
        ? <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-wash"><span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-gold transition-transform group-open:rotate-90" /></span>
        : <><ProgressDial count={state.steps.length} done={done} size={32} className="shrink-0" /><span aria-hidden="true" className="h-0 w-0 shrink-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-muted transition-transform group-open:rotate-90" /></>}
      <span>{complete ? "Booking configuration" : "Set up your booking link"} <span className="whitespace-nowrap">· {done} of 7 done</span></span>
    </summary>
    <ol aria-label={complete ? "Booking configuration" : "First-run checklist"} className="mt-5 grid gap-2.5 sm:grid-cols-2">{state.steps.map((step, index) => <li key={step.id} data-step={step.id} className="flex items-center gap-3 rounded-2xl bg-row px-4 py-3.5">
      <span aria-hidden="true" className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${step.done ? "bg-gold text-ink" : "bg-wash text-ink"}`}>{index + 1}</span>
      <Icon name={stepIcons[step.id] ?? "check"} className="line-icon h-5 w-5 text-ink" />
      <div className="min-w-0"><a className={textLinkClassName} href={step.href.replace(/^\/app(?=\/|$)/, workspace)}>{step.label}</a><p className="mt-1 text-sm text-muted">{step.optional ? "Optional · using Dial availability" : step.done ? "Done" : "To do"}</p></div>
    </li>)}</ol>
    {state.links[0] ? <div className="mt-4 w-fit"><CopyBookingLink link={state.links[0]} /></div> : null}
  <p className="mt-4 text-[15px]"><a href={`${workspace}/settings#move-in`} className={textLinkClassName}>Move in from saved scheduling data</a></p>
    {state.moveInStarted ? <p className="mt-2 text-[15px]"><a href={`${workspace}/settings#switch-over`} className={textLinkClassName}>Switch over from Calendly</a></p> : null}</details></Card>;
}
