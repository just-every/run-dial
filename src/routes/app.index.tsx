import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../core/features/operators/ui/dashboard-page";


export const Route = createFileRoute('/app/' )({ codeSplitGroupings: [], component: withEditorLeaf(DashboardPage) });

