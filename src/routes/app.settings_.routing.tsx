import { createFileRoute } from "@tanstack/react-router";
import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { RoutingSettings } from "../core/features/routing/client";
export const Route=createFileRoute("/app/settings_/routing")({component:withEditorLeaf(RoutingSettings)});
