import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "../../../app/ui/page-header";
import { Card, buttonClassName, noticeClassName, PlainLink } from "../../../app/ui/primitives";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { bookingWorkspaceSearch } from "../../bookings/client";
import type { ClientHistory, ClientList } from "../types";
import { useClientRead } from "./use-client-read";
import { ClientHistoryView } from "./client-history";
import { ClientBookingRecord } from "./client-booking-record";
import { clientPage, clientPageSize, clientListPath, clientHistoryPath } from "../queries";
import { ClientAnnotations } from "./client-annotations";

export function ClientsWorkspace() {
  const router = useRouter();
  const search = useRouterState({ select: state => bookingWorkspaceSearch(state.location.search, state.location.searchStr) });
  const params = new URLSearchParams(search), page = clientPage(params.get("clientPage")), historyPage = clientPage(params.get("historyPage"));
  const [revision, setRevision] = useState(0);
  const listPath = clientListPath(page);
  const list = useClientRead<ClientList>(listPath, revision);
  const email = params.get("client") ?? list.data?.clients[0]?.email;
  const historyPath = email ? clientHistoryPath(email, historyPage) : undefined;
  const history = useClientRead<ClientHistory>(historyPath, revision);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const record = params.get("record");
  const navigate = (client: string | undefined, nextPage = page, selectedRecord?: string, nextHistoryPage = 1) => void router.navigate({ to: "/app/bookings", search: () => ({ view: "clients", clientPage: nextPage, historyPage: nextHistoryPage, ...(client ? { client } : {}), ...(selectedRecord ? { record: selectedRecord } : {}) }) });
  return <div className="grid min-w-0 gap-7" data-clients-ready={!list.loading && !history.loading}>
    <PageHeader title="Clients" description="Review each invitee’s scheduling history and booking details." actions={<PlainLink to="/app/bookings" search={() => ({})} className={buttonClassName("secondary")}>Bookings</PlainLink>} />
    {list.error || history.error ? <WorkspaceLoadState error={list.error || history.error} onRetry={() => setRevision(value => value + 1)} /> : null}
    <p role="status" className="text-sm text-muted">{list.loading || list.error ? null : `${list.data?.totalCount ?? 0} client${list.data?.totalCount === 1 ? "" : "s"}`}</p>
    {list.loading ? <WorkspaceLoadState label="Loading clients…" onRetry={() => setRevision(value => value + 1)} /> : null}
    {list.data && list.data.totalCount > clientPageSize ? <nav aria-label="Client result pages" className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClassName("secondary")} disabled={page === 1} onClick={() => navigate(undefined, page - 1)}>Previous page</button><span>Page {page}</span><button type="button" className={buttonClassName("secondary")} disabled={page * clientPageSize >= list.data.totalCount} onClick={() => navigate(undefined, page + 1)}>Next page</button></nav> : null}
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(240px,.7fr)_minmax(0,1.5fr)]">
      <Card className="min-w-0 divide-y divide-line-soft overflow-hidden">
        {list.data?.clients.map(client => <button key={client.email} type="button" aria-pressed={email === client.email} className={`w-full min-w-0 px-5 py-4 text-left ${email === client.email ? "bg-gold-wash" : "hover:bg-row"}`} onClick={() => navigate(client.email)}><strong className="block break-words">{client.name || client.email}</strong><span className="mt-1 block break-all text-sm text-muted">{client.name ? `${client.email} · ` : ""}{client.bookingCount} booking{client.bookingCount === 1 ? "" : "s"}</span></button>)}
        {list.data?.totalCount === 0 ? <p className="p-5 text-sm text-muted">Clients appear when an invitee books.</p> : null}
      </Card>
      <div className="grid min-w-0 gap-5">
        {history.loading ? <WorkspaceLoadState label="Loading client history…" onRetry={() => setRevision(value => value + 1)} /> : history.data && profile ? <ClientHistoryView history={history.data} timezone={profile.timezone} /> : history.data ? <p role="alert" className={noticeClassName("error")}>The viewer’s time zone could not be loaded.</p> : null}
        {history.data && profile ? <ClientAnnotations key={history.data.email} history={history.data} timezone={profile.timezone} onChanged={()=>setRevision(value=>value+1)} onMerged={merged=>{setRevision(value=>value+1);navigate(merged);}} /> : null}
        {history.data && history.data.totalCount > clientPageSize ? <nav aria-label="Client history pages" className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClassName("secondary")} disabled={historyPage === 1} onClick={() => navigate(email, page, undefined, historyPage - 1)}>Earlier history page</button><span>History page {historyPage}</span><button type="button" className={buttonClassName("secondary")} disabled={historyPage * clientPageSize >= history.data.totalCount} onClick={() => navigate(email, page, undefined, historyPage + 1)}>Later history page</button></nav> : null}
        {record ? <><button type="button" className={buttonClassName("secondary", "justify-self-start")} onClick={() => navigate(email)}>Close booking record</button><ClientBookingRecord id={record} onChanged={() => setRevision(value => value + 1)} onErased={() => navigate(email)} /></> : null}
      </div>
    </div>
  </div>;
}
