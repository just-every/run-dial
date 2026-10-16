import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { AvailabilityPage } from "../core/features/event-types/ui/availability-page";


export const Route = createFileRoute('/app/event-types_/$id_/availability' )({ codeSplitGroupings: [], component: withEditorLeaf(EventAvailabilityRoute) });
function EventAvailabilityRoute() { const { id } = Route.useParams(); return <AvailabilityPage eventId={id} />; }
