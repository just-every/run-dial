import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PublicEventPreviewPage } from "../core/features/public-booking/ui/event-page";


export const Route = createFileRoute('/app/event-types_/$id_/preview' )({ component: withEditorLeaf(EventPreviewRoute) });
function EventPreviewRoute() { const { id } = Route.useParams(); return <PublicEventPreviewPage eventId={id} />; }
