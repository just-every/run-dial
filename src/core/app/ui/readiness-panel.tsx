import { readinessFix } from "../../features/event-types/readiness";
import { SectionHeading } from "./page-header";
import { Card, WarningMark } from "./primitives";
import { operatorTimestamp } from "../../shared/operator-format";

export function ReadinessPanel({ missing, checking = false, notice, eventId, workspace = "/app", checkedAt, timezone }: { workspace?: "/app" | "/setup"; missing?: string[]; checking?: boolean; notice?: string; eventId?: string; checkedAt?: string; timezone?: string }) {
  return <Card className="p-5 sm:p-6">
    <SectionHeading icon="check" title="Event type readiness" description={notice ?? (checking ? "Checking configured connections…" : missing === undefined ? "Readiness could not be checked. Reload the event to check again." : missing.length ? "Meet these requirements before publishing." : "Required publication checks passed.")} />
    {checkedAt ? <p className="mt-2 text-[13px] text-muted">Connections last checked {operatorTimestamp(checkedAt, timezone ?? "UTC")}.</p> : null}
    <ul className="mt-4 grid gap-3 text-sm text-ink">{missing?.map((code) => {
      const fix = readinessFix(code, eventId);
      return <li key={code} className="flex items-start gap-3 rounded-[14px] border border-gold-line bg-gold-wash p-3"><WarningMark /><a href={fix.href.replace(/^\/app(?=\/|$)/, workspace)} className="font-semibold underline decoration-[1.5px] underline-offset-4 hover:decoration-gold-deep">{fix.label}</a></li>;
    })}</ul>
  </Card>;
}
