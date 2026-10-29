import { EventPaymentSettings } from "../core/features/payments/ui/event-payment-settings";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { EventPage } from "../core/features/event-types/ui/event-page";

export const Route = createFileRoute('/app/event-types_/$id')({ codeSplitGroupings: [], component: withEditorLeaf(EventRoute) });
function EventRoute() { const { id } = Route.useParams(); return <EventPage paymentEditor={props => <EventPaymentSettings {...props} />} eventId={id}><Outlet /></EventPage>; }
