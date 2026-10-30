import { Icon } from "../../../shared/drawing/icons";
import type { FieldState } from "./use-autosave";
import "./autosave.css";

/** The quiet "Saved" beside a field's label once its value has landed. Always present, so the change is announced. */
export function SavedMark({ state }: { state: FieldState }) {
  return <span className="autosave-saved" role="status">{state.saved ? <><Icon name="check" className="line-icon autosave-saved-icon" />Saved</> : null}</span>;
}

/**
 * A failed save, in one line under its field: the value stays in the field, the server's reason shows when it gave one, and
 * Retry sends the newest value again. Its id goes in the field's aria-describedby while it shows. A `problem` is a value the page
 * will not send: one plain sentence in its place, with nothing to retry.
 */
export function SaveFailed({ id, state, what, choice = false, problem, onRetry }: { id: string; state: FieldState; what: string; choice?: boolean; problem?: string; onRetry(): void }) {
  if (problem) return <p id={id} className="autosave-failed" role="alert" tabIndex={-1} data-autosave-attention>{problem}</p>;
  if (!state.failed) return null;
  return <p id={id} className="autosave-failed" role="alert">
    Couldn’t save {what}. {state.reason ?? (choice ? "Your choice is kept here." : "Your words are kept here.")}{" "}
    <button type="button" className="autosave-retry" data-autosave-attention onClick={onRetry}>Retry</button>
  </p>;
}
