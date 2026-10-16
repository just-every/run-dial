import { useWorkspaceRead } from "../../../app/workspace-reads";
import { ExtensionSlot } from "../../../app/extensions";
import { operatorTimestamp } from "../../../shared/operator-format";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Badge, Button, Card, Segmented, buttonClassName, noticeClassName } from "../../../app/ui/primitives";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";

type RequestState = "submitted" | "handled" | "closed";
const viewOptions = [["all", "All"], ["submitted", "Submitted"], ["handled", "Handled"], ["closed", "Closed"]] as const;
type Request = { id: string; eventTitle: string; inviteeName: string; inviteeEmail: string; inviteeTimezone: string; note: string | null; state: RequestState; bookingId: string | null; submittedAt: string; windows: Array<{ inviteeLabel: string; hostLabel: string }> };

export function RequestsInboxPage() {
  const [state, setState] = useState<"all" | RequestState>("submitted");
  const initialRequests = useWorkspaceRead<Request[]>("/api/app/availability-requests?state=submitted");
  const [requests, setRequests] = useState<Request[] | undefined>(initialRequests);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const [hostTimezone, setHostTimezone] = useState<string | undefined>(profile?.timezone);
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const load = async () => {
    try {
      const [response, profileResponse] = await Promise.all([
        api.api.app["availability-requests"].$get({ query: state === "all" ? {} : { state } }),
        api.api.app.profile.$get(),
      ]);
      if (!profileResponse.ok) { setError(await errorMessage(profileResponse)); return; }
      const profile = await profileResponse.json();
      setHostTimezone(profile?.timezone);
      if (response.ok) { setRequests(await response.json() as Request[]); setError(""); }
      else setError(await errorMessage(response));
    } catch { setError("Requests could not be loaded. Reload to try again."); }
  };
  useEffect(() => { void load(); }, [state]);
  async function transition(id: string, next: "handled" | "closed") {
    if (working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["availability-requests"][":id"].state.$post({ param: { id }, json: { state: next } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setNotice(next === "handled" ? "Request marked handled; notification queued." : "Request closed; notification queued.");
      await load();
    } catch { setError("The result could not be received. Reload to check the request before retrying."); }
    finally { setWorking(false); }
  }
  async function erase(id: string) {
    if (working || !window.confirm("Erase this request's contact details, preferred windows, note and delivery history?")) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["availability-requests"][":id"].$delete({ param: { id } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setNotice("Request data erased."); await load();
    } catch { setError("The result could not be received. Reload to check the request before retrying."); }
    finally { setWorking(false); }
  }
  const active = requests?.find((request) => request.id === selected) ?? requests?.[0];
  return <div className="grid gap-7"><PageHeader eyebrow="Alternative availability" title="Requests" description="Review proposed times and create an agreed booking." /><Segmented label="View" name="request-view" value={state} options={viewOptions} onChange={setState} />{error ? <p role="alert" className={noticeClassName("error")}>{error} <button type="button" disabled={working} className="underline" onClick={() => void load()}>Reload requests</button></p> : null}{notice ? <p role="status" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}{requests === undefined ? <p className="text-sm text-muted">Loading requests…</p> : requests.length === 0 ? <EmptyState title="No matching requests" description="Invitee requests will appear here." /> : <div className="grid items-start gap-5 xl:grid-cols-[minmax(260px,.8fr)_minmax(0,1.4fr)]"><Card className="divide-y divide-line-soft overflow-hidden">{requests.map((request) => <button type="button" className={`w-full px-5 py-4 text-left transition-colors ${active?.id === request.id ? "bg-gold-wash" : "hover:bg-row"}`} onClick={() => setSelected(request.id)} key={request.id}><div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block text-base font-bold leading-[1.3] text-ink">{request.inviteeName}</strong><small className="text-sm text-muted">{request.eventTitle}</small></span><StateBadge state={request.state} /></div><p className="mt-2 truncate text-[15px] text-soft">{request.inviteeEmail}</p></button>)}</Card>{active ? <RequestDetail hostTimezone={hostTimezone} working={working} request={active} onTransition={transition} onErase={erase} /> : null}</div>}</div>;
}

function RequestDetail({ request, onTransition, onErase, working, hostTimezone }: { hostTimezone?: string; working: boolean; request: Request; onTransition: (id: string, state: "handled" | "closed") => Promise<void>; onErase: (id: string) => Promise<void> }) {
  return <Card className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-muted">{request.eventTitle}</p><h2 className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-[-.02em] text-ink">{request.inviteeName}</h2><p className="mt-2 text-[15px] text-soft">{request.inviteeEmail}</p></div><StateBadge state={request.state} /></div><dl className="mt-6 grid gap-x-6 gap-y-4 border-y border-line-soft py-5 text-[15px] sm:grid-cols-2"><div><dt className="text-[13px] font-[650] text-muted">Invitee timezone</dt><dd className="mt-1 text-ink">{request.inviteeTimezone}</dd></div><div><dt className="text-[13px] font-[650] text-muted">Submitted</dt><dd className="mt-1 text-ink">{hostTimezone ? operatorTimestamp(request.submittedAt, hostTimezone) : "Set up the host profile to see the submitted time in the host zone."}</dd></div><div className="sm:col-span-2"><dt className="text-[13px] font-[650] text-muted">Requested windows</dt><dd className="mt-2 grid gap-3">{request.windows.map((window, index) => <div className="rounded-2xl bg-row px-4 py-3.5" key={`${window.inviteeLabel}-${index}`}><strong className="block font-[650] text-ink">Invitee: {window.inviteeLabel}</strong><span className="mt-1 block text-sm text-muted">Host: {window.hostLabel}</span></div>)}</dd></div>{request.note ? <div className="sm:col-span-2"><dt className="text-[13px] font-[650] text-muted">Note</dt><dd className="mt-1 whitespace-pre-wrap text-ink">{request.note}</dd></div> : null}</dl><ExtensionSlot id="availability-request.detail.after.v1" entityId={request.id} />{request.state === "submitted" ? <div className="mt-6 flex flex-wrap gap-3"><a className={buttonClassName()} href={`/app/bookings/new?requestId=${encodeURIComponent(request.id)}`}>Create agreed booking</a><Button type="button" variant="secondary" disabled={working} onClick={() => void onTransition(request.id, "handled")}>Mark handled</Button><Button type="button" variant="danger" disabled={working} onClick={() => void onTransition(request.id, "closed")}>Close request</Button></div> : <p className="mt-6 text-sm font-semibold text-muted">{request.state === "handled" ? "This request has been handled." : "This request has been closed."}</p>}<Button className="mt-4" variant="quiet" disabled={working} onClick={() => void onErase(request.id)}>Erase request data</Button></Card>;
}

function StateBadge({ state }: { state: RequestState }) { return <Badge tone={state === "submitted" ? "warning" : state === "handled" ? "success" : "neutral"}>{state}</Badge>; }
