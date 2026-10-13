import { createFileRoute } from "@tanstack/react-router";
import { EventEditorPage } from "../core/features/event-types/ui/event-editor-page";


export const Route = createFileRoute('/setup/event-types_/$id' )({ component: EventEditorRoute });
function EventEditorRoute() { const { id } = Route.useParams(); return <EventEditorPage workspace="/setup" eventId={id} />; }
