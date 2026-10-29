import { EventPaymentSettings } from "../core/features/payments/ui/event-payment-settings";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { EventPage } from "../core/features/event-types/ui/event-page";

export const Route = createFileRoute('/setup/event-types_/$id')({ codeSplitGroupings: [], component: EventRoute });
function EventRoute() { const { id } = Route.useParams(); return <EventPage paymentEditor={props => <EventPaymentSettings {...props} workspace="/setup" />} eventId={id} workspace="/setup"><Outlet /></EventPage>; }
