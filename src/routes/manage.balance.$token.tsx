import { createFileRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { BalancePage } from "../core/features/public-booking/ui/balance-page";

export const Route = createFileRoute('/manage/balance/$token')({ component: withEditorLeaf(BalanceRoute) });
function BalanceRoute() { return <BalancePage token={Route.useParams().token} />; }
