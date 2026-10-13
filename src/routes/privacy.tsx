import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { PublicPrivacyPage } from "../core/features/public-booking/ui/privacy-page";


export const Route = createFileRoute('/privacy' )({ component: withEditorLeaf(PublicPrivacyPage) });

