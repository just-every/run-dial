import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../../api/client";
import { recordId } from "../../../app/record-id";
import { useRecordRead } from "../../../app/use-record-read";
import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { noticeClassName } from "../../../app/ui/primitives";
import type { BookingRecord } from "../types";
import { BookingDetail } from "./booking-detail";

export type BookingRead = ReturnType<typeof useBookingRead>;

/** The booking at /app/bookings/<id>. An id that is not a booking's is a missing record, never a failed page. */
export function useBookingRead(id: string | undefined) {
  const [revision, setRevision] = useState(0);
  const latest = useRef(0), waiting = useRef<Array<{ revision: number; done(): void }>>([]);
  const valid = recordId(id);
  const read = useRecordRead<BookingRecord>(valid && `/api/app/bookings/${valid}`, revision);
  useEffect(() => {
    waiting.current = waiting.current.filter(entry => { if (entry.revision > read.settled) return true; entry.done(); return false; });
  }, [read.settled]);
  /** Read the booking again. It resolves once the new answer is in, so an action stays working until its result shows. */
  const reload = () => new Promise<void>(done => { latest.current += 1; waiting.current.push({ revision: latest.current, done }); setRevision(latest.current); });
  return { id, ...read, missing: Boolean(id) && (!valid || read.missing), reload };
}

/**
 * The one booking record (OPER-004), whichever door opened it: a Bookings row, a calendar block, a client's history or a
 * package's redemption. Its actions and their focused notices are wired once, here; the index beside it reloads after each.
 */
export function BookingRecordPage({ read, back, onIndexChanged, onErased }: { read: BookingRead; back: ReactNode; onIndexChanged(): void; onErased(notice: string, id: string): void }) {
  const [notice, setNotice] = useState("");
  const noticeElement = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  useEffect(() => { if (notice && focusNotice.current) { noticeElement.current?.focus(); focusNotice.current = false; } }, [notice]);
  async function changed(message = "", focus = false) {
    focusNotice.current = focus; setNotice(message);
    onIndexChanged();
    await read.reload();
  }
  async function cancel(id: string) {
    const reason = window.prompt("Reason for cancellation (optional)");
    if (reason === null) return;
    const response = await api.api.app.bookings[":id"].cancel.$post({ param: { id }, json: reason ? { reason } : {} });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    await changed("Booking cancelled and delivery updates queued.", true);
  }
  async function attendance(id: string, status: "attended" | "no_show", note: string) {
    const response = await api.api.app.bookings[":id"].attendance.$post({ param: { id }, json: { status, note } });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    await changed(status === "attended" ? "Marked attended." : "Marked no-show.", true);
  }
  return <div className="grid min-w-0 gap-5">
    {back}
    {notice ? <p ref={noticeElement} tabIndex={-1} role="status" aria-label="Booking update" className={noticeClassName("success", "font-semibold")}>{notice}</p> : null}
    {read.error ? <WorkspaceLoadState error={read.error} onRetry={read.reload} /> : null}
    {read.data ? <BookingDetail key={read.data.id} booking={read.data} onChanged={async message => changed(message)} onCancel={cancel} onAttendance={attendance} onErased={onErased} />
      : read.error ? null : <WorkspaceLoadState label="Loading booking…" onRetry={read.reload} />}
  </div>;
}
