import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { AlternativeRequestPage } from "../core/features/public-booking/ui/request-page";


export const Route = createFileRoute('/embed/$handle/$slug_/request' )({ component: withEditorLeaf(EmbeddedRequestRoute) });
function EmbeddedRequestRoute() { const { handle, slug } = Route.useParams(); return <AlternativeRequestPage handle={handle} slug={slug} embedded />; }
