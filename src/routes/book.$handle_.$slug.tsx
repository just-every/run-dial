import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PublicEventPage } from "../core/features/public-booking/ui/event-page";


export const Route = createFileRoute('/book/$handle_/$slug' )({ component: withEditorLeaf(PublicEventRoute) });
function PublicEventRoute() { const { handle, slug } = Route.useParams(); return <PublicEventPage handle={handle} slug={slug} />; }
