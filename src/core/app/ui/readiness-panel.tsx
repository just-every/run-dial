import { Link } from "@tanstack/react-router";
import { readinessFix } from "../../features/event-types/readiness";

/** Publication lists the requirements where the owner acts, with a way to each one. */
export function ReadinessPanel({ missing, checking = false, notice, eventId, workspace = "/app" }: { workspace?: "/app" | "/setup"; missing?: string[]; checking?: boolean; notice?: string; eventId?: string; checkedAt?: string; timezone?: string }) {
  return <section aria-label="Publication requirements" className="grid gap-3">
    <h3 className="font-bold">Before you publish</h3>
    {notice || checking || missing === undefined ? <p className="text-sm text-soft">{notice ?? (checking ? "Checking requirements…" : "Requirements could not be checked. Try publishing to check again.")}</p> : null}
    {missing?.length ? <ul className="grid gap-2 text-sm">{missing.map(code => {
      const fix = readinessFix(code, eventId);
      const href = fix.href.replace(/\/availability$/, "/hours").replace(/^\/app(?=\/|$)/, workspace);
      return <li key={code}><Link to={href} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{fix.label}</Link></li>;
    })}</ul> : missing ? <p className="text-sm text-soft">Ready to publish.</p> : null}
  </section>;
}
