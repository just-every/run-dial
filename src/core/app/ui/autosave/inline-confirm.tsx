import { Button } from "../primitives";
import "./autosave.css";

/**
 * The one-step confirm for a change that reaches outside (a price, an address, a time zone). It opens under its field, never
 * as a dialog: `action` keeps the new value and `keep` puts the old one back, for example "Charge $150" and "Keep it free".
 */
export function InlineConfirm({ question, detail, action, keep, onAction, onKeep }: { question: string; detail?: string; action: string; keep: string; onAction(): void; onKeep(): void }) {
  return <div className="autosave-confirm" role="group" aria-label={question}>
    <p className="autosave-confirm-text">{question}{detail ? ` ${detail}` : null}</p>
    <div className="autosave-confirm-actions">
      <Button type="button" data-autosave-attention onClick={onAction}>{action}</Button>
      <Button type="button" variant="secondary" onClick={onKeep}>{keep}</Button>
    </div>
  </div>;
}
