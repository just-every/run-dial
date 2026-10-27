import { SaveFailed, SavedMark } from "../../../app/ui/autosave/saved-state";
import type { FieldState } from "../../../app/ui/autosave/use-autosave";
import type { EventDetailsInput } from "../repository";

export type EventFieldSaving = {
  state?(key: keyof EventDetailsInput): FieldState;
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
  return state ? <SaveFailed id={id} state={state} what={what} onRetry={() => saving.onRetry?.()} /> : null;
}
