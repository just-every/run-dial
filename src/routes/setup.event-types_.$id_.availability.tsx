import { createFileRoute } from "@tanstack/react-router";
import { AvailabilityPage } from "../core/features/event-types/ui/availability-page";


export const Route = createFileRoute('/setup/event-types_/$id_/availability' )({ component: EventAvailabilityRoute });
function EventAvailabilityRoute() { const { id } = Route.useParams(); return <AvailabilityPage workspace="/setup" eventId={id} />; }
