import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, Card, noticeClassName } from "../../../app/ui/primitives";
import { DeliveryList, type Delivery } from "./delivery-list";
import { Icon } from "../../../shared/drawing/icons";

type Cleanup = { completedAt: string | null; lastErrorCode: string | null };
function retryNotice(state: string) { return state === "succeeded" ? "This retry has already completed." : state === "failed" ? "This retry also failed. Review the latest failed delivery below." : "Retry queued. Provider delivery will be checked again."; }

export function useBookingDeliveries({ bookingId, onErased }: { bookingId: string; onErased: (notice: string, id: string) => void }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>();
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState("");
  async function load() {
    try {
      const response = await api.api.app.bookings[":id"].deliveries.$get({ param: { id: bookingId } });
      if (!response.ok) throw new Error(await errorMessage(response));
      setDeliveries(await response.json()); setLoadError(""); return true;
    } catch { setLoadError("Delivery status could not be loaded. Refresh to try again."); return false; }
  }
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
  const content = <div className="mt-6 border-t border-line-soft pt-5">
    {deliveries ? <DeliveryList deliveries={deliveries} working={working} onRetry={id => void retry(id)} /> : !loadError ? <p className="text-sm text-muted">Loading deliveries…</p> : null}
    {loadError ? <p role="alert" className={noticeClassName("error", "my-3")}>{loadError}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "my-3")}>{notice}</p> : null}
  </div>;
  const actions = <>
    <Button variant="secondary" disabled={working} onClick={() => { setNotice(""); void load().then(updated => { if (updated) setNotice("Updated"); }); }}>Refresh deliveries</Button>
    <Button variant="quiet" disabled={working} onClick={() => void erase()}><Icon name="file" className="line-icon h-5 w-5" />Erase invitee data</Button>
  </>;
  return { content, actions };
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
