import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PublicProfilePage } from "../core/features/public-booking/ui/profile-page";


export const Route = createFileRoute('/book/$handle' )({ component: withEditorLeaf(PublicProfileRoute) });
function PublicProfileRoute() { const { handle } = Route.useParams(); return <PublicProfilePage handle={handle} />; }
