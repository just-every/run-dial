import { createFileRoute } from "@tanstack/react-router";
import { EventHoursPage } from "../core/features/availability/ui/event-hours";


export const Route = createFileRoute('/setup/event-types_/$id_/availability' )({ component: EventAvailabilityRoute });
function EventAvailabilityRoute() { const { id } = Route.useParams(); return <EventHoursPage workspace="/setup" eventId={id} />; }
