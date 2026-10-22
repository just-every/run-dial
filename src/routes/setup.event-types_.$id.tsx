import { EventPaymentSettings } from "../core/features/payments/ui/event-payment-settings";
import { createFileRoute } from "@tanstack/react-router";
import { EventEditorPage } from "../core/features/event-types/ui/event-editor-page";


export const Route = createFileRoute('/setup/event-types_/$id' )({ codeSplitGroupings: [], component: EventEditorRoute });
function EventEditorRoute() { const { id } = Route.useParams(); return <EventEditorPage workspace="/setup" eventId={id} priceEditor={(id, durations) => <EventPaymentSettings eventId={id} durations={durations} />} />; }
