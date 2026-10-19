import { Button, WarningMark } from "../../../app/ui/primitives";

export type Delivery = {
  id: string; kind: string; state: string; attempts: number;
  lastErrorCode: string | null; retryState: string | null;
  recipient: string | null; subject: string | null;
};

function deliveryLabel(kind: string) {
  switch (kind) {
    case "mail_send": return "Email";
    case "reminder": return "Reminder email";
    case "calendar_upsert": return "Calendar update";
    case "calendar_cancel": return "Calendar cancellation";
    default: throw new Error("Unknown delivery kind");
  }
}

function deliveryStatus(delivery: Delivery, state = delivery.state) {
  switch (state) {
    case "pending": return delivery.attempts > 0 ? "Retrying" : "Queued";
    case "processing": return "Processing";
    case "succeeded": return ["mail_send", "reminder"].includes(delivery.kind) ? "Sent" : "Completed";
    case "failed": return "Failed";
    case "suppressed": return "Not sent · calendar invitation";
    default: throw new Error("Unknown delivery state");
  }
}

export function DeliveryList({ deliveries, working, onRetry }: { deliveries: Delivery[]; working: boolean; onRetry(id: string): void }) {
  return <section aria-label="Deliveries">
    <h3 className="font-bold text-ink">Deliveries</h3>
    <p className="mt-2 text-sm text-muted">Sent means accepted by the mail provider.</p>
    {deliveries.some(delivery => delivery.state === "failed" && !delivery.retryState) ? <p className="mt-3 flex items-start gap-2 rounded-xl bg-gold-wash p-3 text-sm text-ink"><WarningMark />Check the provider connection in settings before retrying a failed delivery.</p> : null}
    {deliveries.length ? <ul aria-label="Delivery history" className="mt-4 grid gap-3">{deliveries.map(delivery => <li key={delivery.id} data-delivery-id={delivery.id} className="min-w-0 break-words rounded-xl border border-line-soft p-3.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-ink">{deliveryLabel(delivery.kind)}</strong><span className={delivery.state === "failed" ? "font-semibold text-danger" : "font-semibold text-soft"}>{deliveryStatus(delivery)}</span></div>
      {delivery.recipient ? <p className="mt-1 text-soft">To: {delivery.recipient}</p> : null}
      {delivery.subject ? <p className="mt-1 text-ink">{delivery.subject}</p> : null}
      {delivery.attempts > 0 ? <p className="mt-1 text-muted">Attempts: {delivery.attempts}</p> : null}
      {delivery.lastErrorCode ? <p className="mt-1 text-danger">Last failure: {delivery.lastErrorCode.replaceAll("_", " ")}</p> : null}
      {delivery.retryState ? <p className="mt-2 text-soft">Retry: {deliveryStatus({ ...delivery, attempts: 0 }, delivery.retryState).toLowerCase()}</p> : null}
      {delivery.state === "failed" && !delivery.retryState ? delivery.lastErrorCode === "mail_outcome_unknown" || delivery.lastErrorCode === "operator_mail_outcome_unknown"
        ? <p className="mt-2 text-soft">Check this delivery with the mail provider before sending again. Its outcome is unknown.</p>
        : <Button className="mt-3" variant="secondary" disabled={working || delivery.lastErrorCode === "operator_removed"} onClick={() => onRetry(delivery.id)}>Retry delivery</Button> : null}
    </li>)}</ul> : <p className="mt-3 text-sm text-muted">No deliveries recorded.</p>}
  </section>;
}
