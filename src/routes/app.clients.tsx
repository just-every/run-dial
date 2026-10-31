import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { ClientsPage } from "../core/features/clients/client";


export const Route = createFileRoute('/app/clients' )({ codeSplitGroupings: [], component: withEditorLeaf(ClientsPage) });
