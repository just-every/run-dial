import { EventPaymentSettings } from "../core/features/payments/ui/event-payment-settings";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { EventEditorPage } from "../core/features/event-types/ui/event-editor-page";


export const Route = createFileRoute('/app/event-types_/new' )({ codeSplitGroupings: [], component: withEditorLeaf(() => <EventEditorPage priceEditor={(id, durations) => <EventPaymentSettings eventId={id} durations={durations} />} />) });

