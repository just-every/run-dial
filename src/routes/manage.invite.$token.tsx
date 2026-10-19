import { createFileRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { InvitationManagePage } from "../core/features/public-booking/ui/invitation-manage-page";

export const Route = createFileRoute('/manage/invite/$token')({ component: withEditorLeaf(InvitationManageRoute) });
function InvitationManageRoute() { return <InvitationManagePage token={Route.useParams().token} />; }
