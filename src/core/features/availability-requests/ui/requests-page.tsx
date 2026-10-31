import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceRead, useWorkspaceResponse } from "../../../app/workspace-reads";
import { api, errorMessage } from "../../../api/client";
import { Segmented, noticeClassName } from "../../../app/ui/primitives";
import { EmptyState } from "../../../app/ui/empty-state";
import { PageHeader } from "../../../app/ui/page-header";
import { recordId } from "../../../app/record-id";
import { IndexHead, PageOnly, RecordBack, RecordLayout, RecordRow, RecordRows, countOf, recordTrail, useReturnFocus } from "../../../app/ui/record-layout";
import { RecordNotFound } from "../../bookings/client";
import { readRequestView, requestListAddress, requestListPath, type RequestView } from "../request-view";
import { RequestDetail, RequestStateBadge, type AvailabilityRequest } from "./request-detail";

const viewOptions = [["all", "All"], ["submitted", "Submitted"], ["handled", "Handled"], ["closed", "Closed"]] as const;
type SelectedRequest = { id: string; record?: AvailabilityRequest; missing: boolean };

/** The requests list, and a request at its own path /app/requests/<id>: beside the list's index from 1280 px, its own page under. */
export function RequestsInboxPage() {
  const navigate = useNavigate();
  const selectedId = useRouterState({ select: route => (route.matches.at(-1)?.params as { id?: string } | undefined)?.id });
  const state = useRouterState({ select: route => readRequestView(new URLSearchParams(route.location.searchStr)) });
  const list = requestListAddress(state);
  const initialRequests = useWorkspaceRead<AvailabilityRequest[]>(requestListPath(state));
  const initialDetail = useWorkspaceResponse<AvailabilityRequest>(recordId(selectedId) && `/api/app/availability-requests/${selectedId}`);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const [requests, setRequests] = useState(initialRequests);
  const [hostTimezone, setHostTimezone] = useState(profile?.timezone);
  const [selectedRequest, setSelectedRequest] = useState<SelectedRequest | undefined>(selectedId && initialDetail ? { id: selectedId, record: initialDetail.data, missing: initialDetail.status === 404 } : undefined);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    if (selectedId && !recordId(selectedId)) return;
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
  const currentRead = useRef({ load, selectedId, list });
  useEffect(() => {
    currentRead.current = { load, selectedId, list };
    void load();
    return () => { loadVersion.current++; };
  }, [load, list]);

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
      if (currentRead.current.selectedId === id) await navigate({ href: currentRead.current.list, replace: true });
      else await currentRead.current.load();
    } catch { setError("The result could not be received. Reload to check the request before retrying."); }
    finally { setWorking(false); }
  }
  function changeView(view: RequestView) {
    const search = view === "submitted" ? {} : { state: view };
    if (selectedId) void navigate({ to: "/app/requests/$id", params: { id: selectedId }, search, resetScroll: false });
    else void navigate({ to: "/app/requests", search, resetScroll: false });
  }

  const open = Boolean(selectedId);
  useReturnFocus(list, open);
  const selectedResult = selectedRequest?.id === selectedId ? selectedRequest : undefined;
  const active = selectedId ? selectedResult?.record ?? requests?.find(request => request.id === selectedId) : undefined;
  if (selectedId && (!recordId(selectedId) || selectedResult?.missing)) return <RecordNotFound kind="request" back="/app/requests" />;

  const errorLine = error && requests !== undefined ? <p role="alert" className={noticeClassName("error")}>{error} <button type="button" disabled={working} className="underline" onClick={() => void load()}>Reload requests</button></p> : null;
  const noticeLine = notice ? <p role="status" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null;
  const record = open ? <div className="grid min-w-0 gap-5">
    <RecordBack href={list} label="Requests" className="xl:hidden" />
    {errorLine}{noticeLine}
    {active ? <RequestDetail key={active.id} hostTimezone={hostTimezone} working={working} request={active} onTransition={transition} onErase={erase} />
      : requests === undefined && error ? <WorkspaceLoadState error={error} onRetry={() => { setError(""); return load(); }} /> : error ? null : <p role="status" className="text-sm text-muted">Loading request…</p>}
  </div> : undefined;

  return <RecordLayout record={record}>
    <div className="grid gap-7">
      <PageOnly><PageHeader title="Requests" description="Review proposed times and create an agreed booking." /></PageOnly>
      <IndexHead back={<RecordBack href={list} label="Requests" />} meta={requests ? countOf(requests.length, "request") : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="View" name="request-view" value={state} options={viewOptions} stacked={open} columns={open} onChange={changeView} />
        {hostTimezone && !open ? <p className="text-sm text-muted">Times in {hostTimezone}</p> : null}
      </div>
      {open ? null : <>{errorLine}{noticeLine}</>}
      {requests === undefined ? <WorkspaceLoadState error={error} label="Loading requests…" onRetry={() => { setError(""); return load(); }} />
        : requests.length ? <RecordRows>
          {requests.map(request => <RecordRow key={request.id} to="/app/requests/$id" params={{ id: request.id }} search={previous => previous} state={recordTrail(list)} row={request.id} list={list} current={open && active?.id === request.id}>
            <div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block text-base font-bold leading-[1.3] text-ink">{request.inviteeName}</strong><small className={`block text-sm text-muted ${open ? "truncate" : ""}`}>{request.eventTitle}</small></span><RequestStateBadge state={request.state} /></div>
          </RecordRow>)}
        </RecordRows>
        : open ? null : <EmptyState title="No matching requests" description={state === "submitted" ? "Invitee requests will appear here." : "Change the view to see other requests."} />}
    </div>
  </RecordLayout>;
}
