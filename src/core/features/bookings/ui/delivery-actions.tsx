import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, WarningMark, noticeClassName } from "../../../app/ui/primitives";
import { Icon } from "../../../shared/drawing/icons";

type Delivery = { id: string; kind: string; state: string; attempts: number; lastErrorCode: string | null; retryState: string | null };
type Cleanup = { completedAt: string | null; lastErrorCode: string | null };
function requiresProviderReview(delivery: Delivery) { return delivery.lastErrorCode === "mail_outcome_unknown" || delivery.lastErrorCode === "operator_mail_outcome_unknown"; }
function retryNotice(state: string) { return state === "succeeded" ? "This retry has already completed." : state === "failed" ? "This retry also failed. Review the latest failed delivery below." : "Retry queued. Provider delivery will be checked again."; }

export function DeliveryActions({ bookingId, onErased }: { bookingId: string; onErased: (notice: string, id: string) => void }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  async function load() { const response = await api.api.app.bookings[":id"].deliveries.$get({ param: { id: bookingId } }); if (response.ok) setDeliveries(await response.json()); }
  useEffect(() => { void load(); }, [bookingId]);
  async function retry(deliveryId: string) {
    setWorking(true);
    try {
      const response = await api.api.app.bookings[":id"].deliveries[":deliveryId"].retry.$post({ param: { id: bookingId, deliveryId } });
      setNotice(response.ok ? retryNotice((await response.json()).state) : await errorMessage(response));
      await load();
    } catch { setNotice("Delivery could not be checked. Refresh and try again."); } finally { setWorking(false); }
  }
  async function erase() {
    if (!window.confirm("Erase this booking's invitee details, answers, links and delivery history? Calendar cleanup is queued separately and can require recovery.")) return;
    setWorking(true);
    try {
      const response = await api.api.app.bookings[":id"].$delete({ param: { id: bookingId } });
      if (!response.ok) { setNotice(await errorMessage(response)); return; }
      onErased("Local booking data erased. Calendar cleanup is tracked below.", bookingId);
    } catch { setNotice("Erasure could not be checked. Refresh to check the booking before trying again."); } finally { setWorking(false); }
  }
  const failed = deliveries.filter((delivery) => delivery.state === "failed" && !delivery.retryState);
  return <div className="mt-6 border-t border-line-soft pt-5">{failed.length ? <div className="grid gap-3 rounded-[14px] border border-gold-line bg-gold-wash p-4 text-ink"><h3 className="flex items-center gap-2.5 font-bold"><WarningMark />Delivery needs attention</h3><p className="text-sm">Check the provider connection in settings, then retry the failed delivery.</p>{failed.map((delivery) => <div className="flex flex-wrap items-center justify-between gap-3 text-sm" key={delivery.id}><span>{delivery.kind.replaceAll("_", " ")} · {delivery.lastErrorCode?.replaceAll("_", " ")} · {delivery.attempts} attempts</span>{requiresProviderReview(delivery) ? <span className="text-sm">Check this delivery with the mail provider before sending again. Its outcome is unknown.</span> : <Button variant="secondary" disabled={working || delivery.lastErrorCode === "operator_removed"} onClick={() => void retry(delivery.id)}>Retry delivery</Button>}</div>)}</div> : null}{notice ? <p role="status" className={noticeClassName("success", "my-3")}>{notice}</p> : null}<Button className="mt-4" variant="quiet" disabled={working} onClick={() => void erase()}><Icon name="file" className="line-icon h-5 w-5" />Erase invitee data</Button></div>;
}

/** Cleanup references contain no invitee details and survive an operator reload. */
export function ErasureRecovery({ bookingId }: { bookingId: string }) {
  const [cleanup, setCleanup] = useState<Cleanup>();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  async function load() {
    const [status, jobs] = await Promise.all([api.api.app.erasures[":id"].$get({ param: { id: bookingId } }), api.api.app.erasures[":id"].deliveries.$get({ param: { id: bookingId } })]);
    if (status.ok) setCleanup(await status.json()); else setNotice(await errorMessage(status));
    if (jobs.ok) setDeliveries(await jobs.json());
  }
  useEffect(() => { void load().catch(() => setNotice("Cleanup could not be checked. Try refreshing its status.")); }, [bookingId]);
  async function retry(id: string) {
    setWorking(true);
    try { const response = await api.api.app.erasures[":id"].deliveries[":deliveryId"].retry.$post({ param: { id: bookingId, deliveryId: id } }); setNotice(response.ok ? retryNotice((await response.json()).state) : await errorMessage(response)); await load(); }
    catch { setNotice("Cleanup could not be checked. Try refreshing its status."); } finally { setWorking(false); }
  }
  return <Card className="p-5 sm:p-6"><h2 className="text-[19px] font-[750] tracking-[-.01em]">Erasure cleanup</h2><p className="mt-2 text-sm text-soft">Local invitee data and booking links have been erased.</p><p className="mt-2 text-sm" role="status">{cleanup?.completedAt ? "Calendar cleanup completed." : cleanup?.lastErrorCode ? "Calendar cleanup needs attention." : "Calendar cleanup pending."}</p>{deliveries.filter((delivery) => delivery.state === "failed" && !delivery.retryState).map((delivery) => <div key={delivery.id} className="mt-3 flex flex-wrap items-center gap-3 text-sm"><span>{delivery.lastErrorCode?.replaceAll("_", " ")}</span><Button variant="secondary" disabled={working} onClick={() => void retry(delivery.id)}>Retry cleanup</Button></div>)}{notice ? <p role="status" className={noticeClassName("success", "mt-3")}>{notice}</p> : null}<Button className="mt-4" variant="secondary" disabled={working} onClick={() => void load().catch(() => setNotice("Cleanup could not be checked. Try refreshing its status."))}>Refresh cleanup status</Button></Card>;
}
