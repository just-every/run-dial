import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PublicEventPage } from "../core/features/public-booking/ui/event-page";


export const Route = createFileRoute('/embed/$handle/$slug' )({ component: withEditorLeaf(EmbeddedEventRoute) });
function EmbeddedEventRoute() { const { handle, slug } = Route.useParams(); return <PublicEventPage handle={handle} slug={slug} embedded />; }
