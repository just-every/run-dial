import { createFileRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { HoursPage } from "../core/features/availability/ui/hours-page";

export const Route = createFileRoute('/app/settings_/hours')({ component: withEditorLeaf(HoursPage) });
