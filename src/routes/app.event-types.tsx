import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { EventTypesPage } from "../core/features/event-types/ui/event-types-page";


export const Route = createFileRoute('/app/event-types' )({ component: withEditorLeaf(EventTypesPage) });

