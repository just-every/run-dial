import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { RequestsInboxPage } from "../core/features/availability-requests/ui/requests-page";


export const Route = createFileRoute('/app/requests' )({ component: withEditorLeaf(RequestsInboxPage) });

