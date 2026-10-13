import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { ManageBookingPage } from "../core/features/public-booking/ui/event-page";


export const Route = createFileRoute('/manage/$token' )({ component: withEditorLeaf(PublicManageRoute) });
function PublicManageRoute() { return <ManageBookingPage token={Route.useParams().token} />; }
