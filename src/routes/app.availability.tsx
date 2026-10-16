import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { AvailabilityIndexPage } from "../core/features/event-types/ui/availability-index-page";


export const Route = createFileRoute('/app/availability' )({ codeSplitGroupings: [], component: withEditorLeaf(AvailabilityIndexPage) });

