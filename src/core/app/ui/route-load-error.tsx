import { Link, useMatch, useRouter, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { boundedWorkspaceRead, clearWorkspaceReads, retryWorkspaceReads, workspaceReadTimeout } from "../workspace-reads";
import { useHydrated } from "../use-hydrated";
import { Button, buttonClassName } from "./primitives";
import loadStyles from "./route-load-error.css?inline";

function rejectedModule(error: unknown) {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError|Loading chunk .+ failed/i.test(error.message);
}

/** A pending or failed first read always has one bounded, actionable recovery state. */
export function WorkspaceLoadState({ error, onRetry, label = "Loading…" }: { error?: unknown; onRetry?: () => void; label?: string }) {
  const router = useRouter();
  const href = useRouterState({ select: state => state.location.pathname + state.location.searchStr });
  const hydrated = useHydrated();
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loading = retrying || !error && !retryError;
  const failed = timedOut || !loading;

  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => setTimedOut(true), workspaceReadTimeout);
    return () => clearTimeout(timeout);
  }, [loading, attempt]);

  async function retry() {
    if (retrying) return;
    clearWorkspaceReads();
    setTimedOut(false);
    setRetryError(false);
    setRetrying(true);
    setAttempt(value => value + 1);
    try {
      if (onRetry) await boundedWorkspaceRead(() => onRetry());
      else {
        const revision = retryWorkspaceReads();
        // MatchInner memoizes this callback's result. Change its identity only on Retry.
        router.update({ defaultRemountDeps: () => revision });
        await boundedWorkspaceRead(() => router.invalidate({ sync: true, forcePending: true }));
      }
    } catch {
      setRetryError(true);
    } finally {
      setRetrying(false);
    }
  }

  return <div className={`workspace-load-state ${failed ? "workspace-load-failed" : "workspace-load-waiting"}`} key={attempt}>
    <style>{loadStyles}</style>
    <p role="status" className="workspace-load-pending text-sm text-soft">{label}</p>
    <div className="workspace-load-failure">
      <p role="alert" className="text-sm text-soft">This page could not load.</p>
      {hydrated
        ? <Button type="button" variant="secondary" onClick={() => void retry()}>Retry</Button>
        : <a className={buttonClassName("secondary")} href={href}>Retry</a>}
    </div>
  </div>;
}

const navigation = [["Overview", "/app"], ["Bookings", "/app/bookings"], ["Event types", "/app/event-types"], ["Availability", "/app/availability"], ["Requests", "/app/requests"], ["Profile", "/app/profile"], ["Settings", "/app/settings"]] as const;

/** The app parent can fail before AppShell exists; keep its recovery inside app chrome. */
function RouteLoadFrame({ children }: { children: ReactNode }) {
  const match = useMatch({ strict: false });
  const pathname = useRouterState({ select: state => state.location.pathname });
  if (!/^\/app(?:\/|$)/.test(pathname) || match.routeId !== "/app" && match.routeId !== "__root__") return children;
  return <div className="min-h-screen bg-paper text-ink lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
    <aside className="border-b border-line bg-sidebar px-5 py-6 lg:min-h-screen lg:border-r lg:border-b-0">
      <Link to="/app" className="mb-8 inline-flex text-[30px] font-extrabold leading-none tracking-[-.02em]"><span data-rer-name>Dial</span></Link>
      <nav aria-label="Operator navigation" className="flex flex-wrap gap-1 lg:grid">
        {navigation.map(([label, to]) => <Link key={to} to={to} className="flex min-h-11 items-center rounded-[14px] px-3.5 text-[15px] font-[550] text-soft hover:bg-row">{label}</Link>)}
      </nav>
    </aside>
    <main className="mx-auto w-full max-w-[1400px] px-4 py-7 sm:px-7 sm:py-10 lg:px-10">{children}</main>
  </div>;
}

export function RouteLoadPending() {
  return <RouteLoadFrame><WorkspaceLoadState /></RouteLoadFrame>;
}

/** Keep the document Retry outside controls that correctly remain inert until hydration. */
export function WorkspaceBootstrapRecovery() {
  return <div className="workspace-bootstrap-recovery"><WorkspaceLoadState /></div>;
}

/** Only a rejected browser module import needs a fresh document/module cache. */
export function RouteLoadError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  async function retry() {
    clearWorkspaceReads();
    if (rejectedModule(error)) {
      window.location.reload();
      return;
    }
    const revision = retryWorkspaceReads();
    router.update({ defaultRemountDeps: () => revision });
    await router.invalidate({ sync: true, forcePending: true });
    reset?.();
  }
  return <RouteLoadFrame><WorkspaceLoadState error={error ?? true} onRetry={retry} /></RouteLoadFrame>;
}
