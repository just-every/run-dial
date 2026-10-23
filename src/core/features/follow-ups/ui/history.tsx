import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button } from "../../../app/ui/primitives";
import { operatorTimestamp } from "../../../shared/operator-format";
import type { FollowUpHistory } from "../types";
export function FollowUpHistoryCard({ bookingId }: { bookingId: string }) {
  const [runs, setRuns] = useState<FollowUpHistory[]>(), [error, setError] = useState(""), [working, setWorking] = useState(false);
  const load = useCallback(async () => {
    setWorking(true); setError("");
    try { const response = await api.api.app.bookings[":id"]["follow-ups"].$get({ param: { id: bookingId } }); if (!response.ok) { setError(await errorMessage(response)); return; } setRuns(await response.json()); }
    catch { setError("Follow-up history could not be loaded."); } finally { setWorking(false); }
  }, [bookingId]);
  useEffect(() => { void load(); }, [load]);
  return <section className="mt-6 border-t border-line-soft pt-5" aria-label="Post-meeting email history"><h3 className="font-bold">Post-meeting emails</h3><p className="mt-2 text-sm text-soft">Sent means accepted by the mail provider. An attendance wait is recorded as skipped until the host marks attendance.</p>{runs ? runs.length ? <ul className="mt-3 grid gap-3">{runs.map(run => <li key={run.id} className="rounded-xl bg-row p-3 text-sm"><strong className="capitalize">{run.outcome}</strong><p>Due {operatorTimestamp(run.dueAt, run.timezone)}</p>{run.reason ? <p>Reason: {run.reason.replaceAll("_", " ")}</p> : null}</li>)}</ul> : <p className="mt-3 text-sm text-soft">No follow-up scheduled for this booking.</p> : <p role="status">Loading follow-up history…</p>}{error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}<Button className="mt-3" variant="quiet" type="button" disabled={working} onClick={() => void load()}>Refresh follow-up history</Button></section>;
}
