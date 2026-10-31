import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "../../../app/ui/page-header";
import { buttonClassName, noticeClassName, PlainLink } from "../../../app/ui/primitives";
import { IndexHead, PageOnly, RecordBack, RecordLayout, RecordRow, RecordRows, countOf, recordTrail, useReturnFocus } from "../../../app/ui/record-layout";
import { useRecordRead } from "../../../app/use-record-read";
import { useWorkspaceRead } from "../../../app/workspace-reads";
import { RecordNotFound } from "../../bookings/client";
import type { ClientHistory, ClientList } from "../types";
import { useClientRead } from "./use-client-read";
import { ClientHistoryView } from "./client-history";
import { ClientAnnotations } from "./client-annotations";
import { clientAddress, clientPage, clientPageSize, clientListPath, clientHistoryPath } from "../queries";

/** The clients list at /app/clients, and a client at its own path /app/clients/<email> (CLIENT-001, DW6). */
export function ClientsPage() {
  const router = useRouter();
  const routeEmail = useRouterState({ select: state => (state.matches.at(-1)?.params as { email?: string } | undefined)?.email });
  const searchStr = useRouterState({ select: state => state.location.searchStr });
  const navigating = useRouterState({ select: state => state.status === "pending" });
  const params = new URLSearchParams(searchStr), page = clientPage(params.get("clientPage")), historyPage = clientPage(params.get("historyPage"));
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  const pageSearch = page > 1 ? { clientPage: page } : {};
  const list = `/app/clients${page > 1 ? `?clientPage=${page}` : ""}`;
  const listRead = useClientRead<ClientList>(clientListPath(page), revision);
  const email = clientAddress(routeEmail);
  const history = useRecordRead<ClientHistory>(email && clientHistoryPath(email, historyPage), revision);
  const profile = useWorkspaceRead<{ timezone: string }>("/api/app/profile");
  const open = routeEmail !== undefined;
  useReturnFocus(list, open);
  // A merged address reads as its client's primary address, which takes its place in the address bar.
  const primary = history.data?.email;
  useEffect(() => {
    if (email && primary && primary !== email) void router.navigate({ to: "/app/clients/$email", params: { email: primary }, search: previous => previous, state: previous => previous, replace: true });
  }, [email, primary, router]);
  // An address with no bookings, notes or fields is no client.
  if (open && (!email || history.missing || history.data && !history.data.totalCount && !history.data.notes.length && !history.data.fields.length)) return <RecordNotFound kind="client" back="/app/clients" />;

  // Readiness is marked once, on what is in view: the client while one is open, otherwise the list. While the router is still
  // moving to another address (a merge's target), what is drawn belongs to the last one, so it is not ready.
  const ready = !navigating && !listRead.loading && (!open || Boolean(history.data));
  const navigateHistory = (nextHistoryPage: number) => void router.navigate({ to: "/app/clients/$email", params: { email: primary ?? email! }, search: { ...pageSearch, ...(nextHistoryPage > 1 ? { historyPage: nextHistoryPage } : {}) }, state: previous => previous, resetScroll: false });
  const record = open ? <div className="grid min-w-0 gap-5" data-clients-ready={ready}>
    <RecordBack href={list} label="Clients" className="xl:hidden" />
    {history.error ? <WorkspaceLoadState error={history.error} onRetry={refresh} /> : null}
    {history.data && profile ? <div className="grid min-w-0 gap-8">
      <ClientHistoryView history={history.data} timezone={profile.timezone} />
      {history.data.totalCount > clientPageSize ? <nav aria-label="Client history pages" className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClassName("secondary")} disabled={historyPage === 1} onClick={() => navigateHistory(historyPage - 1)}>Earlier history page</button><span>History page {historyPage}</span><button type="button" className={buttonClassName("secondary")} disabled={historyPage * clientPageSize >= history.data.totalCount} onClick={() => navigateHistory(historyPage + 1)}>Later history page</button></nav> : null}
      <ClientAnnotations key={history.data.email} history={history.data} timezone={profile.timezone} onChanged={refresh} onMerged={merged => { refresh(); void router.navigate({ to: "/app/clients/$email", params: { email: merged }, search: () => pageSearch, state: previous => previous, replace: true }); }} />
    </div> : history.data ? <p role="alert" className={noticeClassName("error")}>The viewer’s time zone could not be loaded.</p>
      : history.error ? null : <WorkspaceLoadState label="Loading client history…" onRetry={refresh} />}
  </div> : undefined;

  return <RecordLayout record={record}>
    <div className="grid min-w-0 gap-7" data-clients-ready={open ? undefined : ready}>
      <PageOnly><PageHeader title="Clients" description="Review each invitee’s scheduling history and booking details." actions={<PlainLink to="/app/bookings" search={() => ({})} className={buttonClassName("secondary")}>Bookings</PlainLink>} /></PageOnly>
      <IndexHead back={<RecordBack href={list} label="Clients" />} meta={listRead.data ? countOf(listRead.data.totalCount, "client") : undefined} />
      {listRead.error ? <WorkspaceLoadState error={listRead.error} onRetry={refresh} /> : null}
      <PageOnly>
        <p role="status" className="text-sm text-muted">{listRead.loading || listRead.error ? null : countOf(listRead.data?.totalCount ?? 0, "client")}</p>
        {listRead.data && listRead.data.totalCount > clientPageSize ? <nav aria-label="Client result pages" className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClassName("secondary")} disabled={page === 1} onClick={() => void router.navigate({ to: "/app/clients", search: page > 2 ? { clientPage: page - 1 } : {} })}>Previous page</button><span>Page {page}</span><button type="button" className={buttonClassName("secondary")} disabled={page * clientPageSize >= listRead.data.totalCount} onClick={() => void router.navigate({ to: "/app/clients", search: { clientPage: page + 1 } })}>Next page</button></nav> : null}
      </PageOnly>
      {listRead.loading ? <WorkspaceLoadState label="Loading clients…" onRetry={refresh} /> : null}
      <RecordRows className="min-w-0">
        {listRead.data?.clients.map(client => <RecordRow key={client.email} to="/app/clients/$email" params={{ email: client.email }} search={() => pageSearch} state={recordTrail(list)} row={client.email} list={list} current={open && client.email === (primary ?? email)}>
          <strong className="block break-words">{client.name || client.email}</strong>
          <span className={`mt-1 block text-sm text-muted ${open ? "truncate" : "break-all"}`}>{client.name ? `${client.email} · ` : ""}{client.bookingCount} booking{client.bookingCount === 1 ? "" : "s"}</span>
        </RecordRow>)}
        {listRead.data?.totalCount === 0 ? <p className="p-5 text-sm text-muted">Clients appear when an invitee books.</p> : null}
      </RecordRows>
    </div>
  </RecordLayout>;
}
