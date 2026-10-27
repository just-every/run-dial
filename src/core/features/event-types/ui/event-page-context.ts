import { createContext, useContext, type ReactNode } from "react";
import type { EventPrice } from "../../../shared/event-price";
import type { PaymentTerms } from "../../../shared/payment-terms";
import type { useAutosave } from "../../../app/ui/autosave/use-autosave";
import type { EventDetailsInput, EventTypeRecord } from "../repository";

export type EventDetailsSave = ReturnType<typeof useAutosave<EventDetailsInput>>;
export type EventPaymentEditorProps = { eventId: string; durations: number[]; price: EventPrice; terms: PaymentTerms; eventTitle: string; onSaved(): void };
export type EventPaymentEditor = (props: EventPaymentEditorProps) => ReactNode;
export type EventPageState = {
  paymentEditor: EventPaymentEditor;
  event: EventTypeRecord;
  details: EventDetailsSave;
  workspace: "/app" | "/setup";
  hostName: string;
  hostTimezone: string;
  onSaved(): void;
};
export const EventPageContext = createContext<EventPageState | undefined>(undefined);
export function useEventPage() {
  const page = useContext(EventPageContext);
  if (!page) throw new Error("Event settings need their event page.");
  return page;
}
