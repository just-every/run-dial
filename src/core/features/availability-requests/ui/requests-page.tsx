import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { api, errorMessage } from "../../../api/client";
import { Card, Segmented, noticeClassName } from "../../../app/ui/primitives";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { RecordNotFound } from "../../bookings/client";
import { RequestDetail, RequestStateBadge, type AvailabilityRequest, type RequestState } from "./request-detail";

const viewOptions = [["all", "All"], ["submitted", "Submitted"], ["handled", "Handled"], ["closed", "Closed"]] as const;
type SelectedRequest = { id: string; record?: AvailabilityRequest; missing: boolean };

export function RequestsInboxPage() {
  const navigate = useNavigate();
  const selectedId = useRouterState({ select: route => (route.matches.at(-1)?.params as { id?: string } | undefined)?.id });
  const initialRequests = useWorkspaceRead<AvailabilityRequest[]>("/api/app/availability-requests?state=submitted");
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const [state, setState] = useState<"all" | RequestState>("submitted");
  const [requests, setRequests] = useState(initialRequests);
  const [hostTimezone, setHostTimezone] = useState(profile?.timezone);
  const [selectedRequest, setSelectedRequest] = useState<SelectedRequest>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    if (selectedId && selectedId.length !== 26) return;
    const version = ++loadVersion.current;
    try {
      const [response, profileResponse, detailResponse] = await Promise.all([
        api.api.app["availability-requests"].$get({ query: state === "all" ? {} : { state } }),
        api.api.app.profile.$get(),
        selectedId ? api.api.app["availability-requests"][":id"].$get({ param: { id: selectedId } }) : undefined,
      ]);
      if (version !== loadVersion.current) return;
      for (const result of [response, profileResponse, detailResponse]) {
        if (result && !result.ok && !(result === detailResponse && result.status === 404)) {
          const message = await errorMessage(result);
          if (version === loadVersion.current) setError(message);
          return;
        }
      }
      const [records, nextProfile, record] = await Promise.all([
        response.json() as Promise<AvailabilityRequest[]>,
        profileResponse.json(),
        detailResponse?.ok ? detailResponse.json() as Promise<AvailabilityRequest> : undefined,
      ]);
      if (version !== loadVersion.current) return;
      setRequests(records);
      setHostTimezone(nextProfile?.timezone);
      if (selectedId) setSelectedRequest({ id: selectedId, record, missing: detailResponse?.status === 404 });
      setError("");
    } catch {
      if (version === loadVersion.current) setError("Requests could not be loaded. Reload to try again.");
    }
  }, [selectedId, state]);
  const currentRead = useRef({ load, selectedId });
  useEffect(() => {
    currentRead.current = { load, selectedId };
    void load();
    return () => { loadVersion.current++; };
  }, [load]);

  async function transition(id: string, next: "handled" | "closed") {
    if (working) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["availability-requests"][":id"].state.$post({ param: { id }, json: { state: next } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setNotice(next === "handled" ? "Request marked handled; notification queued." : "Request closed; notification queued.");
      await currentRead.current.load();
    } catch { setError("The result could not be received. Reload to check the request before retrying."); }
    finally { setWorking(false); }
  }
  async function erase(id: string) {
    if (working || !window.confirm("Erase this request's contact details, preferred windows, note and delivery history?")) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["availability-requests"][":id"].$delete({ param: { id } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setNotice("Request data erased.");
      loadVersion.current++;
      setRequests(current => current?.filter(request => request.id !== id));
      if (currentRead.current.selectedId === id) await navigate({ to: "/app/requests", replace: true, resetScroll: false });
      else await currentRead.current.load();
    } catch { setError("The result could not be received. Reload to check the request before retrying."); }
    finally { setWorking(false); }
  }

  const selectedResult = selectedRequest?.id === selectedId ? selectedRequest : undefined;
  const active = selectedId ? selectedResult?.record ?? requests?.find(request => request.id === selectedId) : requests?.[0];
  if (selectedId && (selectedId.length !== 26 || selectedResult?.missing)) return <RecordNotFound kind="request" back="/app/requests" />;

  return <div className="grid gap-7">
    <PageHeader title="Requests" description="Review proposed times and create an agreed booking." />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented label="View" name="request-view" value={state} options={viewOptions} onChange={setState} />
      {hostTimezone ? <p className="text-sm text-muted">Times in {hostTimezone}</p> : null}
    </div>
    {error ? <p role="alert" className={noticeClassName("error")}>{error} <button type="button" disabled={working} className="underline" onClick={() => void load()}>Reload requests</button></p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}
    {requests === undefined ? <p className="text-sm text-muted">Loading requests…</p> : !selectedId && requests.length === 0 ? <EmptyState title="No matching requests" description="Invitee requests will appear here." /> : <div className="grid items-start gap-5 xl:grid-cols-[minmax(260px,.8fr)_minmax(0,1.4fr)]">
      {requests.length ? <Card className="divide-y divide-line-soft overflow-hidden">
        {requests.map(request => <Link to="/app/requests/$id" params={{ id: request.id }} resetScroll={false} aria-current={active?.id === request.id ? "true" : undefined} className={`dial-list-row block w-full px-5 py-4 text-left transition-colors ${active?.id === request.id ? "bg-gold-wash" : "hover:bg-row"}`} key={request.id}>
          <div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block text-base font-bold leading-[1.3] text-ink">{request.inviteeName}</strong><small className="text-sm text-muted">{request.eventTitle}</small></span><RequestStateBadge state={request.state} /></div>
        </Link>)}
      </Card> : <EmptyState title="No matching requests" description="Change the view to see other requests." />}
      {active ? <RequestDetail key={active.id} hostTimezone={hostTimezone} working={working} request={active} onTransition={transition} onErase={erase} /> : selectedId && !error ? <p role="status" className="text-sm text-muted">Loading request…</p> : null}
    </div>}
  </div>;
}
