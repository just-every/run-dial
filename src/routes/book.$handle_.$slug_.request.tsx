import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { AlternativeRequestPage } from "../core/features/public-booking/ui/request-page";


export const Route = createFileRoute('/book/$handle_/$slug_/request' )({ component: withEditorLeaf(PublicRequestRoute) });
function PublicRequestRoute() { const { handle, slug } = Route.useParams(); return <AlternativeRequestPage handle={handle} slug={slug} />; }
