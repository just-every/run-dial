import { withEditorLeaf } from "../core/features/editor/editor-leaf";
import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "../core/features/host-profile/ui/profile-page";


export const Route = createFileRoute('/app/profile' )({ codeSplitGroupings: [], component: withEditorLeaf(ProfilePage) });

