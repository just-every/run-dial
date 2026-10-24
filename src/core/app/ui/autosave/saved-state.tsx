import { Icon } from "../../../shared/drawing/icons";
import type { FieldState } from "./use-autosave";
import "./autosave.css";

/** The quiet "Saved" beside a field's label once its value has landed. Always present, so the change is announced. */
export function SavedMark({ state }: { state: FieldState }) {
  return <span className="autosave-saved" role="status">{state.saved ? <><Icon name="check" className="line-icon autosave-saved-icon" />Saved</> : null}</span>;
}

/**
 * A failed save, in one line under its field: the value stays in the field, the server's reason shows when it gave one, and
 * Retry sends the newest value again. Its id goes in the field's aria-describedby while it shows.
 */
export function SaveFailed({ id, state, what, choice = false, onRetry }: { id: string; state: FieldState; what: string; choice?: boolean; onRetry(): void }) {
  if (!state.failed) return null;
  return <p id={id} className="autosave-failed" role="alert">
    Couldn’t save {what}. {state.reason ?? (choice ? "Your choice is kept here." : "Your words are kept here.")}{" "}
    <button type="button" className="autosave-retry" data-autosave-attention onClick={onRetry}>Retry</button>
  </p>;
}
