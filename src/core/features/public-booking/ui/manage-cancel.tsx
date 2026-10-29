import { useEffect, useRef, useState } from "react";
import { cancelPrompt } from "./pay-step";
import type { PaymentSummaryView } from "./types";

export function ManageCancel({ payment, disabled, onConfirm, onKeep }: { payment?: PaymentSummaryView; disabled: boolean; onConfirm(reason: string): void; onKeep(): void }) {
  const [reason, setReason] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <section className="mt-5" aria-label="Cancel booking">
    <p>{cancelPrompt(payment)}</p>
    <label className="pb-manage-reason">Reason (optional)<textarea ref={input} disabled={disabled} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="pb-request-actions"><button type="button" className="pb-primary-button" disabled={disabled} onClick={() => onConfirm(reason)}>Confirm cancellation</button><button type="button" className="pb-secondary-button" disabled={disabled} onClick={onKeep}>Keep booking</button></div>
  </section>;
}
