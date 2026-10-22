import { GuestSettings } from "../core/features/event-types/ui/guest-settings";
import { EventPaymentSettings } from "../core/features/payments/ui/event-payment-settings";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { EventEditorPage } from "../core/features/event-types/ui/event-editor-page";


export const Route = createFileRoute('/app/event-types_/$id' )({ codeSplitGroupings: [], component: withEditorLeaf(EventEditorRoute) });
function EventEditorRoute() { const { id } = Route.useParams(); return <EventEditorPage eventId={id} priceEditor={(id, durations) => <><EventPaymentSettings eventId={id} durations={durations} /><GuestSettings eventId={id} /></>} />; }
