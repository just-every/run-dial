import { createLink, useRouter, useRouterState, type HistoryState } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from "react";

/**
 * Records chosen from a list open at their own paths (OC2, DW6). Without a record the list is the page. With one, from 1280 px
 * the list narrows into a 300 px index that stays in view beside the record, which is the page's one title; under 1280 px the
 * record is the page, and the list stays mounted, hidden, so Back finds it where it was.
 */

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The list address a record was opened from, and how many record pages have been opened from it since. */
    recordList?: string;
    recordDepth?: number;
  }
}

/** "‹ Requests": the same quiet link as the event page's "‹ Event types", a 44 px target wherever the record is its own page (under 1280 px). */
export const backLinkClassName = "inline-flex min-h-11 xl:min-h-6 w-fit items-center text-sm font-semibold underline-offset-4 hover:underline";

const RecordOpen = createContext(false);
export function useRecordOpen() { return useContext(RecordOpen); }

/** "2 requests", "1 poll": what a list holds, in its index's head. */
export function countOf(count: number, noun: string) { return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`; }

/** One list address however its search string is spelled. */
export function listKey(href: string) {
  const url = new URL(href, "http://dial.invalid");
  url.searchParams.sort();
  return url.pathname + url.search;
}

/** The history state a row's link writes: the list it belongs to, one record deeper than the page it was picked on. */
export function recordTrail(list: string) {
  const key = listKey(list);
  return (previous: HistoryState): HistoryState => ({ recordList: key, recordDepth: previous.recordList === key ? (previous.recordDepth ?? 0) + 1 : 1 });
}

let returnRow: { list: string; id: string } | undefined;
/** The row a record was opened from: its list focuses it again when it next shows without a record. */
export function rememberRow(list: string, id: string) { returnRow = { list: listKey(list), id }; }

/** Back on the list, focus goes to the row that was opened, after the router has put the list's scroll back. A page that only
 * shows a record opened from elsewhere (a client's booking) passes no list. The row is taken only when it is focused, so a
 * mount that is undone before its frame (a remount) leaves it for the next. */
export function useReturnFocus(list: string | undefined, open: boolean) {
  useEffect(() => {
    if (open || !list || !returnRow || returnRow.list !== listKey(list)) return;
    const target = returnRow;
    const frame = requestAnimationFrame(() => {
      if (returnRow !== target) return;
      returnRow = undefined;
      document.querySelector<HTMLElement>(`[data-record-row="${CSS.escape(target.id)}"]`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [list, open]);
}

/** Scroll the index alone (never the window) so an element shows under its head: at the top for "start", just in view for "nearest". */
function revealInIndex(index: HTMLElement | null, align?: "start" | "nearest") {
  const target = index?.querySelector<HTMLElement>("[data-record-reveal]");
  if (!index || !target || !index.getClientRects().length || getComputedStyle(index).overflowY !== "auto") return;
  const head = index.querySelector<HTMLElement>("[data-records-index-head]")?.offsetHeight ?? 0;
  const box = index.getBoundingClientRect(), item = target.getBoundingClientRect();
  const above = item.top - box.top - head - 12, below = item.bottom - box.bottom + 24;
  if ((align ?? target.dataset.recordReveal) === "start" || above < 0) index.scrollTop += above;
  else if (below > 0) index.scrollTop += Math.min(below, above);
}

/** `revealKey` changes when the open row moves inside the index (a rescheduled booking's new day): it is brought into view. */
export function RecordLayout({ record, revealKey, children }: { record?: ReactNode; revealKey?: string; children: ReactNode }) {
  const open = record !== undefined;
  const index = useRef<HTMLDivElement>(null);
  const shown = useRef<{ open: boolean; revealKey?: string }>({ open: false });
  useEffect(() => {
    // A deep link or a pick from the full list opens the index at the open row; a pick inside the index keeps its scroll.
    if (open && !shown.current.open) revealInIndex(index.current);
    else if (open && revealKey !== shown.current.revealKey) revealInIndex(index.current, "nearest");
    shown.current = { open, revealKey };
  }, [open, revealKey]);
  return <RecordOpen.Provider value={open}>
    <div className={open ? "min-w-0 xl:-my-10 xl:grid xl:grid-cols-[300px_minmax(0,1fr)]" : undefined}>
      <div ref={index} data-scroll-restoration-id="records-list" data-records-index={open || undefined} className={open ? "max-xl:hidden xl:sticky xl:top-0 xl:h-screen xl:overflow-y-auto xl:border-r xl:border-line-soft xl:pr-5 xl:pb-10" : undefined}>{children}</div>
      {open ? <div className="min-w-0 xl:py-10 xl:pl-10">{record}</div> : null}
    </div>
  </RecordOpen.Provider>;
}

/** What only the full list page shows. It stays mounted, hidden, while a record is open. */
export function PageOnly({ children }: { children: ReactNode }) {
  return <div className={useRecordOpen() ? "hidden" : "contents"}>{children}</div>;
}

/** The index's head beside an open record: the way back to the list and what it holds. It stays at the index's top. */
export function IndexHead({ back, meta, children }: { back: ReactNode; meta?: string; children?: ReactNode }) {
  if (!useRecordOpen()) return null;
  return <div data-records-index-head className="sticky top-0 z-[1] grid min-w-0 gap-2 bg-white pt-10 pb-1">
    <div className="flex min-w-0 items-center justify-between gap-3">{back}{meta ? <span className="shrink-0 text-sm text-muted">{meta}</span> : null}</div>
    {children}
  </div>;
}

/** The list's rows: a card across the full page, a plain stack in the index. */
export function RecordRows({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={useRecordOpen() ? `grid min-w-0 gap-1 ${className}` : `divide-y divide-line-soft overflow-hidden rounded-[18px] bg-card shadow-panel sm:rounded-[22px] ${className}`}>{children}</section>;
}

type RowProps = ComponentPropsWithRef<"a"> & { row: string; list: string; current?: boolean };
/** A row is a link to its record's path. The open row is filled and says aria-current="true"; only the menu marks the page. */
export const RecordRow = createLink(function RecordRowAnchor({ row, list, current = false, className = "", onClick, href, children, ...props }: RowProps) {
  const open = useRecordOpen();
  return <a {...props} href={href} data-record-row={row} data-record-reveal={current ? "nearest" : undefined} aria-current={current ? "true" : undefined}
    className={`dial-list-row block w-full min-w-0 text-left transition-colors focus-visible:outline-offset-[-3px] ${open ? "rounded-[14px] px-4 py-3" : "px-5 py-4"} ${current ? "bg-gold-wash" : "hover:bg-row"} ${className}`}
    onClick={event => { rememberRow(list, row); onClick?.(event); }}>{children}</a>;
});

/**
 * Back to the record's list. When the list is where this record was opened from, it steps back through history, so the list
 * returns with its search string, its scroll and focus on the row; otherwise it opens the list's address.
 */
export function RecordBack({ href, label, className = "" }: { href: string; label: string; className?: string }) {
  const router = useRouter();
  const trail = useRouterState({ select: state => state.location.state });
  return <a href={href} className={`${backLinkClassName} ${className}`} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (trail.recordDepth && trail.recordList === listKey(href)) router.history.go(-trail.recordDepth);
    else void router.navigate({ href });
  }}>‹ {label}</a>;
}
