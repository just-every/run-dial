import { useState } from "react";
import { api, errorMessage } from "../../../api/client";
import { Button, noticeClassName } from "../../../app/ui/primitives";
import { formatUsd } from "../../../shared/event-price";
import { creditLabel, type AppointmentProduct } from "./entitlement-summary";

/** A product with purchases keeps its place in the catalog, so only unsold ones offer Remove. */
export function AppointmentProductList({ eventId, products, onEdit, onChanged }: { eventId: string; products: AppointmentProduct[]; onEdit(product: AppointmentProduct): void; onChanged(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  async function remove(product: AppointmentProduct) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.api.app["event-types"][":id"].products[":product"].$delete({ param: { id: eventId, product: product.id } });
      if (!response.ok) { setError(await errorMessage(response)); return; }
      setNotice(`Removed ${product.name}.`); onChanged();
    } catch { setError("The result could not be received. Refresh balances to check the catalog."); }
    finally { setBusy(false); }
  }
  return <>
    {products.length ? <ul aria-label="Appointment product catalog" className="mt-5 grid gap-2">{products.map(product => <li className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-card p-3 text-sm leading-6" key={product.id}>
      <div className="min-w-0"><strong>{product.name}</strong><p>{creditLabel(product.kind)} · {formatUsd(product.amountCents)}{product.kind === "membership" ? " monthly" : ""}{product.kind !== "gift" ? ` · ${product.sessions} sessions` : ""}</p><p>{product.kind === "membership" ? "Balance renews with each paid period" : `Valid for ${product.validityDays} days`}</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={busy} aria-label={`Edit ${product.name}`} onClick={() => onEdit(product)}>Edit</Button>{product.sold ? null : <Button type="button" variant="quiet" disabled={busy} aria-label={`Remove ${product.name}`} onClick={() => void remove(product)}>Remove</Button>}</div>
    </li>)}</ul> : null}
    {error ? <p role="alert" className={noticeClassName("error", "mt-3")}>{error}</p> : null}
    {notice ? <p role="status" className={noticeClassName("success", "mt-3")}>{notice}</p> : null}
  </>;
}
