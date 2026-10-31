import { WorkspaceLoadState } from "../../../app/ui/route-load-error";
import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { noticeClassName } from "../../../app/ui/primitives";
import { BookingDetail } from "../../bookings/client";
import type { BookingRecord } from "../../bookings/client";
import { useClientRead } from "./use-client-read";

/** The ordinary OPER-004 record and actions, selected by its exact ID. */
export function ClientBookingRecord({ id, onChanged, onErased }: { id: string; onChanged(): void; onErased(): void }) {
  const [revision, setRevision] = useState(0), [notice, setNotice] = useState("");
  const { data, error, loading } = useClientRead<BookingRecord>(`/api/app/bookings/${encodeURIComponent(id)}`, revision);
  async function changed(message = "") { setNotice(message); setRevision(value => value + 1); onChanged(); }
  async function cancel(bookingId: string) {
    const reason = window.prompt("Reason for cancellation (optional)");
    if (reason === null) return;
    const response = await api.api.app.bookings[":id"].cancel.$post({ param: { id: bookingId }, json: reason ? { reason } : {} });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    await changed("Booking cancelled and delivery updates queued.");
  }
  async function attendance(bookingId: string, status: "attended" | "no_show") {
    const response = await api.api.app.bookings[":id"].attendance.$post({ param: { id: bookingId }, json: { status, note: "" } });
    if (!response.ok) { setNotice(await errorMessage(response)); return; }
    await changed(status === "attended" ? "Marked attended." : "Marked no-show.");
  }
  return <section aria-label="Selected client booking" className="grid min-w-0 gap-4">
    {notice ? <p role="status" className={noticeClassName("success")}>{notice}</p> : null}
    {error ? <WorkspaceLoadState error={error} onRetry={changed} /> : null}
    {loading ? <WorkspaceLoadState label="Loading booking record…" onRetry={changed} /> : data ? <BookingDetail key={data.id} booking={data} onChanged={changed} onCancel={cancel} onAttendance={attendance} onErased={() => { onChanged(); onErased(); }} /> : null}
  </section>;
}
