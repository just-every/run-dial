import { SaveFailed, SavedMark } from "../../../app/ui/autosave/saved-state";
import type { FieldState } from "../../../app/ui/autosave/use-autosave";
import type { EventDetailsInput } from "../repository";

export type EventFieldSaving = {
  validation?(key: keyof EventDetailsInput): string | undefined;
  state?(key: keyof EventDetailsInput): FieldState;
  onFlush?(): void;
  onLeave?(key: keyof EventDetailsInput): void;
  onRetry?(): void;
  choose?<K extends keyof EventDetailsInput>(key: K, value: EventDetailsInput[K]): void;
};

export function FieldSaved({ saving, field }: { saving: EventFieldSaving; field: keyof EventDetailsInput }) {
  const state = saving.state?.(field);
  return state ? <SavedMark state={state} /> : null;
}

export function FieldFailed({ saving, field, id, what }: { saving: EventFieldSaving; field: keyof EventDetailsInput; id: string; what: string }) {
  const state = saving.state?.(field);
  const message = saving.validation?.(field);
  if (message) return <p id={id} className="autosave-failed" role="alert" tabIndex={-1} data-autosave-attention>{message}</p>;
  return state ? <SaveFailed id={id} state={state} what={what} onRetry={() => saving.onRetry?.()} /> : null;
}
