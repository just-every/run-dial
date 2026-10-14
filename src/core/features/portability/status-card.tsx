import { useEffect, useState } from "react";
import { Button, Card } from "../../app/ui/primitives";
import { SectionHeading } from "../../app/ui/page-header";
import type { ArchiveStatus } from "./admission";

export function ArchiveStatusCard() {
 const [status, setStatus] = useState<ArchiveStatus | null>(null);
 const [working, setWorking] = useState(false);
 const [error, setError] = useState("");
 async function refresh() {
  setWorking(true); setError(""); setStatus(null);
  try {
   const response = await fetch("/api/portability/status", { credentials: "same-origin", cache: "no-store" });
   if (!response.ok) throw new Error(response.status === 401 ? "Sign in with a native owner session to inspect export status." : "Export status could not be loaded. Refresh to retry.");
   setStatus(await response.json() as ArchiveStatus);
  } catch (failure) { setError(failure instanceof Error ? failure.message : "Export status could not be loaded. Refresh to retry."); }
  finally { setWorking(false); }
 }
 useEffect(() => { void refresh(); }, []);
 return <Card className="mt-7 p-5 sm:p-6">
  <SectionHeading title="Export status" action={<Button type="button" variant="secondary" disabled={working} onClick={() => void refresh()}>{working ? "Refreshing…" : "Refresh status"}</Button>} />
  <p className="mt-3 text-sm leading-6 text-soft">Read-only observations from your installation. They do not reserve an export or prove that it can start.</p>
  {status ? <div role="status" className="mt-3 text-sm leading-6 text-ink">
   <p>Operations recorded as in progress: {status.writerAdmissions}. Dial cannot tell whether they are still running.</p>
   <p>{status.activeExport ? "An export currently holds maintenance." : "No export currently holds maintenance."}</p>
  </div> : null}
  {error ? <p role="alert" className="mt-3 text-sm leading-6 text-danger">{error}</p> : null}
  <p className="mt-3 text-sm leading-6 text-soft">These records normally clear when work finishes. Safe recovery requires confirming that earlier requests and their database and file writes can no longer finish. Dial cannot confirm this itself, so it keeps the records. Contact your installation support if export remains blocked.</p>
 </Card>;
}
