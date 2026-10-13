import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { ManageBookingPage } from "../core/features/public-booking/ui/event-page";


export const Route = createFileRoute('/embed/manage/$token' )({ component: withEditorLeaf(EmbeddedManageRoute) });
function EmbeddedManageRoute() { return <ManageBookingPage token={Route.useParams().token} embedded />; }
