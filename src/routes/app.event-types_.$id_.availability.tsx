import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { EventHoursPage } from "../core/features/availability/ui/event-hours";


export const Route = createFileRoute('/app/event-types_/$id_/availability' )({ component: withEditorLeaf(EventAvailabilityRoute) });
function EventAvailabilityRoute() { const { id } = Route.useParams(); return <EventHoursPage eventId={id} />; }
